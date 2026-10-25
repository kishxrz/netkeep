/**
 * NetKeep Café — Reliable Outbox Sync Worker
 * Features:
 * - Sequential FIFO processing with stable UUID idempotency keys
 * - Bounded retries with exponential backoff and full jitter
 * - Explicit categorization of transient failures vs permanent validation rejections
 * - Durable outbox preservation: queued records are NEVER discarded on failure
 * - Server acknowledgment requirement before transitioning to 'synced'
 * - Manual retry capability for failed or pending entries
 */

import { db, markOrderSynced, markOrderSyncFailure, NetKeepCafeDB } from './db';
import { ServerSyncAck } from './types';

export interface SyncResult {
  totalQueue: number;
  syncedCount: number;
  transientFailures: number;
  permanentFailures: number;
  skippedBackoff: number;
  errors: string[];
}

/**
 * Calculates bounded exponential backoff with full jitter to avoid thundering herd.
 * Formula: min(maxMs, baseMs * 2^retryCount) * (0.5 + Math.random())
 */
export function calculateBackoffMs(
  retryCount: number,
  baseMs: number = 1000,
  maxMs: number = 30000
): number {
  const safeCount = Math.max(0, retryCount);
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, safeCount));
  // Full jitter: uniformly random between 50% and 150% of calculated exponential
  const jitterFactor = 0.5 + Math.random();
  return Math.round(exponential * jitterFactor);
}

const TERMINAL_AUTH_KEY_STORAGE = 'netkeep_pos_terminal_key';

/**
 * Retrieves the local POS terminal authorization key without baking secrets into bundles.
 * Checks sessionStorage first (per-session cashier auth), then localStorage (persisted terminal provisioning).
 * On localhost in development, provides a safe local fallback if not yet set in browser storage.
 */
export function getTerminalAuthKey(): string {
  if (typeof window === 'undefined') {
    // In server/node test runtimes, allow process.env.LAN_API_KEY if present
    return process.env.LAN_API_KEY || '';
  }

  const stored = window.sessionStorage?.getItem(TERMINAL_AUTH_KEY_STORAGE) ||
                 window.localStorage?.getItem(TERMINAL_AUTH_KEY_STORAGE);
  if (stored) return stored;

  // Safe developer default exclusively for localhost development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'netkeep-pos-lan-key-2026';
  }

  return '';
}

export function setTerminalAuthKey(key: string, persist: boolean = true): void {
  if (typeof window === 'undefined') return;
  if (persist) {
    window.localStorage?.setItem(TERMINAL_AUTH_KEY_STORAGE, key);
  } else {
    window.sessionStorage?.setItem(TERMINAL_AUTH_KEY_STORAGE, key);
  }
}

export function clearTerminalAuthKey(): void {
  if (typeof window === 'undefined') return;
  window.localStorage?.removeItem(TERMINAL_AUTH_KEY_STORAGE);
  window.sessionStorage?.removeItem(TERMINAL_AUTH_KEY_STORAGE);
}

/**
 * Sequentially synchronizes pending outbox orders to the server.
 */
