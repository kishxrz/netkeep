import json
import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_cloud_db
import models, schemas

router = APIRouter(prefix="/sync", tags=["Sync Ingestion"])

@router.post("/ingest", response_model=schemas.SyncBatchResponse)
def ingest_sync_batch(req: schemas.SyncBatchRequest, db: Session = Depends(get_cloud_db)):
    """
    Ingests batches of sync events forwarded by café edge servers.
    Strictly deduplicates based on unique sync_event_id.
    """
    processed = 0
    duplicates = 0
    target_id = req.cafe_id or req.branch_id or "UNKNOWN"

    for ev in req.events:
        # 1. Idempotency check: does sync_event_id already exist?
        exists = db.query(models.SyncEvent).filter(
            models.SyncEvent.sync_event_id == ev.sync_event_id
        ).first()

        if exists:
            duplicates += 1
            continue

        # 2. Check if cafe exists to link foreign key
        cafe = db.query(models.Cafe).filter(
            (models.Cafe.id == target_id) | (models.Cafe.cafe_code == target_id)
        ).first()
        cafe_id = cafe.id if cafe else target_id

        # 3. Add to sync_events table
        record = models.SyncEvent(
            sync_event_id=ev.sync_event_id,
            cafe_id=cafe_id,
            entity_type=ev.entity_type,
            action=ev.action,
            payload_json=json.dumps(ev.payload),
            status="PROCESSED",
            ingested_at=datetime.datetime.utcnow()
        )
        db.add(record)
        processed += 1

    db.commit()

    return schemas.SyncBatchResponse(
        cafe_id=target_id,
        processed_count=processed,
        skipped_duplicates=duplicates,
        status="SUCCESS"
    )

@router.get("/events")
def list_ingested_events(limit: int = 50, db: Session = Depends(get_cloud_db)):
    records = db.query(models.SyncEvent).order_by(
        models.SyncEvent.ingested_at.desc()
    ).limit(limit).all()

    return [{
        "id": r.id,
        "sync_event_id": r.sync_event_id,
        "cafe_id": r.cafe_id,
        "entity_type": r.entity_type,
        "action": r.action,
        "payload": json.loads(r.payload_json),
        "ingested_at": r.ingested_at.isoformat()
    } for r in records]
