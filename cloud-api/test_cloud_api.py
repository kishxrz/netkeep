"""
NetKeep Café — Cloud Central API Integration Test Suite
Validates health, branch listing, advance reservations, sync deduplication,
authenticated order ingestion from edge servers with UUID idempotency,
and owner dashboard analytics in integer paise.
"""

import sys
import uuid
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from main import app

CAFE_ID = "cafe-blr-01"
CAFE_API_KEY = "key-cafe-blr-01-secret"
OWNER_AUTH_TOKEN = "owner-secret-token-2026"

def test_cloud_health(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "HEALTHY"
    print("PASS: Cloud Health Check")

def test_branches_list(client):
    resp = client.get("/api/v1/branches")
    assert resp.status_code == 200
    branches = resp.json()
    assert len(branches) >= 2
    assert any(b["cafe_code"] == "CAFE-BLR-01" for b in branches)
    print(f"PASS: Cloud Cafés/Branches List ({len(branches)} active locations)")

def test_reservations_creation(client):
    res_payload = {
        "branch_code": "CAFE-BLR-01",
        "customer_name": "Test Cloud Gamer",
        "station_type": "VIP_GAMING",
        "reserved_for_time": (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat(),
        "duration_hours": 2
    }
    resp = client.post("/api/v1/reservations", json=res_payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "CONFIRMED"
    assert "RES-" in data["reservation_code"]
    print(f"PASS: Advance Seat Reservation ({data['reservation_code']})")

def test_idempotent_sync_ingestion(client):
    fixed_event_id = str(uuid.uuid4())
    sync_payload = {
        "cafe_id": "cafe-blr-01",
        "events": [
            {
                "sync_event_id": fixed_event_id,
                "entity_type": "SESSION",
                "action": "INSERT",
                "payload": {"session_code": "SES-DEMO1", "amount": 7.00}
            }
        ]
    }

    # First transmission: should process 1
    resp1 = client.post("/api/v1/sync/ingest", json=sync_payload)
    assert resp1.status_code == 200
    d1 = resp1.json()
    assert d1["processed_count"] == 1
    assert d1["skipped_duplicates"] == 0

    # Second transmission of the exact same event: should skip as duplicate (idempotency)
    resp2 = client.post("/api/v1/sync/ingest", json=sync_payload)
    assert resp2.status_code == 200
    d2 = resp2.json()
    assert d2["processed_count"] == 0
    assert d2["skipped_duplicates"] == 1
    print("PASS: Idempotent Sync Ingestion & Duplicate Deduplication")

def test_authenticated_order_ingestion_and_idempotency(client):
    order_uuid = str(uuid.uuid4())
    order_payload = {
        "id": order_uuid,
        "order_code": f"ORD-{order_uuid[:8].upper()}",
        "customer_name": "Arjun Singhania",
        "payment_method": "UPI",
        "discount_paise": 0,
        "items": [
            {"menu_item_id": 1, "quantity": 2}
        ]
    }
    headers = {"X-Cafe-API-Key": CAFE_API_KEY}

    # 1. New Order -> 201 Created
    resp1 = client.post(f"/api/v1/cafes/{CAFE_ID}/orders", json=order_payload, headers=headers)
    assert resp1.status_code == 201
    d1 = resp1.json()
    assert d1["id"] == order_uuid
    assert d1["total_paise"] == 25200  # (2 * 12000) * 1.05 = 25200
    assert d1["is_idempotent_replay"] is False

    # 2. Replay with exact same UUID -> 200 OK (Does not double-deduct stock or duplicate rows)
    resp2 = client.post(f"/api/v1/cafes/{CAFE_ID}/orders", json=order_payload, headers=headers)
    assert resp2.status_code == 200
    d2 = resp2.json()
    assert d2["id"] == order_uuid
    assert d2["is_idempotent_replay"] is True
    print("PASS: Authenticated Order Ingestion & Strict UUID Idempotency")

def test_owner_dashboard_and_ownership_check(client):
    owner_headers = {"Authorization": f"Bearer {OWNER_AUTH_TOKEN}"}

    # 1. Authorized Owner Dashboard
    resp = client.get("/api/v1/owner/dashboard", headers=owner_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["owner_id"] == "usr-owner-001"
    assert data["total_cafes"] >= 1
    assert data["total_revenue_paise"] > 0
    assert "₹" in data["total_revenue_inr"]

    # 2. Validated Single Café Dashboard
    resp_cafe = client.get(f"/api/v1/cafes/{CAFE_ID}/dashboard", headers=owner_headers)
    assert resp_cafe.status_code == 200
    assert resp_cafe.json()["cafe_id"] == CAFE_ID

    # 3. Ownership Violation -> 403 Forbidden
    resp_unauth = client.get("/api/v1/cafes/cafe-mum-02/dashboard", headers=owner_headers)
    assert resp_unauth.status_code == 403
    print("PASS: Owner Dashboard & Cafe Ownership Authorization Check")

def test_cloud_analytics(client):
    resp = client.get("/api/v1/analytics/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_branches"] >= 2
    assert data["total_network_stations"] >= 40
    print(f"PASS: Cloud Multi-Branch Analytics (Total Stations: {data['total_network_stations']})")

if __name__ == "__main__":
    print("=" * 65)
    print("  RUNNING NETKEEP CAFÉ CLOUD CENTRAL API INTEGRATION SUITE")
    print("=" * 65)
    try:
        with TestClient(app) as test_client:
            test_cloud_health(test_client)
            test_branches_list(test_client)
            test_reservations_creation(test_client)
            test_idempotent_sync_ingestion(test_client)
            test_authenticated_order_ingestion_and_idempotency(test_client)
            test_owner_dashboard_and_ownership_check(test_client)
            test_cloud_analytics(test_client)
        print("=" * 65)
        print("  ALL 7 CLOUD API INTEGRATION TESTS PASSED SUCCESSFULLY!")
        print("=" * 65)
    except AssertionError as e:
        print(f"TEST FAILED: {e}")
        sys.exit(1)
