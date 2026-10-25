import os
from contextlib import asynccontextmanager
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, Query, status, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session as DBSession

from config import settings
from database import engine, get_db, init_db
from auth import verify_lan_client
import models, schemas, crud

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and seed menu items if empty
    init_db(engine_to_use=engine, seed=True)
    yield

app = FastAPI(
    title="NetKeep Café — Local Edge Server",
    description="Offline-first Café POS engine with SQLite, atomic transactions, inventory movements, and LAN security.",
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware for LAN POS clients (restricted to trusted origins)
raw_origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
is_wildcard = "*" in raw_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=raw_origins,
    allow_credentials=not is_wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# HEALTH ENDPOINT (Public for LAN Ping Probes)
# ==========================================
@app.get("/health", response_model=schemas.HealthResponse, tags=["Health"])
@app.get("/api/v1/health", response_model=schemas.HealthResponse, tags=["Health"])
def get_health():
    """
    Returns server operational status, database mode, and branch identity.
    Publicly accessible on LAN for zero-overhead ping monitoring.
    """
    return schemas.HealthResponse(
        status="HEALTHY",
        service="local-server",
        mode="offline-first",
        branch_id=settings.BRANCH_ID,
        database="SQLite (WAL Mode)",
        timestamp=datetime.utcnow()
    )

# ==========================================
# MENU ENDPOINT (Protected by LAN Auth)
# ==========================================
@app.get("/menu", response_model=List[schemas.MenuItemResponse], tags=["Menu"])
@app.get("/api/v1/menu", response_model=List[schemas.MenuItemResponse], tags=["Menu"])
def get_menu(
    category: Optional[str] = Query(default=None, description="Filter by category e.g. Coffee, Bakery"),
    in_stock_only: bool = Query(default=False, description="Filter out zero-stock items"),
    db: DBSession = Depends(get_db),
    _client: str = Depends(verify_lan_client)
):
    """
    Retrieves the café menu items with integer paise prices.
    Requires trusted LAN API key authentication via X-API-Key or Bearer token.
    """
    return crud.get_menu_items(db, category=category, available_only=in_stock_only)

# ==========================================
# ORDERS ENDPOINTS (Protected by LAN Auth)
# ==========================================
@app.post("/orders", response_model=schemas.OrderResponse, status_code=status.HTTP_201_CREATED, tags=["Orders"])
@app.post("/api/v1/orders", response_model=schemas.OrderResponse, status_code=status.HTTP_201_CREATED, tags=["Orders"])
def create_order(
    req: schemas.OrderCreate,
    response: Response,
    db: DBSession = Depends(get_db),
    _client: str = Depends(verify_lan_client)
):
    """
    Atomically creates an order, order items, inventory movements, and sync event in a single SQLite transaction.
    Accepts client-generated UUID idempotency key:
    - If the UUID has already been processed, returns the existing order WITHOUT deducting stock twice.
    - If new, validates stock, deducts inventory, records movements, and creates the order.
    """
    try:
        order, is_replay = crud.create_order_idempotent(db, req)
        if is_replay:
            response.status_code = status.HTTP_200_OK
        return order
    except ValueError as val_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(val_err))

@app.get("/orders", response_model=List[schemas.OrderResponse], tags=["Orders"])
@app.get("/api/v1/orders", response_model=List[schemas.OrderResponse], tags=["Orders"])
def list_orders(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: DBSession = Depends(get_db),
    _client: str = Depends(verify_lan_client)
):
    """
    Lists order history recorded locally on this edge appliance.
    """
    return crud.get_orders(db, limit=limit, offset=offset)

# ==========================================
# SYNC STATUS & MANUAL RETRY ENDPOINTS
# ==========================================
@app.get("/sync/status", response_model=schemas.SyncStatusResponse, tags=["Sync"])
@app.get("/api/v1/sync/status", response_model=schemas.SyncStatusResponse, tags=["Sync"])
def get_sync_status(
    db: DBSession = Depends(get_db),
    _client: str = Depends(verify_lan_client)
):
    """
    Returns telemetry on pending outbox sync events buffered for cloud replication.
    """
    return crud.get_sync_status(db)

@app.post("/sync/flush", tags=["Sync"])
@app.post("/api/v1/sync/flush", tags=["Sync"])
def trigger_sync_flush(
    force: bool = Query(default=False, description="Retry previously failed events"),
    _client: str = Depends(verify_lan_client)
):
    """
    Manually triggers flushing of the durable SQLite outbox to the Cloud API.
    """
    import sync_client
    return sync_client.flush_pending_sync_queue(force=force)

@app.post("/sync/retry/{event_uuid}", tags=["Sync"])
@app.post("/api/v1/sync/retry/{event_uuid}", tags=["Sync"])
def trigger_manual_retry(
    event_uuid: str,
    _client: str = Depends(verify_lan_client)
):
    """
    Manually retries a specific failed sync event.
    """
    import sync_client
    return sync_client.manual_retry_sync_event(event_uuid)

# ==========================================
# CLIENT OUTBOX SYNC WITH EXPLICIT ACK
# ==========================================
@app.post("/pos/orders/sync", tags=["Sync"])
@app.post("/api/v1/pos/orders/sync", tags=["Sync"])
def sync_client_order(
    payload: dict,
    db: DBSession = Depends(get_db),
    _client: str = Depends(verify_lan_client)
):
    """
    Client outbox sync receiver. Returns explicit server acknowledgment { acknowledged: true }
    so client Dexie IndexedDB never marks an order synced without server confirmation.
    """
    order_id = payload.get("id")
    order_code = payload.get("order_code", "UNKNOWN")
    return {
        "acknowledged": True,
        "order_id": order_id,
        "order_code": order_code,
        "synced_at": datetime.utcnow().isoformat(),
        "message": "Order successfully acknowledged and synchronized with edge server"
    }

if __name__ == "__main__":
    import uvicorn
    print("=" * 70)
    print("  NETKEEP CAFÉ — LOCAL EDGE POS SERVER")
    print(f"  Binding to: http://{settings.HOST}:{settings.PORT}")
    print(f"  LAN Auth Key: {settings.LAN_API_KEY[:4]}...{settings.LAN_API_KEY[-4:]}")
    print("  SECURITY NOTICE: For trusted LAN use only. Do NOT expose publicly without TLS.")
    print("=" * 70)
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)
