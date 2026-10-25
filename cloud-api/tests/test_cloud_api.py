"""
NetKeep Café — Cloud Central API Integration Test Suite
Validates Supabase PostgreSQL schema compatibility, multi-tenant café isolation,
strict UUID idempotency, single-transaction stock deductions, owner authorization,
and cafe ownership verification.
"""

import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_cloud_db
from main import app
import models

# In-memory SQLite database for isolated test execution
TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

@pytest.fixture(scope="function")
def test_db():
    Base.metadata.create_all(bind=test_engine)
    db = TestingSessionLocal()
    try:
        # Seed test users
        owner1 = models.User(
            id="usr-owner-001",
            email="owner1@netkeepcafe.com",
            full_name="Rajesh Sharma",
            role="owner",
            auth_token="token-owner-1"
        )
        owner2 = models.User(
            id="usr-owner-002",
            email="owner2@netkeepcafe.com",
            full_name="Vikram Mehta",
            role="owner",
            auth_token="token-owner-2"
        )
        admin = models.User(
            id="usr-admin-001",
            email="admin@netkeepcafe.com",
            full_name="Priya Patel",
            role="admin",
            auth_token="token-admin"
        )
        db.add_all([owner1, owner2, admin])
        db.commit()

        # Seed test cafes
        cafe1 = models.Cafe(
            id="cafe-blr-01",
            cafe_code="CAFE-BLR-01",
            name="NetKeep Arena Bengaluru",
            city="Bengaluru",
            owner_id="usr-owner-001",
            api_key="key-cafe-1-secret",
            total_stations=16,
            is_active=True
        )
        cafe2 = models.Cafe(
            id="cafe-mum-02",
            cafe_code="CAFE-MUM-02",
            name="NetKeep Lounge Mumbai",
            city="Mumbai",
            owner_id="usr-owner-002",
            api_key="key-cafe-2-secret",
            total_stations=24,
            is_active=True
        )
        db.add_all([cafe1, cafe2])
        db.commit()

        # Seed menu items in integer paise
        item1 = models.MenuItem(
            id=1,
            cafe_id="cafe-blr-01",
            sku="CF-ESP-01",
            name="Espresso Doppio",
            category="Coffee",
            price_paise=12000,
            stock=30,
            low_stock_threshold=5,
            is_available=True
        )
        item2 = models.MenuItem(
            id=2,
            cafe_id="cafe-blr-01",
            sku="BK-CRO-01",
            name="Butter Croissant",
            category="Bakery",
            price_paise=14000,
            stock=10,
            low_stock_threshold=4,
            is_available=True
        )
        db.add_all([item1, item2])
        db.commit()

        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=test_engine)

@pytest.fixture(scope="function")
def client(test_db):
    def override_get_cloud_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_cloud_db] = override_get_cloud_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

# ==============================================================================
# 1. HEALTH & CONNECTIVITY TESTS
# ==============================================================================
def test_cloud_health_endpoint(client):
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "HEALTHY"
    assert data["service"] == "cloud-api"

# ==============================================================================
# 2. LOCAL CAFÉ SERVER AUTHENTICATION TESTS
# ==============================================================================
def test_order_ingestion_unauthorized_missing_api_key(client):
    payload = {
        "id": str(uuid.uuid4()),
        "order_code": "ORD-UNAUTH-01",
        "payment_method": "CASH",
        "items": [{"menu_item_id": 1, "quantity": 1}]
    }
    res = client.post("/api/v1/cafes/cafe-blr-01/orders", json=payload)
    assert res.status_code == 401
    assert "Missing café API key" in res.json()["detail"]

def test_order_ingestion_unauthorized_invalid_api_key(client):
    payload = {
        "id": str(uuid.uuid4()),
        "order_code": "ORD-UNAUTH-02",
        "payment_method": "CASH",
        "items": [{"menu_item_id": 1, "quantity": 1}]
    }
    res = client.post(
        "/api/v1/cafes/cafe-blr-01/orders",
        json=payload,
        headers={"X-Cafe-API-Key": "wrong-secret-key"}
    )
    assert res.status_code == 401
    assert "Invalid café API key" in res.json()["detail"]

