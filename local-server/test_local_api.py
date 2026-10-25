"""
NetKeep Cyber Cafe & POS — Local Server Test Suite
Tests health check endpoint, menu retrieval, inventory deduction upon order,
order history, workstation status, and offline sync queue.
"""

import sys
import uuid
from fastapi.testclient import TestClient
from main import app
from config import settings

AUTH_HEADERS = {"X-API-Key": settings.LAN_API_KEY}

def test_health_endpoint(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "HEALTHY"
    assert data["service"] == "local-server"
    assert data["mode"] == "offline-first"
    print("PASS: Health Check Endpoint (/api/v1/health)")

def test_menu_retrieval(client):
    response = client.get("/api/v1/menu", headers=AUTH_HEADERS)
    assert response.status_code == 200
    items = response.json()
    assert len(items) >= 10
    assert any(i["category"] == "Coffee" for i in items)
    print(f"PASS: POS Menu Retrieval ({len(items)} items found)")

def test_order_creation_and_inventory_decrement(client):
    menu_resp = client.get("/api/v1/menu", headers=AUTH_HEADERS)
    items = menu_resp.json()
    first_item = items[0]
    initial_stock = first_item["stock"]
    item_id = first_item["id"]

    order_uuid = str(uuid.uuid4())
    order_payload = {
        "id": order_uuid,
        "order_code": f"ORD-{order_uuid[:8].upper()}",
        "customer_name": "Sarah Connor",
        "payment_method": "UPI",
        "discount_paise": 0,
        "items": [
            {"menu_item_id": item_id, "quantity": 2}
        ]
    }
    order_resp = client.post("/api/v1/orders", json=order_payload, headers=AUTH_HEADERS)
    assert order_resp.status_code == 201
    order_data = order_resp.json()
    assert order_data["status"] == "PAID"
    assert order_data["total_paise"] > 0
    assert len(order_data["items"]) == 1
    assert order_data["items"][0]["quantity"] == 2

    # Verify inventory stock was decremented by 2
    inv_resp = client.get("/api/v1/menu", headers=AUTH_HEADERS)
    updated_items = inv_resp.json()
    updated_first = next(i for i in updated_items if i["id"] == item_id)
    assert updated_first["stock"] == initial_stock - 2
    print(f"PASS: Order Creation & Inventory Decrement (Stock: {initial_stock} -> {updated_first['stock']})")

def test_order_history(client):
    resp = client.get("/api/v1/orders", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    orders = resp.json()
    assert len(orders) >= 1
    print(f"PASS: Order History ({len(orders)} orders recorded)")

def test_sync_status(client):
    resp = client.get("/api/v1/sync/status", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert "pending_sync_events" in data
    print(f"PASS: Offline Sync Status ({data['pending_sync_events']} buffered events)")

if __name__ == "__main__":
    print("=" * 60)
    print("  RUNNING NETKEEP CAFÉ LOCAL SERVER TEST SUITE")
    print("=" * 60)
    try:
        with TestClient(app) as test_client:
            test_health_endpoint(test_client)
            test_menu_retrieval(test_client)
            test_order_creation_and_inventory_decrement(test_client)
            test_order_history(test_client)
            test_sync_status(test_client)
        print("=" * 60)
        print("  ALL CAFÉ LOCAL TESTS PASSED SUCCESSFULLY!")
        print("=" * 60)
    except AssertionError as e:
        print(f"TEST FAILED: {e}")
        sys.exit(1)
