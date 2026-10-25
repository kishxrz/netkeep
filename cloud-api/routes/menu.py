import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from database import get_cloud_db
import models
import schemas

router = APIRouter(tags=["Menu"])

@router.get("/menu", response_model=List[schemas.MenuItemResponse])
@router.get("/cafes/{cafe_id}/menu", response_model=List[schemas.MenuItemResponse])
def get_menu_items(
    cafe_id: Optional[str] = None,
    category: Optional[str] = Query(default=None, description="Filter by category e.g. Coffee, Bakery"),
    in_stock_only: bool = Query(default=False, description="Filter out zero-stock items"),
    db: Session = Depends(get_cloud_db)
):
    """
    Public menu retrieval endpoint for POS client workstations and digital menu boards.
    Returns integer-paise priced items for the given café or all active menu items.
    """
    query = db.query(models.MenuItem).filter(models.MenuItem.is_available == True)

    if cafe_id:
        cafe = db.query(models.Cafe).filter(
            (models.Cafe.id == cafe_id) | (models.Cafe.cafe_code == cafe_id)
        ).first()
        if cafe:
            query = query.filter(models.MenuItem.cafe_id == cafe.id)

    if category and category.lower() != "all":
        query = query.filter(models.MenuItem.category.ilike(f"%{category}%"))

    if in_stock_only:
        query = query.filter(models.MenuItem.stock > 0)

    items = query.order_by(models.MenuItem.category, models.MenuItem.name).all()
    return items
