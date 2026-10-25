import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.orm import Session
from database import get_cloud_db
from models import Cafe, MenuItem, Order, OrderItem, InventoryMovement, SyncEvent
from schemas import OrderCreateRequest, OrderResponse, OrderItemResponse
from auth import get_authenticated_cafe

router = APIRouter(prefix="/cafes/{cafe_id}/orders", tags=["Cloud Orders (Edge Ingestion)"])

@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def receive_order_from_local_server(
    cafe_id: str,
    req: OrderCreateRequest,
    response: Response,
    cafe: Cafe = Depends(get_authenticated_cafe),
    db: Session = Depends(get_cloud_db)
):
    """
    Receives an order synced from the local café edge server.
    
    SAFETY INVARIANTS:
    1. Authenticates local server via X-Cafe-API-Key.
    2. Strict UUID Idempotency: Repeating an order UUID returns the existing committed order
       WITHOUT deducting stock twice or duplicating inventory movements.
    3. Atomic Database Transaction: Deducts stock, writes inventory movements, orders,
       order items, and sync events in a single commit.
    4. Integer Paise: All financial values are calculated in integer paise (₹1 = 100 paise).
    5. Offline POS: No online payment gateways; payment method records local cashier settlement.
    """
    # 1. IDEMPOTENCY CHECK
    existing_order = db.query(Order).filter(Order.id == req.id).first()
    if existing_order:
        response.status_code = status.HTTP_200_OK
        # Return existing order immediately with is_idempotent_replay flag
        items_resp = [
            OrderItemResponse(
                id=item.id,
                menu_item_id=item.menu_item_id,
                item_name=item.item_name,
                unit_price_paise=item.unit_price_paise,
                quantity=item.quantity,
                subtotal_paise=item.subtotal_paise,
                created_at=item.created_at
            )
            for item in existing_order.items
        ]
        resp = OrderResponse(
            id=existing_order.id,
            cafe_id=existing_order.cafe_id,
            order_code=existing_order.order_code,
            customer_name=existing_order.customer_name,
            payment_method=existing_order.payment_method,
            subtotal_paise=existing_order.subtotal_paise,
            tax_paise=existing_order.tax_paise,
            discount_paise=existing_order.discount_paise,
            total_paise=existing_order.total_paise,
            status=existing_order.status,
            notes=existing_order.notes,
            created_at=existing_order.created_at,
            synced_at=existing_order.synced_at,
            items=items_resp,
            is_idempotent_replay=True
        )
        return resp

    # 2. ATOMIC TRANSACTION: Validate Line Items, Deduct Stock, Create Order
    try:
        subtotal_paise = 0
        order_items_to_create = []
        movements_to_create = []

        now_utc = datetime.datetime.utcnow()
        order_created_at = req.created_at or now_utc

        for line in req.items:
            # Query item belonging to this specific cafe
            menu_item = db.query(MenuItem).filter(
                MenuItem.id == line.menu_item_id,
                MenuItem.cafe_id == cafe.id
            ).with_for_update().first()

            if not menu_item:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Menu item with ID {line.menu_item_id} not found in café '{cafe.name}'."
                )

            # Check stock sufficiency
            if menu_item.stock < line.quantity:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Insufficient stock for '{menu_item.name}'. Available: {menu_item.stock}, requested: {line.quantity}."
                )

            unit_price = line.unit_price_paise if line.unit_price_paise is not None else menu_item.price_paise
            line_subtotal = unit_price * line.quantity
            subtotal_paise += line_subtotal

            # Deduct stock
            menu_item.stock -= line.quantity
            menu_item.is_available = menu_item.stock > 0

            # Record Inventory Movement
            movements_to_create.append(
                InventoryMovement(
                    cafe_id=cafe.id,
                    menu_item_id=menu_item.id,
                    order_id=req.id,
                    change_qty=-line.quantity,
                    reason="SALE",
                    balance_after=menu_item.stock,
                    created_at=order_created_at
                )
            )

            # Prepare Order Item
            order_items_to_create.append(
                OrderItem(
                    order_id=req.id,
                    menu_item_id=menu_item.id,
                    item_name=line.item_name or menu_item.name,
                    unit_price_paise=unit_price,
                    quantity=line.quantity,
                    subtotal_paise=line_subtotal,
                    created_at=order_created_at
                )
            )

        # 3. Calculate Financials in Integer Paise (5% GST)
        discount_paise = min(req.discount_paise, subtotal_paise)
        taxable_paise = subtotal_paise - discount_paise
        tax_paise = round(taxable_paise * 0.05)
        total_paise = taxable_paise + tax_paise

        # 4. Insert Master Order
        new_order = Order(
            id=req.id,
            cafe_id=cafe.id,
            order_code=req.order_code,
            customer_name=req.customer_name,
            payment_method=req.payment_method,
            subtotal_paise=subtotal_paise,
            tax_paise=tax_paise,
            discount_paise=discount_paise,
            total_paise=total_paise,
            status="PAID",
            notes=req.notes,
            created_at=order_created_at,
            synced_at=now_utc
        )
        db.add(new_order)
        db.flush()

        # Add line items & inventory movements
        for item in order_items_to_create:
            db.add(item)
        for mov in movements_to_create:
            db.add(mov)

        # Add Sync Event for audit trail
        sync_event = SyncEvent(
            cafe_id=cafe.id,
            sync_event_id=f"order-sync-{req.id}",
            entity_type="order",
            action="create",
            payload_json=f'{{"order_id": "{req.id}", "total_paise": {total_paise}}}',
            status="PROCESSED",
            ingested_at=now_utc
        )
        db.add(sync_event)

        # Update cafe last_ping
        cafe.last_ping = now_utc

        # 5. COMMIT TRANSACTION
        db.commit()
        db.refresh(new_order)

        items_resp = [
            OrderItemResponse(
                id=item.id,
                menu_item_id=item.menu_item_id,
                item_name=item.item_name,
                unit_price_paise=item.unit_price_paise,
                quantity=item.quantity,
                subtotal_paise=item.subtotal_paise,
                created_at=item.created_at
            )
            for item in new_order.items
        ]

        return OrderResponse(
            id=new_order.id,
            cafe_id=new_order.cafe_id,
            order_code=new_order.order_code,
            customer_name=new_order.customer_name,
            payment_method=new_order.payment_method,
            subtotal_paise=new_order.subtotal_paise,
            tax_paise=new_order.tax_paise,
            discount_paise=new_order.discount_paise,
            total_paise=new_order.total_paise,
            status=new_order.status,
            notes=new_order.notes,
            created_at=new_order.created_at,
            synced_at=new_order.synced_at,
            items=items_resp,
            is_idempotent_replay=False
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Order persistence error: {str(e)}"
        )

