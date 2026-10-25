import Dexie, { Table } from 'dexie';
import {
  CachedMenuItem,
  LocalOrder,
  LocalOrderItem,
  OutboxEntry,
  SyncMetadata
} from './types';

// ==========================================
// DEXIE INDEXEDDB SCHEMA
// ==========================================
export class NetKeepCafeDB extends Dexie {
  menu_cache!: Table<CachedMenuItem, number>;
  orders!: Table<LocalOrder, string>;
  order_items!: Table<LocalOrderItem, number>;
  outbox!: Table<OutboxEntry, number>;
  sync_metadata!: Table<SyncMetadata, string>;

  constructor(databaseName = 'NetKeepCafeDB') {
    super(databaseName);

    // Primary and secondary indexed keys
    this.version(1).stores({
      menu_cache: '++id, &sku, name, category, is_available',
      orders: '&id, order_code, customer_name, status, created_at',
      order_items: '++id, order_id, menu_item_id',
      outbox: '++id, &order_id, status, created_at, next_retry_at',
      sync_metadata: '&key'
    });
  }
}

// Singleton database instance
export const db = new NetKeepCafeDB();

// ==========================================
// SAMPLE SEED DATA (Integer Paise)
// ==========================================
export const SAMPLE_MENU_ITEMS: CachedMenuItem[] = [
  {
    id: 1,
    sku: 'COF-001',
    name: 'Artisan Espresso',
    category: 'Coffee',
    price_paise: 18000,
    stock: 100,
    low_stock_threshold: 20,
    is_available: true,
    description: 'Double shot roasted Arabica blend with golden crema',
    updated_at: new Date().toISOString()
  },
  {
    id: 2,
    sku: 'COF-002',
    name: 'Caffè Americano',
    category: 'Coffee',
    price_paise: 20000,
    stock: 95,
    low_stock_threshold: 20,
    is_available: true,
    description: 'Rich espresso poured over steaming hot mineral water',
    updated_at: new Date().toISOString()
  },
  {
    id: 3,
    sku: 'COF-003',
    name: 'Velvet Cappuccino',
    category: 'Coffee',
    price_paise: 24000,
    stock: 80,
    low_stock_threshold: 15,
    is_available: true,
    description: 'Steamed whole milk and velvety microfoam over espresso',
    updated_at: new Date().toISOString()
  },
  {
    id: 4,
    sku: 'COF-004',
    name: 'Salted Caramel Latte',
    category: 'Coffee',
    price_paise: 28000,
    stock: 60,
    low_stock_threshold: 15,
    is_available: true,
    description: 'Rich artisanal caramel syrup with espresso & textured milk',
    updated_at: new Date().toISOString()
  },
  {
    id: 5,
    sku: 'COF-005',
    name: 'Cold Brew Reserve',
    category: 'Coffee',
    price_paise: 26000,
    stock: 45,
    low_stock_threshold: 10,
    is_available: true,
    description: 'Steeped for 18 hours, smooth chocolate and nutty notes',
    updated_at: new Date().toISOString()
  },
  {
    id: 6,
    sku: 'TEA-001',
    name: 'Japanese Iced Matcha Latte',
    category: 'Tea',
    price_paise: 29000,
    stock: 40,
    low_stock_threshold: 10,
    is_available: true,
    description: 'Ceremonial Uji matcha whisked with chilled oat milk',
    updated_at: new Date().toISOString()
  },
  {
    id: 7,
    sku: 'TEA-002',
    name: 'Earl Grey Supreme',
    category: 'Tea',
    price_paise: 19000,
    stock: 70,
    low_stock_threshold: 15,
    is_available: true,
    description: 'Black tea infused with Italian natural bergamot oil',
    updated_at: new Date().toISOString()
  },
  {
    id: 8,
    sku: 'BAK-001',
    name: 'Butter Flaky Croissant',
    category: 'Bakery',
    price_paise: 16000,
    stock: 25,
    low_stock_threshold: 8,
    is_available: true,
    description: 'French-style multi-layered golden butter pastry',
    updated_at: new Date().toISOString()
  },
  {
    id: 9,
    sku: 'BAK-002',
    name: 'Pain au Chocolat',
    category: 'Bakery',
    price_paise: 21000,
    stock: 20,
    low_stock_threshold: 6,
    is_available: true,
    description: 'Dark Belgian chocolate batons rolled in flaky pastry',
    updated_at: new Date().toISOString()
  },
  {
    id: 10,
    sku: 'FOD-001',
    name: 'Sourdough Avocado Toast',
    category: 'Food',
    price_paise: 38000,
    stock: 15,
    low_stock_threshold: 5,
    is_available: true,
    description: 'Smashed Haas avocado, pickled radish, chilli flakes',
    updated_at: new Date().toISOString()
  },
  {
    id: 11,
    sku: 'FOD-002',
    name: 'Truffle Grilled Cheese',
    category: 'Food',
    price_paise: 42000,
    stock: 12,
    low_stock_threshold: 4,
    is_available: true,
    description: 'Aged cheddar, gruyère and black truffle butter sourdough',
    updated_at: new Date().toISOString()
  },
  {
    id: 12,
    sku: 'DES-001',
    name: 'Basque Burnt Cheesecake',
    category: 'Desserts',
    price_paise: 32000,
    stock: 10,
    low_stock_threshold: 3,
    is_available: true,
    description: 'Caramelized burnt exterior with creamy custard center',
    updated_at: new Date().toISOString()
  }
];

