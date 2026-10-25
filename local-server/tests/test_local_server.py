import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db, init_db
import models
from main import app
from config import settings

from sqlalchemy.pool import StaticPool

# Setup isolated in-memory SQLite database for testing with StaticPool
TEST_DATABASE_URL = "sqlite:///:memory:"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

# Override the database dependency in FastAPI app
app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="session", autouse=True)
def setup_test_database():
    """Initializes tables and seeds default menu items before test session."""
    init_db(engine_to_use=test_engine, seed=True)
    yield
    Base.metadata.drop_all(bind=test_engine)

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture
def auth_headers():
    return {"X-API-Key": settings.LAN_API_KEY}

# ==========================================
# 1. HEALTH ENDPOINT TESTS
# ==========================================
def test_health_endpoint_public(client):
    """GET /health must be accessible publicly on the LAN without authentication."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "HEALTHY"
    assert data["service"] == "local-server"
    assert data["mode"] == "offline-first"
    assert "timestamp" in data

def test_health_v1_alias(client):
    """GET /api/v1/health should provide compatibility."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "HEALTHY"

# ==========================================
# 2. LAN AUTHENTICATION TESTS
# ==========================================
def test_menu_unauthorized_without_key(client):
    """Protected endpoints must reject requests lacking LAN authentication."""
    response = client.get("/menu")
    assert response.status_code == 401
    assert "Invalid or missing LAN API authentication key" in response.json()["detail"]

def test_menu_unauthorized_with_wrong_key(client):
    """Protected endpoints must reject invalid keys."""
    response = client.get("/menu", headers={"X-API-Key": "invalid-secret-key"})
    assert response.status_code == 401

def test_menu_authorized_with_bearer_token(client):
    """Protected endpoints accept Authorization: Bearer <key>."""
    response = client.get("/menu", headers={"Authorization": f"Bearer {settings.LAN_API_KEY}"})
    assert response.status_code == 200
    assert isinstance(response.json(), list)

# ==========================================
# 3. MENU ENDPOINT TESTS
# ==========================================
def test_menu_listing(client, auth_headers):
    """GET /menu returns all available menu items in integer paise."""
    response = client.get("/menu", headers={**auth_headers})
    assert response.status_code == 200
    items = response.json()
    assert len(items) >= 10
    
    # Verify integer paise pricing on first item
    first = items[0]
    assert "sku" in first
    assert "price_paise" in first
    assert isinstance(first["price_paise"], int)
    assert first["price_paise"] > 0

def test_menu_category_filtering(client, auth_headers):
    """GET /menu?category=Coffee filters items accurately."""
    response = client.get("/menu?category=Coffee", headers=auth_headers)
    assert response.status_code == 200
    items = response.json()
    assert len(items) > 0
    assert all(i["category"] == "Coffee" for i in items)

# ==========================================
# 4. ORDER CREATION & ATOMIC TRANSACTION TESTS
# ==========================================
def test_create_order_single_transaction(client, auth_headers):
    """
    POST /orders creates order, order_items, inventory_movements,
    and decrements stock in a single atomic transaction.
    """
    # 1. Fetch current stock of COF-001 (Artisan Espresso)
    menu_resp = client.get("/menu", headers=auth_headers)
    espresso = next(i for i in menu_resp.json() if i["sku"] == "COF-001")
    initial_stock = espresso["stock"]
    item_id = espresso["id"]

    order_uuid = str(uuid.uuid4())
    order_payload = {
        "id": order_uuid,
        "order_code": "ORD-TEST01",
        "customer_name": "Arjun Mehta",
        "payment_method": "UPI",
        "discount_paise": 0,
        "notes": "Extra hot please",
        "items": [
            {"menu_item_id": item_id, "quantity": 2}
        ]
    }

    # 2. Submit order
    resp = client.post("/orders", json=order_payload, headers=auth_headers)
    assert resp.status_code == 201
    order_data = resp.json()
    assert order_data["id"] == order_uuid
    assert order_data["status"] == "PAID"
    assert order_data["subtotal_paise"] == espresso["price_paise"] * 2
    assert len(order_data["items"]) == 1
    assert order_data["items"][0]["quantity"] == 2

    # 3. Verify stock was decremented in database
    menu_resp_after = client.get("/menu", headers=auth_headers)
    espresso_after = next(i for i in menu_resp_after.json() if i["sku"] == "COF-001")
    assert espresso_after["stock"] == initial_stock - 2

    # 4. Verify inventory movement recorded
    db = TestingSessionLocal()
    try:
        movement = db.query(models.InventoryMovement).filter(
            models.InventoryMovement.reference_id == order_uuid
        ).first()
        assert movement is not None
        assert movement.movement_type == "ORDER_SALE"
        assert movement.quantity_delta == -2
        assert movement.stock_before == initial_stock
        assert movement.stock_after == initial_stock - 2

        # 5. Verify sync event created
        sync_event = db.query(models.SyncEvent).filter(
            models.SyncEvent.order_id == order_uuid
        ).first()
        assert sync_event is not None
        assert sync_event.sync_status == "PENDING"
    finally:
        db.close()

