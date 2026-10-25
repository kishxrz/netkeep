/**
 * NetKeep Café — TypeScript Data Types
 * All monetary values use integer paise (1 Rupee = 100 paise).
 */

export interface CachedMenuItem {
  id?: number;
  sku: string;
  name: string;
  category: string;
  price_paise: number; // Integer paise (e.g. ₹180.00 = 18000)
  stock: number;
  low_stock_threshold: number;
  is_available: boolean;
  description?: string;
  updated_at: string;
}

export type OrderStatus = 'local_pending' | 'synced' | 'failed';
export type OutboxStatus = 'pending' | 'in_flight' | 'failed' | 'permanent_failure';

export interface LocalOrder {
  id: string; // Stable UUIDv4 idempotency key
  order_code: string; // Human-friendly code (e.g. ORD-A1B2C3)
  customer_name: string;
  payment_method: 'CASH' | 'CARD' | 'UPI';
  subtotal_paise: number; // Integer paise
  tax_paise: number;      // Integer paise (5% GST)
  discount_paise: number; // Integer paise
  total_paise: number;    // Integer paise
  status: OrderStatus;    // 'local_pending' | 'synced' | 'failed'
  created_at: string;     // ISO timestamp
  synced_at?: string;     // ISO timestamp of server confirmation
  sync_error?: string;
  notes?: string;
}

export interface LocalOrderItem {
  id?: number;
  order_id: string; // Foreign key referencing LocalOrder.id (UUID)
  menu_item_id: number;
  item_name: string;
  unit_price_paise: number; // Integer paise
  quantity: number;
  subtotal_paise: number;   // Integer paise
}

export interface OutboxEntry {
  id?: number;
  order_id: string; // UUID referencing LocalOrder.id
  payload_json: string;
  status: OutboxStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at?: string; // ISO timestamp for exponential backoff
  created_at: string;
  last_attempt?: string;
  error_message?: string;
  is_permanent_failure?: boolean;
}

export interface SyncMetadata {
  key: string;
  value: string;
  updated_at: string;
}

export interface CartItem {
  item: CachedMenuItem;
  quantity: number;
}

export interface OrderTotals {
  subtotalPaise: number;
  taxPaise: number;
  discountPaise: number;
  totalPaise: number;
}

export interface ServerSyncAck {
  acknowledged: boolean;
  order_id: string;
  order_code: string;
  synced_at: string;
  is_idempotent_replay?: boolean;
  message?: string;
}
