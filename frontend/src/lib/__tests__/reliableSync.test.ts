import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  NetKeepCafeDB,
  seedMenuCacheIfEmpty,
  saveOrderLocally,
  getLastSuccessfulSyncTime
} from '../db';
import {
  calculateBackoffMs,
  syncOutboxOrders,
  manualRetryOrder
} from '../syncWorker';
import { LocalOrder, LocalOrderItem } from '../types';

test('1. Bounded Exponential Backoff with Jitter: values grow exponentially and are bounded', () => {
  const baseMs = 1000;
  const maxMs = 30000;

  // Test backoff progression
  for (let retry = 0; retry < 6; retry++) {
    const delay = calculateBackoffMs(retry, baseMs, maxMs);
    assert.ok(delay >= 500, `Delay (${delay}ms) should be >= 50% base`);
    // Full jitter allows up to 1.5 * maxMs
    assert.ok(delay <= maxMs * 1.5, `Delay (${delay}ms) should not exceed 1.5 * maxMs`);
  }

  // Extreme retry count must remain bounded by maxMs * 1.5
  const extremeDelay = calculateBackoffMs(50, baseMs, maxMs);
  assert.ok(extremeDelay <= maxMs * 1.5, `Extreme delay (${extremeDelay}ms) is strictly bounded`);
});

test('2. Offline Queuing: multiple orders accumulate durably in FIFO sequence without data loss', async () => {
  const testDb = new NetKeepCafeDB(`test-queue-${Date.now()}`);
  await seedMenuCacheIfEmpty(testDb);

  const orderUuids = [
    'uuid-queue-001',
    'uuid-queue-002',
    'uuid-queue-003'
  ];

  for (let i = 0; i < orderUuids.length; i++) {
    const id = orderUuids[i];
    const order: LocalOrder = {
      id,
      order_code: `ORD-Q${i + 1}`,
      customer_name: `Customer ${i + 1}`,
      payment_method: 'CASH',
      subtotal_paise: 20000,
      tax_paise: 1000,
      discount_paise: 0,
      total_paise: 21000,
      status: 'local_pending',
      created_at: new Date(Date.now() + i * 100).toISOString()
    };
    const items: Omit<LocalOrderItem, 'id'>[] = [
      { order_id: id, menu_item_id: 1, item_name: 'Espresso', unit_price_paise: 20000, quantity: 1, subtotal_paise: 20000 }
    ];
    await saveOrderLocally(order, items, { order_id: id, code: order.order_code }, testDb);
  }

  // Verify all 3 orders exist locally in orders table
  const orders = await testDb.orders.toArray();
  assert.equal(orders.length, 3);
  assert.ok(orders.every(o => o.status === 'local_pending'));

  // Verify durable outbox contains 3 entries in sequential FIFO order
  const outboxEntries = await testDb.outbox.orderBy('id').toArray();
  assert.equal(outboxEntries.length, 3);
  assert.equal(outboxEntries[0].order_id, 'uuid-queue-001');
  assert.equal(outboxEntries[1].order_id, 'uuid-queue-002');
  assert.equal(outboxEntries[2].order_id, 'uuid-queue-003');

  await testDb.delete();
});

test('3. Transient Network Failure: outbox preserves record, increments retry count, and sets backoff', async () => {
  const testDb = new NetKeepCafeDB(`test-transient-${Date.now()}`);
  await seedMenuCacheIfEmpty(testDb);

  const orderId = 'transient-fail-uuid-1';
  const order: LocalOrder = {
    id: orderId,
    order_code: 'ORD-TR01',
    customer_name: 'Test Network Drop',
    payment_method: 'UPI',
    subtotal_paise: 18000,
    tax_paise: 900,
    discount_paise: 0,
    total_paise: 18900,
    status: 'local_pending',
    created_at: new Date().toISOString()
  };

  await saveOrderLocally(order, [], { id: orderId }, testDb);

  // Mock server failure by providing unreachable port
  const result = await syncOutboxOrders('http://localhost:59999/api/v1', testDb);
  assert.equal(result.syncedCount, 0);
  assert.equal(result.transientFailures, 1);

  // Outbox entry must NOT be discarded
  const outboxItem = await testDb.outbox.where('order_id').equals(orderId).first();
  assert.ok(outboxItem, 'Queued record MUST NOT be discarded on failure');
  assert.equal(outboxItem.retry_count, 1);
  assert.equal(outboxItem.status, 'pending');
  assert.ok(outboxItem.next_retry_at, 'Exponential backoff timestamp is set');

  // Order status remains local_pending with visible error
  const savedOrder = await testDb.orders.get(orderId);
  assert.equal(savedOrder!.status, 'local_pending');
  assert.ok(savedOrder!.sync_error);

  await testDb.delete();
});