let activeSeedingPromise: Promise<number> | null = null;

export async function seedMenuCacheIfEmpty(customDb: NetKeepCafeDB = db): Promise<number> {
  // If a seeding operation is already in progress for this singleton database, await it
  if (activeSeedingPromise && customDb === db) {
    return activeSeedingPromise;
  }

  const runSeeding = async (): Promise<number> => {
    try {
      return await customDb.transaction('rw', [customDb.menu_cache, customDb.sync_metadata], async () => {
        const count = await customDb.menu_cache.count();
        if (count === 0) {
          // Idempotent upsert checking existing SKUs to prevent ConstraintError
          for (const item of SAMPLE_MENU_ITEMS) {
            const existing = await customDb.menu_cache.where('sku').equals(item.sku).first();
            if (existing) {
              await customDb.menu_cache.put({ ...item, id: existing.id });
            } else {
              await customDb.menu_cache.put(item);
            }
          }
          await customDb.sync_metadata.put({
            key: 'last_menu_sync',
            value: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          return await customDb.menu_cache.count();
        }
        return count;
      });
    } catch (err) {
      console.warn("Notice during menu seeding:", err);
      return await customDb.menu_cache.count().catch(() => 0);
    } finally {
      if (customDb === db) {
        activeSeedingPromise = null;
      }
    }
  };

  if (customDb === db) {
    activeSeedingPromise = runSeeding();
    return activeSeedingPromise;
  }

  return runSeeding();
}

/**
 * Saves a complete order and its line items ATOMICALLY in IndexedDB
 * along with a durable outbox entry BEFORE attempting any network request.
 */
export async function saveOrderLocally(
  order: LocalOrder,
  items: Omit<LocalOrderItem, 'id'>[],
  outboxPayload: Record<string, unknown>,
  customDb: NetKeepCafeDB = db
): Promise<void> {
  await customDb.transaction(
    'rw',
    [customDb.orders, customDb.order_items, customDb.outbox, customDb.menu_cache],
    async () => {
      // 1. Add order with 'local_pending' status
      await customDb.orders.add(order);

      // 2. Add line items associated with this order's stable UUID
      await customDb.order_items.bulkAdd(items as LocalOrderItem[]);

      // 3. Add to durable sync outbox
      await customDb.outbox.add({
        order_id: order.id,
        payload_json: JSON.stringify(outboxPayload),
        status: 'pending',
        retry_count: 0,
        max_retries: 5,
        created_at: order.created_at
      });

      // 4. Atomically decrement local inventory in menu_cache
      for (const it of items) {
        const menuItem = await customDb.menu_cache.get(it.menu_item_id);
        if (menuItem) {
          const newStock = Math.max(0, menuItem.stock - it.quantity);
          await customDb.menu_cache.update(it.menu_item_id, {
            stock: newStock,
            is_available: newStock > 0,
            updated_at: new Date().toISOString()
          });
        }
      }
    }
  );
}

/**
 * Marks an order as 'synced' in IndexedDB.
 * CRITICAL RULE: Never mark an order synced without a server acknowledgment.
 */
export async function markOrderSynced(
  orderId: string,
  syncedAt: string,
  customDb: NetKeepCafeDB = db
): Promise<void> {
  await customDb.transaction('rw', [customDb.orders, customDb.outbox, customDb.sync_metadata], async () => {
    // 1. Update order status to synced
    await customDb.orders.update(orderId, {
      status: 'synced',
      synced_at: syncedAt,
      sync_error: undefined
    });

    // 2. Remove completed outbox record
    const outboxItem = await customDb.outbox.where('order_id').equals(orderId).first();
    if (outboxItem && outboxItem.id) {
      await customDb.outbox.delete(outboxItem.id);
    }

    // 3. Record last successful sync time
    await customDb.sync_metadata.put({
      key: 'last_successful_sync_time',
      value: syncedAt,
      updated_at: new Date().toISOString()
    });
  });
}

/**
 * Records a failure on an order and outbox record.
 * Distinguishes between transient retryable failures and permanent validation rejections.
 */
export async function markOrderSyncFailure(
  orderId: string,
  errorMessage: string,
  isPermanent: boolean,
  nextRetryAt?: string,
  customDb: NetKeepCafeDB = db
): Promise<void> {
  await customDb.transaction('rw', [customDb.orders, customDb.outbox], async () => {
    const outboxItem = await customDb.outbox.where('order_id').equals(orderId).first();
    if (outboxItem && outboxItem.id) {
      const newRetryCount = outboxItem.retry_count + 1;
      const status = isPermanent ? 'permanent_failure' : (newRetryCount >= outboxItem.max_retries ? 'failed' : 'pending');

      await customDb.outbox.update(outboxItem.id, {
        status,
        retry_count: newRetryCount,
        last_attempt: new Date().toISOString(),
        error_message: errorMessage,
        is_permanent_failure: isPermanent,
        next_retry_at: isPermanent ? undefined : nextRetryAt
      });
    }

    // Update order status: visible failed or local_pending with error
    await customDb.orders.update(orderId, {
      status: isPermanent ? 'failed' : 'local_pending',
      sync_error: errorMessage
    });
  });
}

/**
 * Retrieves the timestamp of the last successful sync.
 */
export async function getLastSuccessfulSyncTime(customDb: NetKeepCafeDB = db): Promise<string | null> {
  const meta = await customDb.sync_metadata.get('last_successful_sync_time');
  return meta ? meta.value : null;
}

/**
 * Retrieves an order along with its line items.
 */
export async function getOrderWithItems(
  orderId: string,
  customDb: NetKeepCafeDB = db
): Promise<(LocalOrder & { items: LocalOrderItem[] }) | null> {
  const order = await customDb.orders.get(orderId);
  if (!order) return null;
  const items = await customDb.order_items.where('order_id').equals(orderId).toArray();
  return { ...order, items };
}

/**
 * Retrieves all orders from IndexedDB with line items (newest first).
 */
export async function getAllOrdersWithItems(
  customDb: NetKeepCafeDB = db
): Promise<Array<LocalOrder & { items: LocalOrderItem[] }>> {
  const orders = await customDb.orders.orderBy('created_at').reverse().toArray();
  const results: Array<LocalOrder & { items: LocalOrderItem[] }> = [];

  for (const ord of orders) {
    const items = await customDb.order_items.where('order_id').equals(ord.id).toArray();
    results.push({ ...ord, items });
  }

  return results;
}