# ==========================================
# 5. IDEMPOTENCY TEST: REPEATING ORDER UUID
# ==========================================
def test_order_idempotency_does_not_deduct_stock_twice(client, auth_headers):
    """
    Submitting the exact same order UUID again MUST return the existing order
    WITHOUT deducting inventory a second time.
    """
    # 1. Fetch current stock
    menu_resp = client.get("/menu", headers=auth_headers)
    item = menu_resp.json()[0]
    stock_before_replay = item["stock"]
    item_id = item["id"]

    order_uuid = str(uuid.uuid4())
    order_payload = {
        "id": order_uuid,
        "order_code": "ORD-IDEMPOTENT-01",
        "customer_name": "Kavita Rao",
        "payment_method": "CASH",
        "items": [
            {"menu_item_id": item_id, "quantity": 1}
        ]
    }

    # 2. First submission (Creates order)
    resp1 = client.post("/orders", json=order_payload, headers=auth_headers)
    assert resp1.status_code == 201
    assert resp1.json()["is_idempotent_replay"] is False

    # Stock should be decremented by 1
    menu_resp1 = client.get("/menu", headers=auth_headers)
    item1 = next(i for i in menu_resp1.json() if i["id"] == item_id)
    assert item1["stock"] == stock_before_replay - 1

    # 3. Second submission with the EXACT SAME UUID (Idempotent replay)
    resp2 = client.post("/orders", json=order_payload, headers=auth_headers)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["id"] == order_uuid
    assert data2["is_idempotent_replay"] is True

    # 4. CRITICAL VERIFICATION: Stock must NOT be decremented again!
    menu_resp2 = client.get("/menu", headers=auth_headers)
    item2 = next(i for i in menu_resp2.json() if i["id"] == item_id)
    assert item2["stock"] == stock_before_replay - 1, "Stock was erroneously decremented twice!"

# ==========================================
# 6. INSUFFICIENT STOCK & TRANSACTION ROLLBACK
# ==========================================
def test_insufficient_stock_fails_atomically(client, auth_headers):
    """
    Attempting to order more units than in stock must raise HTTP 400
    and rollback without altering stock or creating partial records.
    """
    menu_resp = client.get("/menu", headers=auth_headers)
    item = menu_resp.json()[0]
    initial_stock = item["stock"]
    item_id = item["id"]

    excessive_uuid = str(uuid.uuid4())
    order_payload = {
        "id": excessive_uuid,
        "items": [
            {"menu_item_id": item_id, "quantity": initial_stock + 500} # Exceeds stock
        ]
    }

    resp = client.post("/orders", json=order_payload, headers=auth_headers)
    assert resp.status_code == 400
    assert "Insufficient stock" in resp.json()["detail"]

    # Verify stock is unchanged
    menu_resp_after = client.get("/menu", headers=auth_headers)
    item_after = next(i for i in menu_resp_after.json() if i["id"] == item_id)
    assert item_after["stock"] == initial_stock

    # Verify no order created
    db = TestingSessionLocal()
    try:
        assert db.query(models.Order).filter(models.Order.id == excessive_uuid).first() is None
    finally:
        db.close()

# ==========================================
# 7. INPUT VALIDATION TESTS
# ==========================================
def test_invalid_quantity_validation(client, auth_headers):
    """Quantity must be >= 1 (Pydantic schema validation)."""
    payload = {
        "id": str(uuid.uuid4()),
        "items": [
            {"menu_item_id": 1, "quantity": 0} # Invalid quantity 0
        ]
    }
    resp = client.post("/orders", json=payload, headers=auth_headers)
    assert resp.status_code == 422 # Pydantic validation error

def test_invalid_uuid_validation(client, auth_headers):
    """Order ID must be a valid UUID."""
    payload = {
        "id": "not-a-valid-uuid",
        "items": [{"menu_item_id": 1, "quantity": 1}]
    }
    resp = client.post("/orders", json=payload, headers=auth_headers)
    assert resp.status_code == 422

# ==========================================
# 8. ORDER HISTORY & SYNC STATUS TESTS
# ==========================================
def test_get_orders_history(client, auth_headers):
    """GET /orders returns recorded order history."""
    resp = client.get("/orders?limit=10", headers=auth_headers)
    assert resp.status_code == 200
    orders = resp.json()
    assert isinstance(orders, list)
    assert len(orders) >= 2

def test_sync_status_telemetry(client, auth_headers):
    """GET /sync/status returns sync telemetry and pending event counts."""
    resp = client.get("/sync/status", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "pending_sync_events" in data
    assert "synced_events" in data
    assert "total_orders_recorded" in data
    assert data["branch_id"] == settings.BRANCH_ID
