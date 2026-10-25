-- ==============================================================================
-- NetKeep Café — Supabase Seed Data Migration
-- Migration: 002_seed_sample_data.sql
-- Description: Seeds initial owner, café, and menu items with integer paise.
-- ==============================================================================

-- 1. Insert Owner User
INSERT INTO users (id, email, full_name, role, auth_token)
VALUES
    ('usr-owner-001', 'owner@netkeepcafe.com', 'Rajesh Sharma', 'owner', 'owner-secret-token-2026'),
    ('usr-owner-002', 'mumbai.owner@netkeepcafe.com', 'Vikram Mehta', 'owner', 'mumbai-owner-token-2026'),
    ('usr-admin-001', 'admin@netkeepcafe.com', 'Priya Patel', 'admin', 'admin-secret-token-2026')
ON CONFLICT (email) DO NOTHING;

-- 2. Insert Cafés
INSERT INTO cafes (id, cafe_code, name, city, address, phone, owner_id, api_key, total_stations, edge_ip, is_active)
VALUES
    (
        'cafe-blr-01',
        'CAFE-BLR-01',
        'NetKeep Arena — Indiranagar',
        'Bengaluru',
        '100 Feet Rd, Indiranagar, Bengaluru, KA',
        '+91 80 4123 4567',
        'usr-owner-001',
        'key-cafe-blr-01-secret',
        16,
        '192.168.10.10',
        TRUE
    ),
    (
        'cafe-mum-02',
        'CAFE-MUM-02',
        'NetKeep Lounge — Bandra West',
        'Mumbai',
        'Hill Road, Bandra West, Mumbai, MH',
        '+91 22 2640 1234',
        'usr-owner-002',
        'key-cafe-mum-02-secret',
        24,
        '192.168.10.10',
        TRUE
    )
ON CONFLICT (cafe_code) DO NOTHING;

-- 3. Insert Menu Items in Integer Paise
INSERT INTO menu_items (id, cafe_id, sku, name, category, price_paise, stock, low_stock_threshold, is_available, description)
VALUES
    (1, 'cafe-blr-01', 'CF-ESP-01', 'Espresso Doppio', 'Coffee', 12000, 50, 10, TRUE, 'Double shot of Arabica roast'),
    (2, 'cafe-blr-01', 'CF-CAP-02', 'Artisan Cappuccino', 'Coffee', 18000, 40, 8, TRUE, 'Velvety microfoam over espresso'),
    (3, 'cafe-blr-01', 'TE-MAS-01', 'Kullad Masala Chai', 'Tea', 6000, 60, 12, TRUE, 'Slow-brewed Assam tea with cardamom and ginger'),
    (4, 'cafe-blr-01', 'BK-CRO-01', 'Butter Croissant', 'Bakery', 14000, 25, 5, TRUE, 'French laminated butter pastry'),
    (5, 'cafe-blr-01', 'FD-SND-01', 'Chicken Tikka Panini', 'Food', 22000, 15, 4, TRUE, 'Grilled herb focaccia with tandoori chicken'),
    (6, 'cafe-blr-01', 'FD-MAG-01', 'Peri Peri Maggi Bowl', 'Food', 9000, 30, 5, TRUE, 'Spicy café-style Maggi noodles')
ON CONFLICT (cafe_id, sku) DO NOTHING;

-- 4. Advance Sequence to Prevent Duplicate Key Violations on Serial Columns
SELECT setval('menu_items_id_seq', COALESCE((SELECT MAX(id) FROM menu_items), 1));
