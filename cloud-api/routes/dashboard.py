import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_cloud_db
from models import Cafe, User, MenuItem, Order, OrderItem
from schemas import (
    OwnerDashboardResponse, LowStockAlert, TopSellingItem, CafeOverview,
    OrderResponse, OrderItemResponse, MenuItemResponse
)
from auth import get_authenticated_owner, verify_cafe_ownership

router = APIRouter(prefix="", tags=["Owner Dashboard (Multi-Branch Analytics)"])

def format_inr(paise: int) -> str:
    """Helper to format integer paise to INR string (e.g. 18500 -> ₹185.00)."""
    return f"₹{paise / 100:,.2f}"

@router.get("/owner/dashboard", response_model=OwnerDashboardResponse)
def get_owner_dashboard(
    owner: User = Depends(get_authenticated_owner),
    db: Session = Depends(get_cloud_db)
):
    """
    Retrieves the central owner dashboard.
    SECURITY: Authenticated via owner Bearer token. Restricts data to cafés owned by the caller.
    """
    # 1. Fetch Owned Cafés
    if owner.role == "admin":
        owned_cafes = db.query(Cafe).all()
    else:
        owned_cafes = db.query(Cafe).filter(Cafe.owner_id == owner.id).all()

    cafe_ids = [c.id for c in owned_cafes]
    cafe_map = {c.id: c for c in owned_cafes}

    now_utc = datetime.datetime.utcnow()
    start_of_today = datetime.datetime(now_utc.year, now_utc.month, now_utc.day)

    if not cafe_ids:
        return OwnerDashboardResponse(
            owner_id=owner.id,
            owner_name=owner.full_name,
            total_cafes=0,
            total_revenue_paise=0,
            total_revenue_inr="₹0.00",
            total_orders_count=0,
            today_orders_count=0,
            today_revenue_paise=0,
            today_revenue_inr="₹0.00",
            low_stock_count=0,
            low_stock_alerts=[],
            top_selling_items=[],
            recent_orders=[],
            cafes=[],
            server_time=now_utc
        )

    # 2. Financial Aggregates
    all_orders = db.query(Order).filter(Order.cafe_id.in_(cafe_ids)).all()
    total_revenue_paise = sum(o.total_paise for o in all_orders)
    total_orders_count = len(all_orders)

    today_orders = [o for o in all_orders if o.created_at >= start_of_today]
    today_revenue_paise = sum(o.total_paise for o in today_orders)
    today_orders_count = len(today_orders)

    # 3. Low Stock Alerts
    low_stock_items = db.query(MenuItem).filter(
        MenuItem.cafe_id.in_(cafe_ids),
        MenuItem.stock <= MenuItem.low_stock_threshold
    ).all()

    low_stock_alerts = [
        LowStockAlert(
            menu_item_id=item.id,
            cafe_id=item.cafe_id,
            cafe_name=cafe_map[item.cafe_id].name if item.cafe_id in cafe_map else "Unknown",
            name=item.name,
            sku=item.sku,
            stock=item.stock,
            low_stock_threshold=item.low_stock_threshold
        )
        for item in low_stock_items
    ]

    # 4. Top Selling Items
    top_items_query = (
        db.query(
            OrderItem.menu_item_id,
            OrderItem.item_name,
            func.sum(OrderItem.quantity).label("total_qty"),
            func.sum(OrderItem.subtotal_paise).label("total_rev")
        )
        .join(Order, OrderItem.order_id == Order.id)
        .filter(Order.cafe_id.in_(cafe_ids))
        .group_by(OrderItem.menu_item_id, OrderItem.item_name)
        .order_by(func.sum(OrderItem.quantity).desc())
        .limit(5)
        .all()
    )

    top_selling = [
        TopSellingItem(
            menu_item_id=row[0],
            name=row[1],
            category="POS Items",
            total_quantity_sold=int(row[2]),
            total_revenue_paise=int(row[3])
        )
        for row in top_items_query
    ]

    # 5. Recent Orders
    recent_db_orders = (
        db.query(Order)
        .filter(Order.cafe_id.in_(cafe_ids))
        .order_by(Order.created_at.desc())
        .limit(10)
        .all()
    )

    recent_orders = []
    for ord in recent_db_orders:
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
        recent_orders.append(
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

    # 6. Cafe Summaries
    cafe_overviews = []
    for c in owned_cafes:
        c_today = [o for o in today_orders if o.cafe_id == c.id]
        c_today_rev = sum(o.total_paise for o in c_today)
        cafe_overviews.append(
            CafeOverview(
                id=c.id,
                cafe_code=c.cafe_code,
                name=c.name,
                city=c.city,
                total_stations=c.total_stations,
                today_orders_count=len(c_today),
                today_revenue_paise=c_today_rev,
                today_revenue_inr=format_inr(c_today_rev),
                is_active=c.is_active
            )
        )

    return OwnerDashboardResponse(
        owner_id=owner.id,
        owner_name=owner.full_name,
        total_cafes=len(owned_cafes),
        total_revenue_paise=total_revenue_paise,
        total_revenue_inr=format_inr(total_revenue_paise),
        total_orders_count=total_orders_count,
        today_orders_count=today_orders_count,
        today_revenue_paise=today_revenue_paise,
        today_revenue_inr=format_inr(today_revenue_paise),
        low_stock_count=len(low_stock_alerts),
        low_stock_alerts=low_stock_alerts,
        top_selling_items=top_selling,
        recent_orders=recent_orders,
        cafes=cafe_overviews,
        server_time=now_utc
    )

@router.get("/cafes/{cafe_id}/dashboard")
def get_single_cafe_dashboard(
    cafe_id: str,
    owner: User = Depends(get_authenticated_owner),
    db: Session = Depends(get_cloud_db)
):
    """
    Retrieves the dashboard for a single specific café.
    SECURITY: Enforces strict cafe ownership check.
    """
    cafe = db.query(Cafe).filter((Cafe.id == cafe_id) | (Cafe.cafe_code == cafe_id)).first()
    if not cafe:
        raise HTTPException(status_code=404, detail="Café not found")

    # Ownership check
    verify_cafe_ownership(cafe, owner)

    orders = db.query(Order).filter(Order.cafe_id == cafe.id).all()
    total_rev = sum(o.total_paise for o in orders)

    now_utc = datetime.datetime.utcnow()
    start_today = datetime.datetime(now_utc.year, now_utc.month, now_utc.day)
    today_orders = [o for o in orders if o.created_at >= start_today]
    today_rev = sum(o.total_paise for o in today_orders)

    low_stock = db.query(MenuItem).filter(
        MenuItem.cafe_id == cafe.id,
        MenuItem.stock <= MenuItem.low_stock_threshold
    ).all()

    return {
        "cafe_id": cafe.id,
        "cafe_code": cafe.cafe_code,
        "name": cafe.name,
        "city": cafe.city,
        "total_revenue_paise": total_rev,
        "total_revenue_inr": format_inr(total_rev),
        "total_orders": len(orders),
        "today_orders": len(today_orders),
        "today_revenue_paise": today_rev,
        "today_revenue_inr": format_inr(today_rev),
        "low_stock_count": len(low_stock),
        "low_stock_items": [
            {"id": i.id, "name": i.name, "sku": i.sku, "stock": i.stock, "threshold": i.low_stock_threshold}
            for i in low_stock
        ]
    }

@router.get("/cafes/{cafe_id}/inventory", response_model=List[MenuItemResponse])
def get_cafe_inventory(
    cafe_id: str,
    owner: User = Depends(get_authenticated_owner),
    db: Session = Depends(get_cloud_db)
):
    """
    Retrieves the live menu and inventory stock levels for a café.
    SECURITY: Enforces strict cafe ownership check.
    """
    cafe = db.query(Cafe).filter((Cafe.id == cafe_id) | (Cafe.cafe_code == cafe_id)).first()
    if not cafe:
        raise HTTPException(status_code=404, detail="Café not found")

    verify_cafe_ownership(cafe, owner)

    items = db.query(MenuItem).filter(MenuItem.cafe_id == cafe.id).order_by(MenuItem.category, MenuItem.name).all()
    return items
