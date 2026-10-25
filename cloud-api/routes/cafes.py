import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_cloud_db
import models
import schemas
from auth import get_authenticated_owner

router = APIRouter(prefix="/cafes", tags=["Cafes"])

@router.get("", response_model=List[schemas.CafeResponse])
def list_cafes(db: Session = Depends(get_cloud_db)):
    """Public listing of registered NetKeep Café locations."""
    return db.query(models.Cafe).order_by(models.Cafe.name).all()

@router.post("", response_model=schemas.CafeResponse, status_code=status.HTTP_201_CREATED)
def register_cafe(
    cafe_in: schemas.CafeCreate,
    owner: models.User = Depends(get_authenticated_owner),
    db: Session = Depends(get_cloud_db)
):
    """Registers a new café branch under the authenticated owner."""
    existing = db.query(models.Cafe).filter(models.Cafe.cafe_code == cafe_in.cafe_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Café code already registered.")

    new_cafe = models.Cafe(
        cafe_code=cafe_in.cafe_code,
        name=cafe_in.name,
        city=cafe_in.city,
        address=cafe_in.address,
        phone=cafe_in.phone,
        total_stations=cafe_in.total_stations,
        edge_ip=cafe_in.edge_ip,
        owner_id=owner.id,
        api_key=cafe_in.api_key or f"key-{cafe_in.cafe_code.lower()}-secret"
    )
    db.add(new_cafe)
    db.commit()
    db.refresh(new_cafe)
    return new_cafe

@router.post("/{cafe_id}/ping")
def cafe_ping(cafe_id: str, db: Session = Depends(get_cloud_db)):
    """Heartbeat endpoint for edge server to verify cloud connectivity."""
    cafe = db.query(models.Cafe).filter(
        (models.Cafe.id == cafe_id) | (models.Cafe.cafe_code == cafe_id)
    ).first()
    if not cafe:
        raise HTTPException(status_code=404, detail="Café not found.")
    cafe.last_ping = datetime.datetime.utcnow()
    cafe.is_active = True
    db.commit()
    return {"cafe_id": cafe.id, "cafe_code": cafe.cafe_code, "status": "PONG", "time": cafe.last_ping.isoformat()}
