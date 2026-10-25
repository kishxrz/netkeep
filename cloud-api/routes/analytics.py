import json
from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_cloud_db
import models, schemas

router = APIRouter(prefix="/analytics", tags=["Cloud Analytics"])

@router.get("/overview", response_model=schemas.CloudAnalyticsResponse)
def get_cloud_overview(db: Session = Depends(get_cloud_db)):
    total_branches = db.query(models.Branch).count()
    active_branches = db.query(models.Branch).filter(models.Branch.status == "ACTIVE").count()
    total_stations = db.query(func.sum(models.Branch.total_stations)).scalar() or 0
    total_ingested = db.query(models.IngestedSyncEvent).count()
    active_res = db.query(models.Reservation).filter(models.Reservation.status == "CONFIRMED").count()

    # Calculate revenue from ingested session events
    ingested_sessions = db.query(models.IngestedSyncEvent).filter(
        models.IngestedSyncEvent.entity_type == "SESSION"
    ).all()

    rev_total = 0.0
    for s in ingested_sessions:
        try:
            data = json.loads(s.payload_json)
            rev_total += float(data.get("amount", data.get("total_amount", 0.0)))
        except (ValueError, KeyError):
            pass

    return schemas.CloudAnalyticsResponse(
        total_branches=total_branches,
        active_branches=active_branches,
        total_network_stations=int(total_stations),
        network_revenue_today=round(rev_total, 2),
        total_ingested_events=total_ingested,
        active_reservations=active_res,
        cloud_time=datetime.utcnow()
    )
