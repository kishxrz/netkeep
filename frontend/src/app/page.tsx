"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  db,
  seedMenuCacheIfEmpty,
  saveOrderLocally,
  getAllOrdersWithItems,
  getLastSuccessfulSyncTime
} from "../lib/db";
import {
  CachedMenuItem,
  CartItem,
  LocalOrder,
  LocalOrderItem
} from "../lib/types";
import {
  formatPaise,
  calculateOrderTotals,
  rupeesToPaise
} from "../lib/pricing";
import { syncOutboxOrders, manualRetryOrder } from "../lib/syncWorker";
import { getCloudApiUrl, getLocalApiUrl, getActiveApiUrl, getHealthCheckUrl } from "../lib/apiConfig";
import ReceiptModal from "../components/ReceiptModal";
import NetworkSyncStatus from "../components/NetworkSyncStatus";
function generateOrderUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function NetKeepCafePOS() {
  const LOCAL_API_URL = getLocalApiUrl();
  const CLOUD_API_URL = getCloudApiUrl();
  const API_URL = getActiveApiUrl();


  // Navigation State
  const [activeTab, setActiveTab] = useState<"pos" | "orders" | "inventory" | "network">("pos");

  // Menu & Cart State
  const [menuItems, setMenuItems] = useState<CachedMenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState<string>("Walk-in Customer");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD" | "UPI">("CASH");
  const [discountRupees, setDiscountRupees] = useState<number>(0);

  // Orders State (Read directly from IndexedDB)
  const [orders, setOrders] = useState<Array<LocalOrder & { items: LocalOrderItem[] }>>([]);
  const [orderFilter, setOrderFilter] = useState<"all" | "pending" | "synced" | "failed">("all");
  const [activeReceiptOrder, setActiveReceiptOrder] = useState<(LocalOrder & { items?: LocalOrderItem[] }) | null>(null);

  // Network & Sync State
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(false);
  const [backendLatency, setBackendLatency] = useState<number>(0);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3800);
  };

  // 1. Initialize Dexie IndexedDB & Seed Menu Cache
  const loadLocalDatabase = useCallback(async () => {
    try {
      await seedMenuCacheIfEmpty();
      const cached = await db.menu_cache.toArray();
      setMenuItems(cached);

      const localOrders = await getAllOrdersWithItems();
      setOrders(localOrders);

      const count = await db.outbox.count();
      setPendingSyncCount(count);

      const lastTime = await getLastSuccessfulSyncTime();
      setLastSyncTime(lastTime);
    } catch (err: unknown) {
      console.error("IndexedDB initialization error:", err);
    }
  }, []);

  // 2. Trigger Outbox Sync (Requires explicit server acknowledgment)
  const runSyncCycle = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await syncOutboxOrders(API_URL);
      if (result.syncedCount > 0) {
        showToast(` Synced ${result.syncedCount} order(s) with server acknowledgment!`);
        const updated = await getAllOrdersWithItems();
        setOrders(updated);
        const lastTime = await getLastSuccessfulSyncTime();
        setLastSyncTime(lastTime);
      }
      const count = await db.outbox.count();
      setPendingSyncCount(count);
    } catch (err: unknown) {
      console.warn("Sync cycle encountered error:", err);
    } finally {
      setIsSyncing(false);
    }
  }, [API_URL, isSyncing]);

  // 3. Health Check
  const checkHealth = useCallback(async () => {
    const start = performance.now();
    try {
      const healthUrl = getHealthCheckUrl(API_URL);
      const res = await fetch(healthUrl, { cache: "no-store" });
      if (res.ok) {
        setIsBackendOnline(true);
        setBackendLatency(Math.round(performance.now() - start));
        // Auto trigger outbox sync when server is reachable
        runSyncCycle();
      } else {
        setIsBackendOnline(false);
      }
    } catch {
      setIsBackendOnline(false);
    }
  }, [API_URL, runSyncCycle]);

  // 4. Manual Retry for a specific order
  const handleManualRetry = useCallback(async (orderId: string) => {
    showToast("Retrying order sync...");
    const success = await manualRetryOrder(orderId, API_URL);
    if (success) {
      showToast(" Order synchronized successfully!");
    } else {
      showToast("⚠️ Retry attempt failed. Order safely preserved in outbox.");
    }
    const updated = await getAllOrdersWithItems();
    setOrders(updated);
    const count = await db.outbox.count();
    setPendingSyncCount(count);
    const lastTime = await getLastSuccessfulSyncTime();
    setLastSyncTime(lastTime);
  }, [API_URL]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      await loadLocalDatabase();
      if (active) {
        await checkHealth();
      }
    };
    initialize();
    const interval = setInterval(checkHealth, 8000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [loadLocalDatabase, checkHealth]);

  // Cart operations
  const addToCart = (item: CachedMenuItem) => {
    if (item.stock <= 0) {
      showToast(`⚠️ ${item.name} is currently out of stock.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) {
        if (existing.quantity >= item.stock) {
          showToast(`Stock limit: only ${item.stock} available.`);
          return prev;
        }
        return prev.map((c) => (c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.item.id === itemId) {
            const newQ = c.quantity + delta;
            if (newQ > c.item.stock) {
              showToast(`Stock limit reached: ${c.item.stock} in stock.`);
              return c;
            }
            return { ...c, quantity: newQ };
          }
          return c;
        })
        .filter((c) => c.quantity > 0)
    );
  };

  const removeFromCart = (itemId: number) => {
    setCart((prev) => prev.filter((c) => c.item.id !== itemId));
  };

  const clearCart = () => setCart([]);

  // Calculate totals in integer paise
  const discountPaise = rupeesToPaise(discountRupees);
  const totals = calculateOrderTotals(
    cart.map((c) => ({ price_paise: c.item.price_paise, quantity: c.quantity })),
    discountPaise,
    5 // 5% tax
  );

  // CHECKOUT: Atomic IndexedDB save BEFORE any network attempt
  const handleCheckout = async () => {
    if (cart.length === 0) {
      showToast("Cart is empty.");
      return;
    }

    const orderId = generateOrderUUID();
    const orderCode = `ORD-${orderId.slice(0, 6).toUpperCase()}`;
    const nowIso = new Date().toISOString();

    const newOrder: LocalOrder = {
      id: orderId,
      order_code: orderCode,
      customer_name: customerName || "Walk-in Customer",
      payment_method: paymentMethod,
      subtotal_paise: totals.subtotalPaise,
      tax_paise: totals.taxPaise,
      discount_paise: totals.discountPaise,
      total_paise: totals.totalPaise,
      status: "local_pending", // Always starts local_pending
      created_at: nowIso
    };

    const orderItemsToSave: Omit<LocalOrderItem, "id">[] = cart.map((c) => ({
      order_id: orderId,
      menu_item_id: c.item.id!,
      item_name: c.item.name,
      unit_price_paise: c.item.price_paise,
      quantity: c.quantity,
      subtotal_paise: c.item.price_paise * c.quantity
    }));

    const outboxPayload = {
      id: orderId,
      order_code: orderCode,
      customer_name: newOrder.customer_name,
      payment_method: newOrder.payment_method,
      subtotal_paise: newOrder.subtotal_paise,
      tax_paise: newOrder.tax_paise,
      discount_paise: newOrder.discount_paise,
      total_paise: newOrder.total_paise,
      created_at: newOrder.created_at,
      items: orderItemsToSave
    };

    try {
      // 1. ATOMIC SAVE IN INDEXEDDB (orders + order_items + outbox + menu_cache stock)
      await saveOrderLocally(newOrder, orderItemsToSave, outboxPayload);

      // 2. Open Receipt Modal immediately with the persisted local order
      setActiveReceiptOrder({
        ...newOrder,
        items: orderItemsToSave as LocalOrderItem[]
      });

      // 3. Clear cart & update UI
      clearCart();
      const updatedMenu = await db.menu_cache.toArray();
      setMenuItems(updatedMenu);
      const updatedOrders = await getAllOrdersWithItems();
      setOrders(updatedOrders);
      const outboxList = await db.outbox.toArray();
      setPendingSyncCount(outboxList.length);

      showToast(` Order #${orderCode} saved to IndexedDB (local_pending)`);

      // 4. Background sync attempt (Never marks synced without server acknowledgment)
      if (isBackendOnline) {
        runSyncCycle();
      }
    } catch (err: unknown) {
      console.error("Local persistence error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(`Database error: ${errorMsg}`);
    }
  };

  // Adjust stock in IndexedDB
  const handleStockUpdate = async (item: CachedMenuItem, delta: number) => {
    const newStock = Math.max(0, item.stock + delta);
    await db.menu_cache.update(item.id!, {
      stock: newStock,
      is_available: newStock > 0,
      updated_at: new Date().toISOString()
    });
    const updated = await db.menu_cache.toArray();
    setMenuItems(updated);
    showToast(`Stock updated: ${item.name} = ${newStock}`);
  };

  // Filter menu
  const categories = ["All", "Coffee", "Tea", "Bakery", "Food", "Desserts"];
  const filteredMenu = menuItems.filter((item) => {
    const matchesCat = selectedCategory === "All" || item.category.toLowerCase() === selectedCategory.toLowerCase();
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Filter orders
  const filteredOrders = orders.filter((o) => {
    if (orderFilter === "pending") return o.status === "local_pending";
    if (orderFilter === "synced") return o.status === "synced";
    if (orderFilter === "failed") return o.status === "failed";
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Printable Receipt Modal */}
      <ReceiptModal order={activeReceiptOrder} onClose={() => setActiveReceiptOrder(null)} />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border border-emerald-500/60 text-emerald-300 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold flex items-center space-x-2 animate-in fade-in slide-in-from-top-3">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-emerald-500 flex items-center justify-center font-black text-slate-950 text-lg shadow-lg shadow-amber-500/20">
            NK
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold tracking-tight text-white">NetKeep Café</h1>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono font-bold border border-emerald-500/30">
                OFFLINE-FIRST POS
              </span>
            </div>
            <p className="text-xs text-slate-400">IndexedDB Persisted • Integer Paise Architecture</p>
          </div>
        </div>

        {/* Network & Dexie Outbox Status Pills */}
        <div className="flex items-center space-x-3 text-xs">
          {/* Edge Server Pill */}
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700">
            <span className={`w-2.5 h-2.5 rounded-full ${isBackendOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`} />
            <span className="text-slate-300">Server:</span>
            <span className={isBackendOnline ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
              {isBackendOnline ? `Online (${backendLatency}ms)` : "Offline (Local Dexie Mode)"}
            </span>
          </div>

          {/* Pending Outbox Sync Pill */}
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700">
            <span className={`w-2.5 h-2.5 rounded-full ${pendingSyncCount > 0 ? "bg-amber-400 animate-ping" : "bg-cyan-400"}`} />
            <span className="text-slate-300">Outbox:</span>
            <span className={pendingSyncCount > 0 ? "text-amber-400 font-bold" : "text-cyan-400 font-medium"}>
              {pendingSyncCount} Pending
            </span>
            {pendingSyncCount > 0 && (
              <button
                onClick={runSyncCycle}
                disabled={isSyncing}
                className="ml-1 text-slate-400 hover:text-white underline cursor-pointer text-[11px]"
              >
                {isSyncing ? "Syncing..." : "Sync Now"}
              </button>
            )}
          </div>

          {/* Last Successful Sync Time Pill */}
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700">
            <span className="text-slate-400">Last Sync:</span>
            <span className="text-emerald-400 font-mono font-medium">
              {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('en-IN') : "Never"}
            </span>
          </div>

          {/* Quick Refresh */}
          <button
            onClick={() => { checkHealth(); loadLocalDatabase(); }}
            title="Refresh local database & connectivity"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition cursor-pointer"
          >
            ↻
          </button>
        </div>
      </header>

      {/* NAVIGATION TABS */}
      <nav className="border-b border-slate-800 bg-slate-900/50 px-6 flex space-x-1">
        <button
          onClick={() => setActiveTab("pos")}
          className={`px-4 py-3 text-sm font-semibold border-b-2 transition flex items-center space-x-2 cursor-pointer ${
            activeTab === "pos"
              ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>☕ Menu & Cart (POS)</span>
          {cart.length > 0 && (
            <span className="ml-1 px-2 py-0.2 rounded-full bg-emerald-500 text-slate-950 text-xs font-bold">
              {cart.reduce((s, c) => s + c.quantity, 0)}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("orders")}
          className={`px-4 py-3 text-sm font-semibold border-b-2 transition flex items-center space-x-2 cursor-pointer ${
            activeTab === "orders"
              ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>📜 Order History</span>
          {pendingSyncCount > 0 ? (
            <span className="px-2 py-0.2 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/30">
              {pendingSyncCount} Pending
            </span>
          ) : (
            <span className="text-xs text-slate-500">({orders.length})</span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("inventory")}
          className={`px-4 py-3 text-sm font-semibold border-b-2 transition flex items-center space-x-2 cursor-pointer ${
            activeTab === "inventory"
              ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>📦 Inventory Tracking</span>
        </button>

        <button
          onClick={() => setActiveTab("network")}
          className={`px-4 py-3 text-sm font-semibold border-b-2 transition flex items-center space-x-2 cursor-pointer ${
            activeTab === "network"
              ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>🌐 Network & Sync Outbox</span>
        </button>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {/* ==================================================== */}
        {/* TAB 1: MENU & CART */}
        {/* ==================================================== */}
        {activeTab === "pos" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT: MENU ITEMS (Col 8) */}
            <div className="lg:col-span-8 space-y-4">
              {/* Category Pills & Search */}
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        selectedCategory === cat
                          ? "bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Search menu or SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-xs rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Menu Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {filteredMenu.map((item) => {
                  const inCart = cart.find((c) => c.item.id === item.id);
                  const isLow = item.stock > 0 && item.stock <= item.low_stock_threshold;
                  const isOut = item.stock <= 0;

                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col justify-between p-4 rounded-xl border bg-slate-900/80 transition hover:border-slate-600 ${
                        isOut ? "border-rose-900/50 opacity-60" : "border-slate-800"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-mono text-slate-500 uppercase">
                              {item.sku}
                            </span>
                            <h3 className="font-bold text-slate-100 text-sm leading-tight mt-0.5">
                              {item.name}
                            </h3>
                          </div>
                          <span className="text-emerald-400 font-mono font-bold text-sm bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 whitespace-nowrap">
                            {formatPaise(item.price_paise)}
                          </span>
                        </div>

                        {item.description && (
                          <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                        <div className="text-[11px] font-medium">
                          {isOut ? (
                            <span className="text-rose-400 font-semibold">Out of Stock</span>
                          ) : isLow ? (
                            <span className="text-amber-400 font-semibold">Only {item.stock} left</span>
                          ) : (
                            <span className="text-slate-400">{item.stock} in stock</span>
                          )}
                        </div>

                        <button
                          disabled={isOut}
                          onClick={() => addToCart(item)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                            isOut
                              ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                              : inCart
                              ? "bg-emerald-600 text-white hover:bg-emerald-500"
                              : "bg-slate-800 text-emerald-400 hover:bg-emerald-500 hover:text-slate-950 border border-slate-700"
                          }`}
                        >
                          {inCart ? `In Cart (${inCart.quantity})` : "+ Add"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredMenu.length === 0 && (
                <div className="p-12 text-center text-slate-500 border border-slate-800 rounded-xl bg-slate-900/40">
                  No menu items found.
                </div>
              )}
            </div>

            {/* RIGHT: CART SIDEBAR (Col 4) */}
            <div className="lg:col-span-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col space-y-4 sticky top-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-bold text-white uppercase tracking-wider">
                    Current Order
                  </span>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                    {cart.reduce((s, c) => s + c.quantity, 0)} items
                  </span>
                </div>
                {cart.length > 0 && (
                  <button
                    onClick={clearCart}
                    className="text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Customer Input */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Customer Name</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter name..."
                  className="w-full bg-slate-950 border border-slate-700 text-xs rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Payment Mode Selector */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["CASH", "CARD", "UPI"] as const).map((method) => (
                    <button
                      key={method}
                      onClick={() => setPaymentMethod(method)}
                      className={`py-2 text-xs font-bold rounded-lg border transition cursor-pointer ${
                        paymentMethod === method
                          ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20"
                          : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-600"
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>

                {/* Discount Quick Selector */}
                <div className="pt-2">
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                    Order Discount:
                  </label>
                  <div className="flex gap-2">
                    {[0, 20, 50, 100].map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setDiscountRupees(amt)}
                        className={`px-2.5 py-1 text-xs rounded border font-mono transition cursor-pointer ${
                          discountRupees === amt
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold"
                            : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-600"
                        }`}
                      >
                        {amt === 0 ? "None" : `₹${amt}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Cart Items List */}
              <div className="flex-1 max-h-64 overflow-y-auto space-y-2 pr-1 divide-y divide-slate-800/60">
                {cart.map(({ item, quantity }) => (
                  <div key={item.id} className="pt-2 flex items-center justify-between text-xs">
                    <div className="flex-1 pr-2">
                      <p className="font-semibold text-slate-200">{item.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {formatPaise(item.price_paise)} × {quantity} ={" "}
                        <span className="text-emerald-400 font-bold">
                          {formatPaise(item.price_paise * quantity)}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => updateQuantity(item.id!, -1)}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs cursor-pointer"
                      >
                        -
                      </button>
                      <span className="w-5 text-center font-mono text-xs font-bold">{quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id!, 1)}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs cursor-pointer"
                      >
                        +
                      </button>
                      <button
                        onClick={() => removeFromCart(item.id!)}
                        className="ml-1 text-slate-500 hover:text-rose-400 font-bold text-sm cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}

                {cart.length === 0 && (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    Cart is empty. Click &quot;+ Add&quot; on any menu item.
                  </div>
                )}
              </div>

              {/* Financial Totals Breakdown (Strict Integer Paise) */}
              <div className="pt-3 border-t border-slate-800 space-y-1.5 text-xs text-slate-400 font-mono">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="text-slate-200">{formatPaise(totals.subtotalPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span>GST Tax (5%):</span>
                  <span className="text-slate-200">{formatPaise(totals.taxPaise)}</span>
                </div>
                {totals.discountPaise > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Discount:</span>
                    <span>-{formatPaise(totals.discountPaise)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                  <span>Total Due:</span>
                  <span className="text-emerald-400 text-base">{formatPaise(totals.totalPaise)}</span>
                </div>
              </div>

              {/* Checkout Action Button */}
              <button
                disabled={cart.length === 0}
                onClick={handleCheckout}
                className={`w-full py-3 rounded-xl font-bold text-xs tracking-wider uppercase transition shadow-lg cursor-pointer ${
                  cart.length === 0
                    ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                    : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/25 active:scale-98"
                }`}
              >
                Checkout & Print Receipt ({formatPaise(totals.totalPaise)})
              </button>

              <div className="text-[11px] text-slate-500 text-center font-mono">
                Atomic Dexie persistence executes before network call.
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 2: ORDER HISTORY (IndexedDB Persisted Offline) */}
        {/* ==================================================== */}
        {activeTab === "orders" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white">Local Order History</h2>
                <p className="text-xs text-slate-400">
                  Reads directly from IndexedDB (`orders` + `order_items`). Fully usable offline.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {/* Filter buttons */}
                <div className="flex rounded-lg bg-slate-800 p-1 border border-slate-700 text-xs">
                  <button
                    onClick={() => setOrderFilter("all")}
                    className={`px-3 py-1 rounded font-medium cursor-pointer ${
                      orderFilter === "all" ? "bg-slate-700 text-white font-bold" : "text-slate-400"
                    }`}
                  >
                    All ({orders.length})
                  </button>
                  <button
                    onClick={() => setOrderFilter("pending")}
                    className={`px-3 py-1 rounded font-medium cursor-pointer ${
                      orderFilter === "pending" ? "bg-amber-500/20 text-amber-300 font-bold" : "text-slate-400"
                    }`}
                  >
                    Pending ({orders.filter((o) => o.status === "local_pending").length})
                  </button>
                  <button
                    onClick={() => setOrderFilter("synced")}
                    className={`px-3 py-1 rounded font-medium cursor-pointer ${
                      orderFilter === "synced" ? "bg-emerald-500/20 text-emerald-300 font-bold" : "text-slate-400"
                    }`}
                  >
                    Synced ({orders.filter((o) => o.status === "synced").length})
                  </button>
                  <button
                    onClick={() => setOrderFilter("failed")}
                    className={`px-3 py-1 rounded font-medium cursor-pointer ${
                      orderFilter === "failed" ? "bg-rose-500/20 text-rose-300 font-bold" : "text-slate-400"
                    }`}
                  >
                    Failed ({orders.filter((o) => o.status === "failed").length})
                  </button>
                </div>

                <button
                  onClick={runSyncCycle}
                  disabled={isSyncing}
                  className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-bold text-xs rounded-lg border border-emerald-500/30 transition cursor-pointer"
                >
                  {isSyncing ? "Syncing..." : "Sync Pending Orders"}
                </button>
              </div>
            </div>

            {/* Orders Table */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 uppercase text-[10px]">
                  <tr>
                    <th className="p-3.5">Order Code</th>
                    <th className="p-3.5">Customer</th>
                    <th className="p-3.5">Payment</th>
                    <th className="p-3.5">Items</th>
                    <th className="p-3.5">Total Amount</th>
                    <th className="p-3.5">Sync Status</th>
                    <th className="p-3.5">Timestamp</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredOrders.map((ord) => {
                    return (
                      <tr
                        key={ord.id}
                        className={`hover:bg-slate-800/50 transition ${
                          ord.status === "local_pending"
                            ? "bg-amber-500/[0.02]"
                            : ord.status === "failed"
                            ? "bg-rose-500/[0.04]"
                            : ""
                        }`}
                      >
                        <td className="p-3.5 font-bold text-emerald-400">
                          {ord.order_code}
                        </td>
                        <td className="p-3.5 text-slate-200 font-sans">{ord.customer_name}</td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] border border-slate-700">
                            {ord.payment_method}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-300">
                          {ord.items ? ord.items.reduce((s, i) => s + i.quantity, 0) : "-"} items
                        </td>
                        <td className="p-3.5 font-bold text-white text-sm">
                          {formatPaise(ord.total_paise)}
                        </td>
                        <td className="p-3.5">
                          {ord.status === "synced" && (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/30 text-[11px]">
                              <span>✓</span>
                              <span>Synced</span>
                            </span>
                          )}
                          {ord.status === "local_pending" && (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-bold border border-amber-500/30 text-[11px]">
                              <span>🕒</span>
                              <span>Local Pending</span>
                            </span>
                          )}
                          {ord.status === "failed" && (
                            <span
                              title={ord.sync_error || "Sync error"}
                              className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-bold border border-rose-500/30 text-[11px]"
                            >
                              <span>⚠</span>
                              <span>Failed</span>
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-slate-400 text-[11px]">
                          {new Date(ord.created_at).toLocaleTimeString('en-IN')}
                        </td>
                        <td className="p-3.5 text-right space-x-1.5">
                          {(ord.status === "local_pending" || ord.status === "failed") && (
                            <button
                              onClick={() => handleManualRetry(ord.id)}
                              disabled={isSyncing}
                              title="Manual retry order sync"
                              className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/30 cursor-pointer disabled:opacity-50"
                            >
                              🔄 Retry
                            </button>
                          )}
                          <button
                            onClick={() => setActiveReceiptOrder(ord)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 cursor-pointer"
                          >
                            Receipt
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-10 text-center text-slate-500 font-sans">
                        No orders matching the selected filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 3: INVENTORY */}
        {/* ==================================================== */}
        {activeTab === "inventory" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white">IndexedDB Cached Inventory</h2>
                <p className="text-xs text-slate-400">
                  Stock decrements atomically upon every local order checkout
                </p>
              </div>
              <span className="text-xs font-mono px-3 py-1 bg-slate-800 text-slate-300 rounded-lg border border-slate-700">
                {menuItems.length} SKUs in `menu_cache`
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 uppercase text-[10px]">
                  <tr>
                    <th className="p-3.5">SKU</th>
                    <th className="p-3.5">Item Name</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5">Unit Price (Paise)</th>
                    <th className="p-3.5">Stock Level</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Quick Restock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {menuItems.map((item) => {
                    const isLow = item.stock <= item.low_stock_threshold && item.stock > 0;
                    const isOut = item.stock <= 0;

                    return (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-3.5 text-slate-400">{item.sku}</td>
                        <td className="p-3.5 font-sans font-semibold text-slate-200">{item.name}</td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                            {item.category}
                          </span>
                        </td>
                        <td className="p-3.5 text-emerald-400 font-bold">
                          {formatPaise(item.price_paise)}
                        </td>
                        <td className="p-3.5 font-bold text-white text-sm">{item.stock}</td>
                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              isOut
                                ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                : isLow
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            }`}
                          >
                            {isOut ? "Out of Stock" : isLow ? "Low Stock" : "In Stock"}
                          </span>
                        </td>
                        <td className="p-3.5 text-right space-x-1.5">
                          <button
                            onClick={() => handleStockUpdate(item, -1)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 cursor-pointer"
                          >
                            -1
                          </button>
                          <button
                            onClick={() => handleStockUpdate(item, 10)}
                            className="px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] border border-emerald-500/20 font-bold cursor-pointer"
                          >
                            +10 Units
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 4: NETWORK & SYNC OUTBOX */}
        {/* ==================================================== */}
        {activeTab === "network" && (
          <NetworkSyncStatus onManualSyncTrigger={runSyncCycle} />
        )}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-3.5 text-center text-xs text-slate-500 font-mono">
        NetKeep Café POS • Offline-First Architecture • Dexie IndexedDB & FastAPI Local Server
      </footer>
    </div>
  );
}