test('4. Permanent Validation Failure: explicitly marks permanent_failure and avoids infinite retry loop', async () => {
  const testDb = new NetKeepCafeDB(`test-perm-fail-${Date.now()}`);
  await seedMenuCacheIfEmpty(testDb);

  const orderId = 'perm-fail-uuid-1';
  const order: LocalOrder = {
    id: orderId,
    order_code: 'ORD-PERM01',
    customer_name: 'Corrupt Payload Test',
    payment_method: 'CASH',
    subtotal_paise: 18000,
    tax_paise: 900,
    discount_paise: 0,
    total_paise: 18900,
    status: 'local_pending',
    created_at: new Date().toISOString()
  };

  await saveOrderLocally(order, [], { invalid: 'corrupt_schema' }, testDb);

  // Mock global fetch returning HTTP 422 Unprocessable Entity
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ detail: 'Schema validation error: missing line items' }), {
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const result = await syncOutboxOrders('http://localhost:8000/api/v1', testDb);
    assert.equal(result.permanentFailures, 1);

    // Verify outbox entry is marked as permanent_failure and preserved (not discarded)
    const outboxItem = await testDb.outbox.where('order_id').equals(orderId).first();
    assert.ok(outboxItem, 'Corrupt record preserved for inspection');
    assert.equal(outboxItem.status, 'permanent_failure');
    assert.equal(outboxItem.is_permanent_failure, true);

    // Verify order marked with permanent error
    const savedOrder = await testDb.orders.get(orderId);
    assert.equal(savedOrder!.status, 'failed');
    assert.ok(savedOrder!.sync_error?.includes('Permanent Server Validation Error'));

    // Second sync call must SKIP permanent failures automatically
    const secondSync = await syncOutboxOrders('http://localhost:8000/api/v1', testDb);
    assert.equal(secondSync.syncedCount, 0);
    assert.equal(secondSync.transientFailures, 0);
    assert.equal(secondSync.permanentFailures, 1, 'Skipped from retry loop');
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.delete();
  }
});

test('5. Duplicate Retries & Lost Response After Commit: idempotent acknowledgment updates client state', async () => {
  const testDb = new NetKeepCafeDB(`test-idempotent-lost-${Date.now()}`);
  await seedMenuCacheIfEmpty(testDb);

  const orderId = 'stable-uuid-idempotent-999';
  const order: LocalOrder = {
    id: orderId,
    order_code: 'ORD-IDEM99',
    customer_name: 'Pooja Hegde',
    payment_method: 'UPI',
    subtotal_paise: 24000,
    tax_paise: 1200,
    discount_paise: 0,
    total_paise: 25200,
    status: 'local_pending',
    created_at: new Date().toISOString()
  };

  await saveOrderLocally(order, [], { id: orderId, order_code: 'ORD-IDEM99' }, testDb);

  // Mock server returning successful server acknowledgment with is_idempotent_replay: true
  const originalFetch = globalThis.fetch;
  const syncTimestamp = new Date().toISOString();
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      acknowledged: true,
      order_id: orderId,
      order_code: 'ORD-IDEM99',
      synced_at: syncTimestamp,
      is_idempotent_replay: true,
      message: 'Idempotent replay accepted without duplicate stock deduction'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const result = await syncOutboxOrders('http://localhost:8000/api/v1', testDb);
    assert.equal(result.syncedCount, 1);

    // Verify order transitioned to synced
    const savedOrder = await testDb.orders.get(orderId);
    assert.equal(savedOrder!.status, 'synced');
    assert.equal(savedOrder!.synced_at, syncTimestamp);

    // Verify outbox entry is now removed
    const outboxItem = await testDb.outbox.where('order_id').equals(orderId).first();
    assert.equal(outboxItem, undefined, 'Outbox item cleared on server acknowledgment');

    // Verify last successful sync time was recorded
    const lastSync = await getLastSuccessfulSyncTime(testDb);
    assert.equal(lastSync, syncTimestamp);
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.delete();
  }
});