export async function syncOutboxOrders(
  serverApiUrl: string,
  customDb: NetKeepCafeDB = db,
  apiKey?: string
): Promise<SyncResult> {
  const effectiveKey = apiKey !== undefined ? apiKey : getTerminalAuthKey();

  // Read durable outbox in FIFO order (by id / created_at)
  const queue = await customDb.outbox.orderBy('id').toArray();

  const result: SyncResult = {
    totalQueue: queue.length,
    syncedCount: 0,
    transientFailures: 0,
    permanentFailures: 0,
    skippedBackoff: 0,
    errors: []
  };

  if (queue.length === 0) {
    return result;
  }

  const now = new Date();

  // Process sequentially to preserve causal ordering
  for (const entry of queue) {
    // 1. Skip permanent validation failures from automatic retry loop
    if (entry.status === 'permanent_failure') {
      result.permanentFailures++;
      continue;
    }

    // 2. Check exponential backoff window
    if (entry.next_retry_at && new Date(entry.next_retry_at) > now) {
      result.skippedBackoff++;
      continue;
    }

    // 3. Mark in_flight in durable outbox
    await customDb.outbox.update(entry.id!, {
      status: 'in_flight',
      last_attempt: now.toISOString()
    });

    try {
      const payload = JSON.parse(entry.payload_json);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Client-Sync': 'NetKeep-Dexie'
      };
      if (effectiveKey) {
        headers['X-API-Key'] = effectiveKey;
        headers['Authorization'] = `Bearer ${effectiveKey}`;
      }

      const response = await fetch(`${serverApiUrl}/pos/orders/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      // 4. Handle HTTP Response
      if (response.ok) {
        const ack: ServerSyncAck = await response.json();

        // VALIDATE EXPLICIT SERVER ACKNOWLEDGMENT
        if (ack && ack.acknowledged === true) {
          const syncedTimestamp = ack.synced_at || new Date().toISOString();
          await markOrderSynced(entry.order_id, syncedTimestamp, customDb);
          result.syncedCount++;
        } else {
          throw new Error('Server returned 200 but omitted explicit acknowledgment flag.');
        }
      } else {
        // Handle Server Error Responses
        let errorDetail = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errJson = await response.json();
          if (errJson.detail) errorDetail = String(errJson.detail);
        } catch {}

        // AUTHENTICATION ERROR (401 Unauthorized)
        if (response.status === 401) {
          const authMsg = `Local Server Authentication Error (401): ${errorDetail}. Configure Station Key.`;
          await markOrderSyncFailure(entry.order_id, authMsg, false, undefined, customDb);
          result.transientFailures++;
          result.errors.push(`Order ${entry.order_id.slice(0, 8)}: ${authMsg}`);
          continue;
        }

        // PERMANENT VALIDATION FAILURES (Client format error, invalid schema, rejected permanently)
        if (response.status === 400 || response.status === 422) {
          const permanentMsg = `Permanent Server Validation Error (${response.status}): ${errorDetail}`;
          await markOrderSyncFailure(entry.order_id, permanentMsg, true, undefined, customDb);
          result.permanentFailures++;
          result.errors.push(`Order ${entry.order_id.slice(0, 8)}: ${permanentMsg}`);
        } else {
          // TRANSIENT FAILURES (5xx, 408 Timeout, 429 Rate Limit)
          throw new Error(`Transient Server Error (${response.status}): ${errorDetail}`);
        }
      }
    } catch (err: unknown) {
      // Handle Network Exceptions & Transient Errors
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isTransient = !errorMsg.includes('Permanent Server Validation');
      if (isTransient) {
        const backoffMs = calculateBackoffMs(entry.retry_count);
        const nextRetryIso = new Date(Date.now() + backoffMs).toISOString();

        await markOrderSyncFailure(entry.order_id, errorMsg, false, nextRetryIso, customDb);
        result.transientFailures++;
        result.errors.push(`Order ${entry.order_id.slice(0, 8)}: ${errorMsg} (Next retry in ${Math.round(backoffMs / 1000)}s)`);
      }
    }
  }

  return result;
}

/**
 * Manually retries a specific order, resetting retry count and bypassing backoff timers.
 */
export async function manualRetryOrder(
  orderId: string,
  serverApiUrl: string,
  customDb: NetKeepCafeDB = db,
  apiKey?: string
): Promise<boolean> {
  const effectiveKey = apiKey !== undefined ? apiKey : getTerminalAuthKey();
  const outboxItem = await customDb.outbox.where('order_id').equals(orderId).first();
  if (!outboxItem) return false;

  // Reset outbox state to pending and clear backoff
  await customDb.outbox.update(outboxItem.id!, {
    status: 'pending',
    retry_count: 0,
    next_retry_at: undefined,
    error_message: undefined,
    is_permanent_failure: false
  });

  await customDb.orders.update(orderId, {
    status: 'local_pending',
    sync_error: undefined
  });

  // Attempt sync immediately
  try {
    const payload = JSON.parse(outboxItem.payload_json);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Sync': 'NetKeep-Dexie'
    };
    if (effectiveKey) {
      headers['X-API-Key'] = effectiveKey;
      headers['Authorization'] = `Bearer ${effectiveKey}`;
    }

    const response = await fetch(`${serverApiUrl}/pos/orders/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const ack: ServerSyncAck = await response.json();
      if (ack && ack.acknowledged === true) {
        await markOrderSynced(orderId, ack.synced_at || new Date().toISOString(), customDb);
        return true;
      }
    }

    let detail = `HTTP ${response.status}`;
    try {
      const j = await response.json();
      if (j.detail) detail = String(j.detail);
    } catch {}

    const isPermanent = response.status === 400 || response.status === 422;
    await markOrderSyncFailure(orderId, detail, isPermanent, undefined, customDb);
    return false;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const backoffMs = calculateBackoffMs(0);
    const nextRetry = new Date(Date.now() + backoffMs).toISOString();
    await markOrderSyncFailure(orderId, errorMsg, false, nextRetry, customDb);
    return false;
  }
}