@router.get("", response_model=List[OrderResponse])
def list_cafe_orders(
    cafe_id: str,
    cafe: Cafe = Depends(get_authenticated_cafe),
    db: Session = Depends(get_cloud_db)
):
    """Lists all orders ingested for the authenticated café."""
    orders = db.query(Order).filter(Order.cafe_id == cafe.id).order_by(Order.created_at.desc()).limit(100).all()
    results = []
    for ord in orders:
        items = [
            OrderItemResponse(
                id=item.id,
                menu_item_id=item.menu_item_id,
                item_name=item.item_name,
                unit_price_paise=item.unit_price_paise,
                quantity=item.quantity,
                subtotal_paise=item.subtotal_paise,
                created_at=item.created_at
            )
            for item in ord.items
        ]
        results.append(
            OrderResponse(
                id=ord.id,
                cafe_id=ord.cafe_id,
                order_code=ord.order_code,
                customer_name=ord.customer_name,
                payment_method=ord.payment_method,
                subtotal_paise=ord.subtotal_paise,
                tax_paise=ord.tax_paise,
                discount_paise=ord.discount_paise,
                total_paise=ord.total_paise,
                status=ord.status,
                notes=ord.notes,
                created_at=ord.created_at,
                synced_at=ord.synced_at,
                items=items,
                is_idempotent_replay=False
            )
        )
    return results
