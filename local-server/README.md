# NetKeep Café — Local Edge Server (FastAPI + SQLite)

Production-grade, offline-first local management backend for cyber cafés and retail food & beverage operations. Designed to run on an on-premise edge machine (e.g., manager PC or Raspberry Pi/appliance) inside the cyber café local area network.

---

## 1. Relational Database Schema (`netkeep_local.db`)

Engineered with SQLite in **WAL (Write-Ahead Logging)** mode for high concurrency without database lockups:

| Table | Description | Key Columns |
|---|---|---|
| `menu_items` | Catalog of beverages, food & merchandise | `id`, `sku` (UNIQUE), `name`, `category`, `price_paise` (INT), `stock`, `low_stock_threshold`, `is_available` |
| `orders` | Completed & pending retail orders | `id` (UUID Primary Key), `order_code`, `customer_name`, `payment_method`, `subtotal_paise`, `tax_paise`, `total_paise`, `status` |
| `order_items` | Order line items with historical snapshot prices | `id`, `order_id` (FK `orders.id`), `menu_item_id` (FK `menu_items.id`), `quantity`, `unit_price_paise`, `subtotal_paise` |
| `inventory_movements` | Immutable audit ledger of all stock adjustments | `id`, `menu_item_id`, `movement_type` (`ORDER_SALE`, `RESTOCK`), `quantity_delta`, `stock_before`, `stock_after`, `reference_id` |
| `sync_events` | Store-and-forward queue for cloud sync | `id`, `event_uuid` (UUID), `order_id`, `event_type`, `payload_json`, `sync_status` (`PENDING`, `SYNCED`) |

---

## 2. API Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/health` (and `/api/v1/health`) | No (Public LAN) | Operational health check, database status, timestamp |
| `GET` | `/menu` (and `/api/v1/menu`) | Yes (`X-API-Key`) | Categorized café menu with integer paise prices |
| `POST` | `/orders` (and `/api/v1/orders`) | Yes (`X-API-Key`) | **Atomic idempotent order placement** with client UUID |
| `GET` | `/orders` (and `/api/v1/orders`) | Yes (`X-API-Key`) | Order history with line items |
| `GET` | `/sync/status` (and `/api/v1/sync/status`) | Yes (`X-API-Key`) | Pending offline outbox sync queue metrics |
| `POST` | `/pos/orders/sync` | Yes (`X-API-Key`) | Receives client Dexie sync and returns explicit server acknowledgment |

---

## 3. Single-Transaction Idempotency Guarantee

When `POST /orders` is called:
1. The server checks if an order with the client-generated UUID `id` already exists.
2. **If found**: Returns the existing order immediately with `is_idempotent_replay: true` **without deducting stock a second time**.
3. **If new**: Within a single atomic SQLite transaction:
   - Validates stock and line item quantities.
   - Creates the `orders` record.
   - Inserts all `order_items`.
   - Decrements `menu_items.stock`.
   - Appends audit records to `inventory_movements`.
   - Enqueues cloud payload to `sync_events`.
   - Commits the transaction or rolls back completely on any validation error.

---

## 4. LAN Authentication & Security Warning

> [!WARNING]
> **CRITICAL SECURITY NOTICE**
> This local server is intended strictly for trusted local area network (LAN) operations inside the cyber café (e.g. VLAN 10).
> **NEVER expose this server directly to the public internet** without:
> 1. A hardened reverse proxy (e.g. Nginx, Caddy, or Cloudflare Tunnel) enforcing TLS/HTTPS.
> 2. Cryptographically secure rotation of `LAN_API_KEY`.
> 3. Host-based firewall or router ACL limiting access strictly to authorized POS terminals.

### Client Authentication Headers
Include the configured LAN key in requests:
```http
X-API-Key: netkeep-pos-lan-key-2026
```
*Alternatively, use `Authorization: Bearer netkeep-pos-lan-key-2026`.*

---

## 5. Running the Tests & Server

### Run Pytest Test Suite (14 Tests)
```bash
python -m pytest tests/test_local_server.py -v
```

### Start the Server (Configurable Host & Port)
```bash
# Starts on http://0.0.0.0:8000
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Interactive Swagger Documentation: [http://localhost:8000/docs](http://localhost:8000/docs)
