import json
import uuid
import datetime
from sqlalchemy.orm import Session as DBSession
from typing import Optional, List, Tuple
import models, schemas
from config import settings

# ==========================================
# MENU OPERATIONS
# ==========================================
def get_menu_items(db: DBSession, category: Optional[str] = None, available_only: bool = True) -> List[models.MenuItem]:
    query = db.query(models.MenuItem)
    if available_only:
        query = query.filter(models.MenuItem.is_available == True)
    if category and category.lower() != "all":
        query = query.filter(models.MenuItem.category.ilike(category))
    return query.order_by(models.MenuItem.category, models.MenuItem.name).all()

def get_menu_item_by_id(db: DBSession, item_id: int) -> Optional[models.MenuItem]:
    return db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()

# ==========================================
# ORDER OPERATIONS & IDEMPOTENT TRANSACTION
# ==========================================
def get_order_by_id(db: DBSession, order_id: str) -> Optional[models.Order]:
    return db.query(models.Order).filter(models.Order.id == str(order_id)).first()

def get_orders(db: DBSession, limit: int = 50, offset: int = 0) -> List[models.Order]:
    return db.query(models.Order).order_by(models.Order.created_at.desc()).offset(offset).limit(limit).all()

def create_order_idempotent(db: DBSession, req: schemas.OrderCreate) -> Tuple[models.Order, bool]:
    """
    Creates an order, order items, inventory movements, and sync event in a SINGLE transaction.
    If an order with the client-generated UUID already exists, returns the existing order
    without deducting stock twice (Idempotency guarantee).
    
    Returns: (Order, is_idempotent_replay: bool)
    """
    order_uuid_str = str(req.id)

    # 1. IDEMPOTENCY CHECK
    existing_order = get_order_by_id(db, order_uuid_str)
    if existing_order:
        setattr(existing_order, "is_idempotent_replay", True)
        return existing_order, True

    # 2. VALIDATION OF LINE ITEMS & QUANTITIES
    if not req.items:
        raise ValueError("Order must contain at least one line item.")

    validated_items = []
    subtotal_paise = 0

    for item_in in req.items:
        menu_item = get_menu_item_by_id(db, item_in.menu_item_id)
        if not menu_item:
            raise ValueError(f"Menu item with ID {item_in.menu_item_id} does not exist.")
        if not menu_item.is_available:
            raise ValueError(f"Menu item '{menu_item.name}' is currently unavailable.")
        if menu_item.stock < item_in.quantity:
            raise ValueError(
                f"Insufficient stock for '{menu_item.name}'. Requested: {item_in.quantity}, Available: {menu_item.stock}."
            )

        line_subtotal = menu_item.price_paise * item_in.quantity
        subtotal_paise += line_subtotal
        validated_items.append((menu_item, item_in.quantity, line_subtotal))

    # 3. FINANCIAL CALCULATIONS (INTEGER PAISE)
    discount_paise = min(req.discount_paise, subtotal_paise)
    taxable_paise = max(0, subtotal_paise - discount_paise)
    tax_paise = round((taxable_paise * 5) / 100) # 5% GST
    total_paise = taxable_paise + tax_paise

    order_code = req.order_code or f"ORD-{order_uuid_str[:6].upper()}"

    # 4. ATOMIC TRANSACTION EXECUTION
    try:
        # Create Order
        new_order = models.Order(
            id=order_uuid_str,
            order_code=order_code,
            customer_name=req.customer_name,
            payment_method=req.payment_method,
            subtotal_paise=subtotal_paise,
            tax_paise=tax_paise,
            discount_paise=discount_paise,
            total_paise=total_paise,
            status="PAID",
            notes=req.notes,
            created_at=datetime.datetime.utcnow()
        )
        db.add(new_order)
        db.flush() # Flushes new_order to ensure order_id is bound

        # Create Order Items and Inventory Movements
        sync_payload_items = []
        for menu_item, qty, line_subtotal in validated_items:
            # Order Item
            order_item = models.OrderItem(
                order_id=new_order.id,
                menu_item_id=menu_item.id,
                item_name=menu_item.name,
                unit_price_paise=menu_item.price_paise,
                quantity=qty,
                subtotal_paise=line_subtotal
            )
            db.add(order_item)

            # Record Inventory Movement
            stock_before = menu_item.stock
            menu_item.stock -= qty
            stock_after = menu_item.stock

            movement = models.InventoryMovement(
                menu_item_id=menu_item.id,
                movement_type="ORDER_SALE",
                quantity_delta=-qty,
                stock_before=stock_before,
                stock_after=stock_after,
                reference_id=new_order.id,
                created_at=datetime.datetime.utcnow()
            )
            db.add(movement)

            sync_payload_items.append({
                "sku": menu_item.sku,
                "name": menu_item.name,
                "quantity": qty,
                "unit_price_paise": menu_item.price_paise,
                "subtotal_paise": line_subtotal
            })

        # Create Sync Event for cloud replication
        sync_event = models.SyncEvent(
            order_id=new_order.id,
            event_type="ORDER_CREATED",
            payload_json=json.dumps({
                "order_id": new_order.id,
                "order_code": new_order.order_code,
                "customer_name": new_order.customer_name,
                "payment_method": new_order.payment_method,
                "total_paise": new_order.total_paise,
                "created_at": new_order.created_at.isoformat(),
                "items": sync_payload_items
            }),
            sync_status="PENDING",
            created_at=datetime.datetime.utcnow()
        )
        db.add(sync_event)

        # Commit entire transaction atomically
        db.commit()
        db.refresh(new_order)
        setattr(new_order, "is_idempotent_replay", False)
        return new_order, False

    except Exception:
        db.rollback()
        raise

# ==========================================
# SYNC STATUS OPERATIONS
# ==========================================
def get_sync_status(db: DBSession) -> schemas.SyncStatusResponse:
    pending_count = db.query(models.SyncEvent).filter(models.SyncEvent.sync_status == "PENDING").count()
    synced_count = db.query(models.SyncEvent).filter(models.SyncEvent.sync_status == "SYNCED").count()
    total_orders = db.query(models.Order).count()

    return schemas.SyncStatusResponse(
        pending_sync_events=pending_count,
        synced_events=synced_count,
        total_orders_recorded=total_orders,
        cloud_endpoint=settings.CLOUD_API_URL,
        branch_id=settings.BRANCH_ID,
        server_time=datetime.datetime.utcnow()
    )
