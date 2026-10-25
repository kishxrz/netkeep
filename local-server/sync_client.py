import time
import os
import json
import random
import logging
import httpx
from datetime import datetime
from database import SessionLocal
import models
from config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [SyncClient] %(message)s")
logger = logging.getLogger("SyncClient")

CLOUD_API_URL = settings.CLOUD_API_URL
BRANCH_ID = settings.BRANCH_ID

def calculate_backoff_seconds(retry_count: int, base_seconds: float = 1.0, max_seconds: float = 60.0) -> float:
    """Calculates exponential backoff with full jitter."""
    exponential = min(max_seconds, base_seconds * (2 ** max(0, retry_count)))
    jitter_factor = random.uniform(0.5, 1.5)
    return round(exponential * jitter_factor, 2)

def flush_pending_sync_queue(limit: int = 50, max_retries: int = 5, force: bool = False):
    """
    Flushes pending sync events from the local SQLite durable outbox to the Cloud API.
    Preserves all records on timeout or network drop.
    Categorizes permanent validation failures (4xx) vs transient network failures.
    """
    db = SessionLocal()
    try:
        query = db.query(models.SyncEvent).filter(
            models.SyncEvent.sync_status.in_(["PENDING", "FAILED"] if force else ["PENDING"])
        ).order_by(models.SyncEvent.id.asc()).limit(limit)

        pending_events = query.all()

        if not pending_events:
            return {"synced_count": 0, "message": "Durable outbox queue is clear."}

        payloads = []
        for ev in pending_events:
            payloads.append({
                "sync_event_id": ev.event_uuid,
                "branch_id": BRANCH_ID,
                "entity_type": ev.event_type,
                "action": "INSERT",
                "payload": json.loads(ev.payload_json),
                "created_at": ev.created_at.isoformat()
            })

        logger.info(f"Dispatching {len(payloads)} durable events to Cloud API ({CLOUD_API_URL})...")

        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.post(
                    f"{CLOUD_API_URL}/sync/ingest",
                    json={"branch_id": BRANCH_ID, "events": payloads}
                )

                if resp.status_code == 200:
                    now = datetime.utcnow()
                    for ev in pending_events:
                        ev.sync_status = "SYNCED"
                        ev.synced_at = now
                    db.commit()
                    logger.info(f"Successfully replicated {len(payloads)} events to Cloud.")
                    return {"synced_count": len(payloads), "status": "SUCCESS"}

                # Permanent validation failures (400, 422)
                elif resp.status_code in [400, 422]:
                    logger.error(f"Permanent Cloud Validation Failure ({resp.status_code}): {resp.text}")
                    for ev in pending_events:
                        ev.sync_status = "FAILED"
                        ev.retry_count += 1
                    db.commit()
                    return {"synced_count": 0, "status": "PERMANENT_FAILURE", "code": resp.status_code, "detail": resp.text}

                # Transient server errors (5xx, 429)
                else:
                    logger.warning(f"Transient Cloud Error ({resp.status_code}). Applying backoff.")
                    for ev in pending_events:
                        ev.retry_count += 1
                        if ev.retry_count >= max_retries:
                            ev.sync_status = "FAILED"
                    db.commit()
                    return {"synced_count": 0, "status": "TRANSIENT_FAILURE", "code": resp.status_code}

        except (httpx.RequestError, httpx.TimeoutException) as net_err:
            # Network drop or timeout: Queue is safely preserved in SQLite
            logger.warning(f"Cloud API unreachable ({net_err}). Outbox safely buffered in local SQLite.")
            for ev in pending_events:
                ev.retry_count += 1
            db.commit()
            return {"synced_count": 0, "status": "OFFLINE_BUFFERED", "error": str(net_err)}

    finally:
        db.close()

def manual_retry_sync_event(event_uuid: str):
    """Manually resets retry count and triggers sync for a specific event."""
    db = SessionLocal()
    try:
        ev = db.query(models.SyncEvent).filter(models.SyncEvent.event_uuid == event_uuid).first()
        if not ev:
            return {"status": "NOT_FOUND"}
        ev.sync_status = "PENDING"
        ev.retry_count = 0
        db.commit()
        return flush_pending_sync_queue(limit=1, force=True)
    finally:
        db.close()

if __name__ == "__main__":
    result = flush_pending_sync_queue()
    print(f"Sync result: {result}")