# ==============================================================================
# 3. ATOMIC ORDER CREATION & UUID IDEMPOTENCY TESTS (NO DOUBLE STOCK DEDUCTION)
# ==============================================================================
def test_order_creation_atomic_and_idempotent(client, test_db):
    # Verify initial stock
    item = test_db.query(models.MenuItem).filter(models.MenuItem.id == 1).first()
    initial_stock = item.stock
    assert initial_stock == 30

    order_uuid = str(uuid.uuid4())
    order_code = f"ORD-{order_uuid[:8].upper()}"
    headers = {"X-Cafe-API-Key": "key-cafe-1-secret"}

    payload = {
        "id": order_uuid,
        "order_code": order_code,
        "customer_name": "Aditi Sharma",
        "payment_method": "UPI",
        "discount_paise": 0,
        "items": [
            {"menu_item_id": 1, "quantity": 3}
        ]
    }

    # 1. FIRST CALL: New Order -> Deducts 3 units of stock
    res1 = client.post("/api/v1/cafes/cafe-blr-01/orders", json=payload, headers=headers)
    assert res1.status_code == 201
    data1 = res1.json()
    assert data1["id"] == order_uuid
    assert data1["is_idempotent_replay"] is False
    assert data1["subtotal_paise"] == 36000  # 3 * 12000
    assert data1["tax_paise"] == 1800        # 5% of 36000
    assert data1["total_paise"] == 37800

    # Stock must now be decremented by 3
    test_db.refresh(item)
    assert item.stock == 27

    # Verify inventory movement was logged
    mov = test_db.query(models.InventoryMovement).filter(models.InventoryMovement.order_id == order_uuid).first()
    assert mov is not None
    assert mov.change_qty == -3
    assert mov.balance_after == 27

    # 2. SECOND CALL (REPLAY WITH SAME UUID): Returns committed order WITHOUT deducting stock again!
    res2 = client.post("/api/v1/cafes/cafe-blr-01/orders", json=payload, headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["id"] == order_uuid
    assert data2["is_idempotent_replay"] is True

    # Stock must STILL be 27 (NOT 24!)
    test_db.refresh(item)
    assert item.stock == 27

    # Count of inventory movements must still be 1 (no duplicate deductions)
    movements_count = test_db.query(models.InventoryMovement).filter(
        models.InventoryMovement.order_id == order_uuid
    ).count()
    assert movements_count == 1

def test_insufficient_stock_rollback_atomically(client, test_db):
    item = test_db.query(models.MenuItem).filter(models.MenuItem.id == 2).first()
    initial_stock = item.stock
    assert initial_stock == 10

    order_uuid = str(uuid.uuid4())
    headers = {"X-Cafe-API-Key": "key-cafe-1-secret"}

    # Attempt to order 50 units when only 10 are available
    payload = {
        "id": order_uuid,
        "order_code": "ORD-OVERSTOCK",
        "payment_method": "CASH",
        "items": [
            {"menu_item_id": 2, "quantity": 50}
        ]
    }

    res = client.post("/api/v1/cafes/cafe-blr-01/orders", json=payload, headers=headers)
    assert res.status_code == 400
    assert "Insufficient stock" in res.json()["detail"]

    # Stock must remain unaffected
    test_db.refresh(item)
    assert item.stock == initial_stock

    # No order should have been persisted
    order = test_db.query(models.Order).filter(models.Order.id == order_uuid).first()
    assert order is None

# ==============================================================================
# 4. OWNER AUTHORIZATION & CAFE OWNERSHIP VALIDATION TESTS
# ==============================================================================
def test_owner_dashboard_retrieval_and_paise_math(client):
    headers = {"Authorization": "Bearer token-owner-1"}
    res = client.get("/api/v1/owner/dashboard", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["owner_id"] == "usr-owner-001"
    assert data["total_cafes"] == 1
    assert "total_revenue_paise" in data
    assert "total_revenue_inr" in data

def test_unauthorized_dashboard_access_fails(client):
    # No auth header
    res = client.get("/api/v1/owner/dashboard")
    assert res.status_code == 401

    # Invalid token
    res2 = client.get("/api/v1/owner/dashboard", headers={"Authorization": "Bearer invalid-token"})
    assert res2.status_code == 401

def test_cafe_ownership_forbidden_access(client):
    # Owner 1 attempts to access single café dashboard for Mumbai café (owned by Owner 2)
    headers = {"Authorization": "Bearer token-owner-1"}
    res = client.get("/api/v1/cafes/cafe-mum-02/dashboard", headers=headers)
    assert res.status_code == 403
    assert "Access denied: You do not own café" in res.json()["detail"]

def test_cafe_ownership_allowed_access(client):
    # Owner 2 accesses their own Mumbai café dashboard
    headers = {"Authorization": "Bearer token-owner-2"}
    res = client.get("/api/v1/cafes/cafe-mum-02/dashboard", headers=headers)
    assert res.status_code == 200
    assert res.json()["cafe_id"] == "cafe-mum-02"

def test_admin_bypasses_ownership_check(client):
    # Admin can view any café
    headers = {"Authorization": "Bearer token-admin"}
    res = client.get("/api/v1/cafes/cafe-mum-02/dashboard", headers=headers)
    assert res.status_code == 200

# ==============================================================================
# 5. SYNC BATCH DEDUPLICATION TESTS
# ==============================================================================
def test_sync_event_deduplication(client):
    sync_uuid = f"sync-ev-{uuid.uuid4()}"
    batch_payload = {
        "cafe_id": "cafe-blr-01",
        "events": [
            {
                "sync_event_id": sync_uuid,
                "entity_type": "heartbeat",
                "action": "ping",
                "payload": {"terminal": "STATION-01", "status": "ACTIVE"}
            }
        ]
    }

    # First ingestion -> 1 processed, 0 duplicates
    res1 = client.post("/api/v1/sync/ingest", json=batch_payload)
    assert res1.status_code == 200
    assert res1.json()["processed_count"] == 1
    assert res1.json()["skipped_duplicates"] == 0

    # Second ingestion with same sync_event_id -> 0 processed, 1 duplicate
    res2 = client.post("/api/v1/sync/ingest", json=batch_payload)
    assert res2.status_code == 200
    assert res2.json()["processed_count"] == 0
    assert res2.json()["skipped_duplicates"] == 1
