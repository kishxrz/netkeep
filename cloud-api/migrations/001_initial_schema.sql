-- ==============================================================================
-- NetKeep Café — Supabase PostgreSQL Schema Migration
-- Migration: 001_initial_schema.sql
-- Description: Creates tables for multi-tenant café operations, inventory tracking,
--              strict order UUID idempotency, and offline store-and-forward sync.
--
-- FINANCIAL INVARIANT:
-- All monetary figures are stored in INTEGER PAISE (1 Rupee = 100 paise).
-- Never store currency as floating-point decimals.
-- ==============================================================================

-- Enable UUID extension if not already present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. USERS TABLE (Café Owners, Administrators, Managers)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email VARCHAR(128) NOT NULL UNIQUE,
    full_name VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'manager')),
    auth_token VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_auth_token ON users(auth_token);

-- ==============================================================================
-- 2. CAFES TABLE (Multi-Tenant Outlets)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS cafes (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    cafe_code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    city VARCHAR(64) NOT NULL,
    address VARCHAR(256),
    phone VARCHAR(32),
    owner_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    api_key VARCHAR(128) NOT NULL UNIQUE,
    total_stations INTEGER DEFAULT 16 CHECK (total_stations >= 0),
    edge_ip VARCHAR(45),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    last_ping TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cafes_owner_id ON cafes(owner_id);
CREATE INDEX IF NOT EXISTS idx_cafes_code ON cafes(cafe_code);
CREATE INDEX IF NOT EXISTS idx_cafes_api_key ON cafes(api_key);

-- ==============================================================================
-- 3. MENU ITEMS TABLE (Integer Paise Pricing & Stock)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY,
    cafe_id VARCHAR(36) NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
    sku VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
    stock INTEGER DEFAULT 0 NOT NULL CHECK (stock >= 0),
    low_stock_threshold INTEGER DEFAULT 5 NOT NULL CHECK (low_stock_threshold >= 0),
    is_available BOOLEAN DEFAULT TRUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_cafe_menu_sku UNIQUE (cafe_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_menu_items_cafe ON menu_items(cafe_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);

-- ==============================================================================
-- 4. ORDERS TABLE (Strict Client UUID Idempotency Key)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY, -- Client-generated UUIDv4 idempotency key
    cafe_id VARCHAR(36) NOT NULL REFERENCES cafes(id) ON DELETE RESTRICT,
    order_code VARCHAR(32) NOT NULL,
    customer_name VARCHAR(128) DEFAULT 'Walk-in Customer' NOT NULL,
    payment_method VARCHAR(32) DEFAULT 'CASH' NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'UPI')),
    subtotal_paise INTEGER NOT NULL CHECK (subtotal_paise >= 0),
    tax_paise INTEGER NOT NULL CHECK (tax_paise >= 0),
    discount_paise INTEGER DEFAULT 0 NOT NULL CHECK (discount_paise >= 0),
    total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
    status VARCHAR(32) DEFAULT 'PAID' NOT NULL CHECK (status IN ('PAID', 'CANCELLED', 'REFUNDED')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_cafe_id ON orders(cafe_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code);

-- ==============================================================================
-- 5. ORDER ITEMS TABLE (Line Items in Integer Paise)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
    item_name VARCHAR(128) NOT NULL,
    unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    subtotal_paise INTEGER NOT NULL CHECK (subtotal_paise >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu ON order_items(menu_item_id);

-- ==============================================================================
-- 6. INVENTORY MOVEMENTS TABLE (Audit Trail for Stock Deductions/Restocks)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS inventory_movements (
    id SERIAL PRIMARY KEY,
    cafe_id VARCHAR(36) NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
    order_id VARCHAR(36) REFERENCES orders(id) ON DELETE SET NULL,
    change_qty INTEGER NOT NULL,
    reason VARCHAR(64) NOT NULL CHECK (reason IN ('SALE', 'RESTOCK', 'ADJUSTMENT', 'DAMAGE')),
    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_cafe ON inventory_movements(cafe_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(menu_item_id);

-- ==============================================================================
-- 7. SYNC EVENTS TABLE (Store-and-Forward Deduplicated Ingestion Log)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS sync_events (
    id SERIAL PRIMARY KEY,
    cafe_id VARCHAR(36) NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
    sync_event_id VARCHAR(64) NOT NULL UNIQUE,
    entity_type VARCHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL,
    payload_json TEXT NOT NULL,
    status VARCHAR(32) DEFAULT 'PROCESSED' NOT NULL,
    ingested_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_events_cafe ON sync_events(cafe_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_uuid ON sync_events(sync_event_id);

-- ==============================================================================
-- 8. RESERVATIONS TABLE (Advance Gaming & Workstation Bookings)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS reservations (
    id SERIAL PRIMARY KEY,
    reservation_code VARCHAR(32) NOT NULL UNIQUE,
    cafe_id VARCHAR(36) REFERENCES cafes(id) ON DELETE SET NULL,
    customer_name VARCHAR(128) NOT NULL,
    station_type VARCHAR(32) DEFAULT 'VIP_GAMING' NOT NULL,
    reserved_for_time TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_hours INTEGER DEFAULT 2 NOT NULL CHECK (duration_hours > 0),
    status VARCHAR(32) DEFAULT 'CONFIRMED' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_cafe ON reservations(cafe_id);
CREATE INDEX IF NOT EXISTS idx_reservations_code ON reservations(reservation_code);

-- ==============================================================================
-- 9. SUPABASE ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cafes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Service Role Full Access (Used by FastAPI backend with SUPABASE_SERVICE_ROLE_KEY)
-- The backend authenticates requests via X-Cafe-API-Key and Bearer owner tokens.
CREATE POLICY "service_role_users" ON users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_cafes" ON cafes FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_menu" ON menu_items FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_orders" ON orders FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_order_items" ON order_items FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_inventory" ON inventory_movements FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_sync" ON sync_events FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_reservations" ON reservations FOR ALL USING (auth.role() = 'service_role');
