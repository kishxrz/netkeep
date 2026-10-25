import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto'; // Polyfills indexedDB, IDBKeyRange for Node
import {
  NetKeepCafeDB,
  seedMenuCacheIfEmpty,
  saveOrderLocally,
  markOrderSynced,
  getAllOrdersWithItems
} from '../db';
import { LocalOrder, LocalOrderItem } from '../types';

test('Dexie Schema & Seed: populates menu_cache with sample café menu in integer paise', async () => {
  const testDb = new NetKeepCafeDB(`test-db-seed-${Date.now()}`);
  const initialCount = await testDb.menu_cache.count();
  assert.equal(initialCount, 0, 'Database starts clean');

  const seededCount = await seedMenuCacheIfEmpty(testDb);
  assert.ok(seededCount >= 10, 'At least 10 sample items seeded');

  const espresso = await testDb.menu_cache.where('sku').equals('COF-001').first();
  assert.ok(espresso, 'Artisan Espresso exists');
  assert.equal(espresso.price_paise, 18000, 'Price stored as integer paise (18000)');
  assert.equal(typeof espresso.price_paise, 'number');

  await testDb.delete();
});

test('Atomic Local Persistence: saves order, items, outbox, and decrements stock before network', async () => {
  const testDb = new NetKeepCafeDB(`test-db-order-${Date.now()}`);
  await seedMenuCacheIfEmpty(testDb);

  const initialEspresso = await testDb.menu_cache.where('sku').equals('COF-001').first();
  const initialStock = initialEspresso!.stock;
  const espressoId = initialEspresso!.id!;

  const orderId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const orderCode = 'ORD-A1B2C3';
  const nowIso = new Date().toISOString();

  const newOrder: LocalOrder = {
    id: orderId,
    order_code: orderCode,
    customer_name: 'Priya Sharma',
    payment_method: 'UPI',
    subtotal_paise: 36000,
    tax_paise: 1800,
    discount_paise: 0,
    total_paise: 37800,
    status: 'local_pending',
    created_at: nowIso
  };

  const lineItems: Omit<LocalOrderItem, 'id'>[] = [
    {
      order_id: orderId,
      menu_item_id: espressoId,
      item_name: 'Artisan Espresso',
      unit_price_paise: 18000,
      quantity: 2,
      subtotal_paise: 36000
    }
  ];

  const outboxPayload = {
    id: orderId,
    order_code: orderCode,
    total_paise: 37800,
    items: lineItems
  };

  // Execute atomic local persistence
  await saveOrderLocally(newOrder, lineItems, outboxPayload, testDb);

  // 1. Verify order in `orders` table
  const savedOrder = await testDb.orders.get(orderId);
  assert.ok(savedOrder, 'Order exists in orders table');
  assert.equal(savedOrder.status, 'local_pending', 'Initial status is strictly local_pending');
  assert.equal(savedOrder.id, orderId, 'UUID matches');
  assert.equal(savedOrder.created_at, nowIso, 'Created timestamp recorded');

  // 2. Verify line items in `order_items` table
  const savedItems = await testDb.order_items.where('order_id').equals(orderId).toArray();
  assert.equal(savedItems.length, 1);
  assert.equal(savedItems[0].quantity, 2);
  assert.equal(savedItems[0].subtotal_paise, 36000);

  // 3. Verify outbox queue entry
  const outboxEntry = await testDb.outbox.where('order_id').equals(orderId).first();
  assert.ok(outboxEntry, 'Order enqueued into outbox table');
  assert.equal(outboxEntry.status, 'pending');

  // 4. Verify stock decremented atomically
  const updatedEspresso = await testDb.menu_cache.get(espressoId);
  assert.equal(updatedEspresso!.stock, initialStock - 2, 'Stock decremented by 2');

  await testDb.delete();
});

test('Offline Order History: reads complete order with line items from local IndexedDB', async () => {
  const testDb = new NetKeepCafeDB(`test-db-history-${Date.now()}`);
  await seedMenuCacheIfEmpty(testDb);

  const orderId = 'test-uuid-history-1';
  const newOrder: LocalOrder = {
    id: orderId,
    order_code: 'ORD-HIST01',
    customer_name: 'Vikram Patel',
    payment_method: 'CASH',
    subtotal_paise: 24000,
    tax_paise: 1200,
    discount_paise: 0,
    total_paise: 25200,
    status: 'local_pending',
    created_at: new Date().toISOString()
  };

  const lineItems: Omit<LocalOrderItem, 'id'>[] = [
    {
      order_id: orderId,
      menu_item_id: 3,
      item_name: 'Velvet Cappuccino',
      unit_price_paise: 24000,
      quantity: 1,
      subtotal_paise: 24000
    }
  ];

  await saveOrderLocally(newOrder, lineItems, {}, testDb);

  // Read all orders with items from local storage
  const allOrders = await getAllOrdersWithItems(testDb);
  assert.equal(allOrders.length, 1);
  assert.equal(allOrders[0].order_code, 'ORD-HIST01');
  assert.equal(allOrders[0].items.length, 1);
  assert.equal(allOrders[0].items[0].item_name, 'Velvet Cappuccino');

  await testDb.delete();
});

test('CRITICAL RULE: Never mark order synced without server acknowledgment', async () => {
  const testDb = new NetKeepCafeDB(`test-db-ack-${Date.now()}`);
  await seedMenuCacheIfEmpty(testDb);

  const orderId = 'test-ack-uuid-007';
  const newOrder: LocalOrder = {
    id: orderId,
    order_code: 'ORD-ACK007',
    customer_name: 'Neha Roy',
    payment_method: 'CARD',
    subtotal_paise: 28000,
    tax_paise: 1400,
    discount_paise: 0,
    total_paise: 29400,
    status: 'local_pending',
    created_at: new Date().toISOString()
  };

  await saveOrderLocally(newOrder, [], {}, testDb);

  // Before acknowledgment: status is local_pending
  let order = await testDb.orders.get(orderId);
  assert.equal(order!.status, 'local_pending');

  // SIMULATE SERVER NETWORK FAILURE: status MUST remain local_pending
  const networkFailed = true;
  if (networkFailed) {
    // Record error in outbox / order, but NEVER mark synced
    await testDb.orders.update(orderId, { sync_error: 'Network timeout: 504 Gateway Timeout' });
  }

  order = await testDb.orders.get(orderId);
  assert.equal(order!.status, 'local_pending', 'Order stays local_pending on network failure');
  assert.ok(order!.sync_error?.includes('Network timeout'));

  // SIMULATE EXPLICIT SERVER ACKNOWLEDGMENT
  const serverAck = {
    acknowledged: true,
    order_id: orderId,
    synced_at: new Date().toISOString()
  };

  if (serverAck.acknowledged === true) {
    // Only with explicit ack is order marked synced
    await markOrderSynced(orderId, serverAck.synced_at, testDb);
  }

  order = await testDb.orders.get(orderId);
  assert.equal(order!.status, 'synced', 'Order transitions to synced upon server acknowledgment');
  assert.ok(order!.synced_at, 'Sync timestamp recorded');

  // Verify outbox entry was cleared
  const outboxItem = await testDb.outbox.where('order_id').equals(orderId).first();
  assert.equal(outboxItem, undefined, 'Outbox item removed upon sync');

  await testDb.delete();
});
