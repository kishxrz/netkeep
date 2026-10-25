from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from database import get_cloud_db
import models, schemas

router = APIRouter(prefix="/reservations", tags=["Reservations"])

@router.get("", response_model=List[schemas.ReservationResponse])
def list_reservations(branch_code: str = None, db: Session = Depends(get_cloud_db)):
    query = db.query(models.Reservation)
    if branch_code:
        branch = db.query(models.Branch).filter(models.Branch.branch_code == branch_code).first()
        if branch:
            query = query.filter(models.Reservation.branch_id == branch.id)
    return query.order_by(models.Reservation.reserved_for_time.asc()).all()

@router.post("", response_model=schemas.ReservationResponse)
def create_reservation(res_in: schemas.ReservationCreate, db: Session = Depends(get_cloud_db)):
    branch = db.query(models.Branch).filter(models.Branch.branch_code == res_in.branch_code).first()
    if not branch:
        raise HTTPException(status_code=404, detail=f"Branch '{res_in.branch_code}' does not exist")

    reservation = models.Reservation(
        cafe_id=branch.id,
        customer_name=res_in.customer_name,
        station_type=res_in.station_type,
        reserved_for_time=res_in.reserved_for_time,
        duration_hours=res_in.duration_hours,
        status="CONFIRMED"
    )
    db.add(reservation)
    db.commit()
    db.refresh(reservation)
    return reservation

@router.post("/{res_id}/cancel")
def cancel_reservation(res_id: int, db: Session = Depends(get_cloud_db)):
    res = db.query(models.Reservation).filter(models.Reservation.id == res_id).first()
    if not res:
        raise HTTPException(status_code=404, detail="Reservation not found")
    res.status = "CANCELLED"
    db.commit()
    return {"id": res.id, "status": "CANCELLED"}