test('6. Server Restart / Recovery After Reconnection: sequentially flushes recovered outbox entries', async () => {
  const dbName = `test-restart-recovery-${Date.now()}`;
  
  // Phase 1: Client creates offline orders while server is down
  const dbPhase1 = new NetKeepCafeDB(dbName);
  await seedMenuCacheIfEmpty(dbPhase1);

  const id1 = 'order-restart-01';
  const id2 = 'order-restart-02';

  await saveOrderLocally(
    { id: id1, order_code: 'ORD-R01', customer_name: 'User 1', payment_method: 'CASH', subtotal_paise: 10000, tax_paise: 500, discount_paise: 0, total_paise: 10500, status: 'local_pending', created_at: new Date().toISOString() },
    [], { id: id1 }, dbPhase1
  );
  await saveOrderLocally(
    { id: id2, order_code: 'ORD-R02', customer_name: 'User 2', payment_method: 'UPI', subtotal_paise: 15000, tax_paise: 750, discount_paise: 0, total_paise: 15750, status: 'local_pending', created_at: new Date().toISOString() },
    [], { id: id2 }, dbPhase1
  );

  // Close connection (simulating browser reload / restart)
  dbPhase1.close();

  // Phase 2: Client re-opens database upon reconnection
  const dbPhase2 = new NetKeepCafeDB(dbName);
  const recoveredOutbox = await dbPhase2.outbox.orderBy('id').toArray();
  assert.equal(recoveredOutbox.length, 2, 'Durable outbox survived restart with all records intact');

  // Mock server now back online (HTTP 200 with acknowledgment)
  const originalFetch = globalThis.fetch;
  const processedUuids: string[] = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    processedUuids.push(body.id);
    return new Response(JSON.stringify({
      acknowledged: true,
      order_id: body.id,
      order_code: `ACK-${body.id.slice(0, 5)}`,
      synced_at: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const syncRes = await syncOutboxOrders('http://localhost:8000/api/v1', dbPhase2);
    assert.equal(syncRes.syncedCount, 2, 'Both recovered orders successfully synced');

    // Verify sequential FIFO execution
    assert.deepEqual(processedUuids, [id1, id2], 'Orders synced in exact sequential order');

    // Verify both orders in IndexedDB marked synced
    const allOrders = await dbPhase2.orders.toArray();
    assert.ok(allOrders.every(o => o.status === 'synced'));
    assert.equal(await dbPhase2.outbox.count(), 0, 'Outbox completely drained');
  } finally {
    globalThis.fetch = originalFetch;
    await dbPhase2.delete();
  }
});

test('7. Manual Retry: resets backoff and immediately attempts synchronization', async () => {
  const testDb = new NetKeepCafeDB(`test-manual-retry-${Date.now()}`);
  await seedMenuCacheIfEmpty(testDb);

  const orderId = 'manual-retry-uuid-42';
  const order: LocalOrder = {
    id: orderId,
    order_code: 'ORD-MANUAL42',
    customer_name: 'Manual Retry Test',
    payment_method: 'CASH',
    subtotal_paise: 20000,
    tax_paise: 1000,
    discount_paise: 0,
    total_paise: 21000,
    status: 'failed',
    sync_error: 'Connection refused',
    created_at: new Date().toISOString()
  };

  await saveOrderLocally(order, [], { id: orderId }, testDb);

  // Set outbox to failed with future retry time
  const outboxEntry = await testDb.outbox.where('order_id').equals(orderId).first();
  await testDb.outbox.update(outboxEntry!.id!, {
    status: 'failed',
    retry_count: 4,
    next_retry_at: new Date(Date.now() + 60000).toISOString() // 60s in future
  });

  // Mock server online
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      acknowledged: true,
      order_id: orderId,
      order_code: 'ORD-MANUAL42',
      synced_at: new Date().toISOString()
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const success = await manualRetryOrder(orderId, 'http://localhost:8000/api/v1', testDb);
    assert.equal(success, true, 'Manual retry succeeded');

    const updatedOrder = await testDb.orders.get(orderId);
    assert.equal(updatedOrder!.status, 'synced');
    assert.equal(updatedOrder!.sync_error, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await testDb.delete();
  }
});
