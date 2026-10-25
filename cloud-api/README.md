# NetKeep Café — Cloud Central API (Supabase PostgreSQL + FastAPI)

The **NetKeep Café Cloud API** provides a centralized, multi-tenant cloud backend for fleet management, edge synchronization, inventory tracking, and owner analytics across multiple café locations.

---

## 1. Architectural Highlights

1. **Supabase PostgreSQL Schema**:
   - Comprehensive multi-tenant relational schema: `users`, `cafes`, `menu_items`, `orders`, `order_items`, `inventory_movements`, and `sync_events`.
   - Row Level Security (RLS) enabled on all tables.
2. **Integer Paise Financial Calculations**:
   - All prices, subtotals, taxes (5% GST), discounts, and totals are strictly stored as **integer paise** (`1 Rupee = 100 paise`), eliminating IEEE 754 floating-point rounding errors.
3. **Strict Order UUID Idempotency**:
   - Every order ingested from an edge café server carries a stable client-generated UUIDv4 (`Order.id`).
   - If a network drop causes the edge server to retry, the cloud API returns the committed order (HTTP 200) **without deducting stock twice or duplicating inventory movements**.
4. **Single-Transaction Stock Deductions**:
   - Stock deduction, inventory movement audit logging, order creation, and sync event ingestion execute within a single atomic database transaction.
   - Insufficient stock triggers an atomic rollback and returns HTTP 400.
5. **Cafe Ownership Authorization**:
   - Edge server authentication via `X-Cafe-API-Key`.
   - Owner dashboard authentication via Bearer token with strict ownership validation (an owner cannot access dashboards of cafés they do not own).
6. **Server-Side Only Supabase Service-Role Key**:
   - `SUPABASE_SERVICE_ROLE_KEY` is loaded strictly server-side and never exposed to clients.
7. **Zero-Configuration Local Fallback**:
   - If Supabase credentials are not configured, the API gracefully falls back to local SQLite (`sqlite:///./netkeep_cloud.db`) with automatic demo seeding.

---

## 2. Supabase PostgreSQL Setup Guide

### Step 1: Create a Supabase Project
1. Log in to [Supabase](https://supabase.com) and create a new project (e.g. `netkeep-cafe-cloud`).
2. Note your database password.

### Step 2: Apply SQL Migrations
1. Open the **SQL Editor** in your Supabase Dashboard.
2. Copy and run the contents of [`migrations/001_initial_schema.sql`](file:///c:/Users/Kishore/Desktop/netkeep/cloud-api/migrations/001_initial_schema.sql).
3. *(Optional)* Run [`migrations/002_seed_sample_data.sql`](file:///c:/Users/Kishore/Desktop/netkeep/cloud-api/migrations/002_seed_sample_data.sql) to populate initial demo owners, cafés, and menu items.

### Step 3: Configure Environment Variables
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. In Supabase Dashboard, go to **Project Settings -> Database -> Connection URI**.
3. Set your connection string in `.env`:
   ```env
   DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
   SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
   SUPABASE_SERVICE_ROLE_KEY=[YOUR-SERVICE-ROLE-KEY]
   ```

---

## 3. Local Development Mode (Without Supabase Credentials)

If Supabase credentials are not set, the server runs in **Local Development Mode**:
```bash
# Simply leave DATABASE_URL blank in .env or run without .env
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```
The server will log:
```
[DATABASE] Supabase DATABASE_URL not set. Running in local development mode with SQLite.
```
and automatically seed demo data for local testing.

### Default Seed Credentials for Local Testing:
- **Owner 1 (Bengaluru)**:
  - Token: `owner-secret-token-2026`
  - Owned Café: `CAFE-BLR-01` (`cafe-blr-01`)
  - Shared Edge API Key: `key-cafe-blr-01-secret`
- **Owner 2 (Mumbai)**:
  - Token: `mumbai-owner-token-2026`
  - Owned Café: `CAFE-MUM-02` (`cafe-mum-02`)
  - Shared Edge API Key: `key-cafe-mum-02-secret`
- **Administrator**:
  - Token: `admin-secret-token-2026` (Bypasses ownership checks)

---

## 4. API Endpoints Reference

### 4.1 Edge Café Order Ingestion
- `POST /api/v1/cafes/{cafe_id}/orders`:
  - **Headers**: `X-Cafe-API-Key: <api_key>`
  - **Body**:
    ```json
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "order_code": "ORD-A1B2C3D4",
      "customer_name": "Arjun Sharma",
      "payment_method": "UPI",
      "discount_paise": 0,
      "items": [
        {"menu_item_id": 1, "quantity": 2}
      ]
    }
    ```
  - **Status 201 Created**: Order committed, stock decremented, inventory movement logged.
  - **Status 200 OK**: Idempotent replay; returns existing order without deducting stock again.
  - **Status 400 Bad Request**: Insufficient stock or invalid items; transaction rolled back.
  - **Status 401 Unauthorized**: Missing or incorrect café API key.

### 4.2 Owner Dashboard & Multi-Branch Analytics
- `GET /api/v1/owner/dashboard`:
  - **Headers**: `Authorization: Bearer <owner_token>`
  - **Returns**: Aggregated metrics across all owned cafés (revenue in paise and formatted INR, low-stock alerts, top-selling items, recent orders).
- `GET /api/v1/cafes/{cafe_id}/dashboard`:
  - **Headers**: `Authorization: Bearer <owner_token>`
  - **Security**: Verifies that the caller owns `{cafe_id}`; returns 403 Forbidden otherwise.
- `GET /api/v1/cafes/{cafe_id}/inventory`:
  - **Headers**: `Authorization: Bearer <owner_token>`
  - **Returns**: Current menu items and live stock levels for the café.

### 4.3 Store-and-Forward Sync
- `POST /api/v1/sync/ingest`:
  - Receives batch sync events from edge servers; automatically deduplicates records by `sync_event_id`.

---

## 5. Running Automated Integration Tests

Run the comprehensive pytest test suite:
```bash
python -m pytest tests/test_cloud_api.py -v
```

Run the standalone integration script:
```bash
python test_cloud_api.py
```
Both test suites validate:
- Edge server LAN API key authentication
- Strict UUID idempotency (no double-stock deduction on network replay)
- Atomic rollback on insufficient stock
- Owner dashboard metrics in integer paise
- Café ownership validation (403 Forbidden on unauthorized access)
- Sync event deduplication
