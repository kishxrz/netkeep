"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { db, getLastSuccessfulSyncTime } from "../lib/db";
import { OutboxEntry } from "../lib/types";
import { syncOutboxOrders, manualRetryOrder } from "../lib/syncWorker";
import { getCloudApiUrl, getLocalApiUrl, getActiveApiUrl, getHealthCheckUrl } from "../lib/apiConfig";

interface ServiceHealth {
  status: "checking" | "online" | "offline" | "error";
  latencyMs: number | null;
  statusCode?: number;
  message?: string;
  endpoint: string;
  lastChecked: Date | null;
}

interface NetworkSyncStatusProps {
  onManualSyncTrigger?: () => Promise<void>;
}

export default function NetworkSyncStatus({ onManualSyncTrigger }: NetworkSyncStatusProps) {
  const LOCAL_API_URL = getLocalApiUrl();
  const CLOUD_API_URL = getCloudApiUrl();

  // Real Service Health States
  const [localHealth, setLocalHealth] = useState<ServiceHealth>({
    status: "checking",
    latencyMs: null,
    endpoint: LOCAL_API_URL ? getHealthCheckUrl(LOCAL_API_URL) : "Unconfigured",
    lastChecked: null
  });

  const [cloudHealth, setCloudHealth] = useState<ServiceHealth>({
    status: "checking",
    latencyMs: null,
    endpoint: CLOUD_API_URL ? getHealthCheckUrl(CLOUD_API_URL) : "Unconfigured",
    lastChecked: null
  });

  // Hardware NIC status (navigator.onLine)
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Sync Telemetry States
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [outboxRecords, setOutboxRecords] = useState<OutboxEntry[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [failedCount, setFailedCount] = useState<number>(0);
  const [syncedCount, setSyncedCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Guided Demo Mode States
  const [isDemoModeOpen, setIsDemoModeOpen] = useState<boolean>(false);
  const [simulatedLanFailure, setSimulatedLanFailure] = useState<boolean>(false);
  const [simulatedCloudFailure, setSimulatedCloudFailure] = useState<boolean>(false);

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 4000);
  };

  // 1. Monitor Browser Network Interface Card (NIC)
  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 2. Load Local IndexedDB Sync Telemetry
  const refreshSyncTelemetry = useCallback(async () => {
    try {
      const records = await db.outbox.reverse().toArray();
      setOutboxRecords(records);

      const pending = records.filter((r) => r.status === "pending" || r.status === "in_flight").length;
      const failed = records.filter((r) => r.status === "failed" || r.status === "permanent_failure").length;
      setPendingCount(pending);
      setFailedCount(failed);

      const syncedOrders = await db.orders.where("status").equals("synced").count();
      setSyncedCount(syncedOrders);

      const lastTime = await getLastSuccessfulSyncTime();
      setLastSyncTime(lastTime);
    } catch (err) {
      console.warn("Error reading IndexedDB telemetry:", err);
    }
  }, []);

  // 3. Probe Local Server Health (Active HTTP Probe)
  const probeLocalServer = useCallback(async () => {
    if (!LOCAL_API_URL) {
      setLocalHealth({
        status: "offline",
        latencyMs: null,
        statusCode: 0,
        message: "LAN Server unconfigured (Operating in Cloud-Direct mode)",
        endpoint: "Not configured",
        lastChecked: new Date()
      });
      return;
    }

    const healthUrl = getHealthCheckUrl(LOCAL_API_URL);

    if (simulatedLanFailure) {
      setLocalHealth({
        status: "offline",
        latencyMs: null,
        statusCode: 0,
        message: "SIMULATED OUTAGE: Edge server disconnected via Demo Mode sandbox",
        endpoint: healthUrl,
        lastChecked: new Date()
      });
      return;
    }

    const start = performance.now();
    try {
      const res = await fetch(healthUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(3500)
      });
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setLocalHealth({
          status: "online",
          latencyMs: latency,
          statusCode: res.status,
          message: data.mode ? `FastAPI Edge Server (${data.mode})` : "HTTP 200 OK — Healthy",
          endpoint: healthUrl,
          lastChecked: new Date()
        });
      } else {
        setLocalHealth({
          status: "error",
          latencyMs: latency,
          statusCode: res.status,
          message: `HTTP ${res.status} ${res.statusText}`,
          endpoint: healthUrl,
          lastChecked: new Date()
        });
      }
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      setLocalHealth({
        status: "offline",
        latencyMs: null,
        statusCode: 0,
        message: isTimeout ? "Connection Timed Out (>3500ms)" : "LAN Edge Server Unreachable",
        endpoint: healthUrl,
        lastChecked: new Date()
      });
    }
  }, [LOCAL_API_URL, simulatedLanFailure]);

  // 4. Probe Cloud API Health (Active Probe — Never only navigator.onLine)
  const probeCloudServer = useCallback(async () => {
    if (!CLOUD_API_URL) {
      setCloudHealth({
        status: "offline",
        latencyMs: null,
        statusCode: 0,
        message: "Cloud API endpoint unconfigured",
        endpoint: "Not configured",
        lastChecked: new Date()
      });
      return;
    }

    const healthUrl = getHealthCheckUrl(CLOUD_API_URL);

    if (simulatedCloudFailure) {
      setCloudHealth({
        status: "offline",
        latencyMs: null,
        statusCode: 0,
        message: "SIMULATED OUTAGE: WAN/Internet drop simulated via Demo Mode",
        endpoint: healthUrl,
        lastChecked: new Date()
      });
      return;
    }

    const start = performance.now();
    try {
      const res = await fetch(healthUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000)
      });
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setCloudHealth({
          status: "online",
          latencyMs: latency,
          statusCode: res.status,
          message: data.database ? `Supabase Cloud (${data.database})` : "HTTP 200 OK — Cloud Connected",
          endpoint: healthUrl,
          lastChecked: new Date()
        });
      } else {
        setCloudHealth({
          status: "error",
          latencyMs: latency,
          statusCode: res.status,
          message: `HTTP ${res.status} ${res.statusText}`,
          endpoint: healthUrl,
          lastChecked: new Date()
        });
      }
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      setCloudHealth({
        status: "offline",
        latencyMs: null,
        statusCode: 0,
        message: isTimeout ? "WAN Timeout (>4000ms)" : "Cloud Central API Unreachable (WAN Offline)",
        endpoint: healthUrl,
        lastChecked: new Date()
      });
    }
  }, [CLOUD_API_URL, simulatedCloudFailure]);

  // 5. Polling Loop at a Modest Interval (Every 10 seconds)
  useEffect(() => {
    const probeAll = () => {
      probeLocalServer();
      probeCloudServer();
      refreshSyncTelemetry();
    };

    probeAll();
    const interval = setInterval(probeAll, 10000);
    return () => clearInterval(interval);
  }, [probeLocalServer, probeCloudServer, refreshSyncTelemetry]);

  // 6. Calculate Current Architecture Operational Mode
  const operationalMode = useMemo(() => {
    const isLocalUp = localHealth.status === "online";
    const isCloudUp = cloudHealth.status === "online";

    if (isLocalUp && isCloudUp) {
      return {
        title: "Full Multi-Branch Sync Mode",
        badge: "FULL SYNC ACTIVE",
        badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
        description: "Both on-premise edge server and central Supabase cloud are active. Instant order synchronization and multi-branch analytics are operational.",
        accent: "border-emerald-500/40 shadow-emerald-500/5"
      };
    }
    if (isLocalUp && !isCloudUp) {
      return {
        title: "Autonomous Local LAN Mode",
        badge: "LOCAL AUTONOMOUS MODE",
        badgeColor: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
        description: "Cloud API/WAN is offline, but the local on-premise server is healthy. Zero interruption for cafe sales; all transactions are buffered in local SQLite WAL outbox.",
        accent: "border-cyan-500/40 shadow-cyan-500/5"
      };
    }
    if (!isLocalUp && !isCloudUp) {
      return {
        title: "Air-Gapped Offline POS Mode",
        badge: "AIR-GAPPED OFFLINE",
        badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/30",
        description: "Both local server and cloud are unreachable. The client browser is operating in resilient IndexedDB mode. Orders, stock debits, and outbox records persist locally in Dexie.",
        accent: "border-amber-500/40 shadow-amber-500/5"
      };
    }
    return {
      title: "Cloud Direct Mode (Local Edge Down)",
      badge: "LAN EDGE DEGRADED",
      badgeColor: "bg-rose-500/10 text-rose-400 border-rose-500/30",
      description: "Cloud is reachable over internet, but the on-premise local server is offline. Check on-premise gateway or local server process.",
      accent: "border-rose-500/40 shadow-rose-500/5"
    };
  }, [localHealth.status, cloudHealth.status]);

  // Handle Flush Action
  const handleFlushNow = async () => {
    setIsSyncing(true);
    showNotice("Flushing pending outbox records to server...");
    try {
      if (onManualSyncTrigger) {
        await onManualSyncTrigger();
      } else {
        const targetSyncUrl = getActiveApiUrl();
        const result = await syncOutboxOrders(targetSyncUrl);
        showNotice(`Sync cycle complete: Synced ${result.syncedCount} record(s).`);
      }
      await refreshSyncTelemetry();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotice(`Sync error: ${msg}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle Individual Event Retry
  const handleEventRetry = async (orderId: string) => {
    showNotice(`Attempting sync retry for order ${orderId.slice(0, 8)}...`);
    const targetSyncUrl = getActiveApiUrl();
    const ok = await manualRetryOrder(orderId, targetSyncUrl);
    if (ok) {
      showNotice("✓ Order successfully synchronized with server acknowledgment!");
    } else {
      showNotice("⚠️ Retry attempt failed. Record remains preserved in outbox.");
    }
    await refreshSyncTelemetry();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Accessible Live Region */}
      <div className="sr-only" aria-live="polite" role="status">
        {`Local server status is ${localHealth.status}. Cloud API status is ${cloudHealth.status}. Operational mode is ${operationalMode.title}.`}
      </div>

      {/* Floating Action Notice */}
      {actionNotice && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-emerald-500/60 text-emerald-300 px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-3">
          <span>ℹ</span>
          <span>{actionNotice}</span>
        </div>
      )}

      {/* ==================================================== */}
      {/* 1. HEADER & CONTROL BAR */}
      {/* ==================================================== */}
      <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-lg font-bold text-white tracking-tight">Network & Synchronization Telemetry</h2>
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${operationalMode.badgeColor}`}>
              {operationalMode.badge}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Real-time multi-tier health monitoring. Clearly distinguishes on-premise LAN reachability from internet WAN/cloud reachability without inferring status only from browser connectivity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Guided Demo Mode Toggle */}
          <button
            onClick={() => setIsDemoModeOpen(!isDemoModeOpen)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 border cursor-pointer ${
              isDemoModeOpen
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-lg shadow-amber-500/10"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
            }`}
          >
            <span>🎓</span>
            <span>{isDemoModeOpen ? "Hide Guided Demo" : "Guided Demo Mode"}</span>
          </button>

          {/* Refresh Probe */}
          <button
            onClick={() => {
              probeLocalServer();
              probeCloudServer();
              refreshSyncTelemetry();
              showNotice("Probing network endpoints and refreshing queue...");
            }}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer flex items-center space-x-1.5"
            title="Perform immediate network probe on LAN and Cloud"
          >
            <span>↻</span>
            <span>Probe Now</span>
          </button>

          {/* Flush Outbox */}
          <button
            onClick={handleFlushNow}
            disabled={isSyncing || localHealth.status !== "online"}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center space-x-1.5"
          >
            <span>{isSyncing ? "⚡" : "↑"}</span>
            <span>{isSyncing ? "Flushing Queue..." : "Flush Outbox Now"}</span>
          </button>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 2. GUIDED DEMO MODE PANEL (EDUCATIONAL EXPLANATION) */}
      {/* ==================================================== */}
      {isDemoModeOpen && (
        <section
          aria-label="Guided Demo Mode Explanation"
          className="bg-slate-900/90 border border-amber-500/40 p-5 rounded-2xl space-y-5 shadow-2xl relative overflow-hidden"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-base">🎓</span>
                <h3 className="text-sm font-bold text-amber-400 tracking-wide uppercase">
                  Guided Demo: Multi-Tier Network Architecture & Failure Resilience
                </h3>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-3xl">
                This guided demo explains the real software services running on your workstation. It references the Cisco Packet Tracer network topology for academic lab design <strong>without pretending to simulate or control Cisco&apos;s proprietary desktop application</strong>.
              </p>
            </div>
            <span className="text-[10px] bg-amber-500/10 text-amber-300 px-2.5 py-1 rounded border border-amber-500/30 font-mono">
              DEMO SANDBOX
            </span>
          </div>

          {/* Interactive Simulation Controls */}
          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-white flex items-center space-x-2">
              <span>🧪</span>
              <span>Interactive Outage Sandbox (Client-Side Probe Simulation)</span>
            </h4>
            <p className="text-[11px] text-slate-400">
              Test how the NetKeep Café offline-first outbox and status indicators adapt when real-world network links drop:
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {/* Toggle Simulated Cloud Failure */}
              <button
                onClick={() => setSimulatedCloudFailure(!simulatedCloudFailure)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  simulatedCloudFailure
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                }`}
              >
                {simulatedCloudFailure ? "✓ WAN Outage Simulated (Cloud Dropped)" : "Simulate WAN Drop (Cloud Offline)"}
              </button>

              {/* Toggle Simulated LAN Failure */}
              <button
                onClick={() => setSimulatedLanFailure(!simulatedLanFailure)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  simulatedLanFailure
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                }`}
              >
                {simulatedLanFailure ? "✓ LAN Outage Simulated (Edge Server Dropped)" : "Simulate LAN Outage (Edge Offline)"}
              </button>

              {/* Reset Sandbox */}
              {(simulatedCloudFailure || simulatedLanFailure) && (
                <button
                  onClick={() => {
                    setSimulatedCloudFailure(false);
                    setSimulatedLanFailure(false);
                    showNotice("Simulation reset: Probing live production endpoints.");
                  }}
                  className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  Reset to Live Probing
                </button>
              )}
            </div>
          </div>

          {/* Architecture Hop Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
            {/* Hop 1 */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
              <span className="text-[10px] text-amber-400 font-bold">HOP 1: CLIENT POS</span>
              <p className="font-bold text-white font-sans">Browser Dexie DB</p>
              <p className="text-[11px] text-slate-400 font-sans">
                Commits orders atomically in IndexedDB before any network request. Orders survive page reloads and browser restarts.
              </p>
            </div>

            {/* Hop 2 */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
              <span className="text-[10px] text-cyan-400 font-bold">HOP 2: ON-PREMISE LAN</span>
              <p className="font-bold text-white font-sans">FastAPI + SQLite (Port 8000)</p>
              <p className="text-[11px] text-slate-400 font-sans">
                Hosted on VLAN 10 (`192.168.10.10`). Deduplicates orders via UUID idempotency and maintains stock in SQLite WAL mode.
              </p>
            </div>

            {/* Hop 3 */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
              <span className="text-[10px] text-indigo-400 font-bold">HOP 3: CISCO BLUEPRINT</span>
              <p className="font-bold text-white font-sans">Packet Tracer (`.pkt`)</p>
              <p className="text-[11px] text-slate-400 font-sans">
                Reference network design: Router 2911, Catalyst 2960 switch, 5 VLANs (10 Admin, 20 VIP Gaming, 30 Browsing, 40 Guest Wi-Fi, 50 Printers).
              </p>
            </div>

            {/* Hop 4 */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
              <span className="text-[10px] text-emerald-400 font-bold">HOP 4: CENTRAL CLOUD</span>
              <p className="font-bold text-white font-sans">Supabase PostgreSQL</p>
              <p className="text-[11px] text-slate-400 font-sans">
                Central multi-branch ingestion (`CloudOrder.id` unique constraint). Replicated asynchronously when WAN is healthy.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ==================================================== */}
      {/* 3. OPERATIONAL MODE BANNER */}
      {/* ==================================================== */}
      <div className={`p-5 rounded-2xl border bg-slate-900/90 shadow-xl ${operationalMode.accent}`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <span className="w-3 h-3 rounded-full bg-current animate-pulse" />
              <h3 className="text-base font-bold text-white">{operationalMode.title}</h3>
            </div>
            <p className="text-xs text-slate-300 max-w-3xl font-sans">
              {operationalMode.description}
            </p>
          </div>

          <div className="text-right font-mono text-xs text-slate-400 shrink-0">
            <p>Last Successful Sync:</p>
            <p className="text-emerald-400 font-bold text-sm">
              {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString("en-IN") : "Never (Pending Sync)"}
            </p>
          </div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 4. HEALTH PROBING CARDS: LAN vs CLOUD vs NIC */}
      {/* ==================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* CARD 1: Browser-to-Local-Server (LAN) */}
        <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/80 space-y-3.5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              1. ON-PREMISE LAN SERVER
            </span>
            <span
              className={`w-3 h-3 rounded-full ${
                localHealth.status === "online"
                  ? "bg-emerald-400 ring-4 ring-emerald-500/20"
                  : localHealth.status === "checking"
                  ? "bg-amber-400 animate-spin"
                  : "bg-rose-500 ring-4 ring-rose-500/20"
              }`}
            />
          </div>

          <div>
            <div className="flex items-baseline space-x-2">
              <h4 className="text-2xl font-bold font-mono text-white">
                {localHealth.status === "online"
                  ? "ONLINE"
                  : localHealth.status === "checking"
                  ? "PROBING..."
                  : "OFFLINE"}
              </h4>
              {localHealth.latencyMs !== null && (
                <span className="text-xs font-mono text-emerald-400 font-semibold">
                  {localHealth.latencyMs}ms latency
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1 truncate" title={localHealth.message || ""}>
              {localHealth.message || "Awaiting health check response..."}
            </p>
          </div>

          <div className="border-t border-slate-800/80 pt-3 space-y-1 text-[11px] font-mono text-slate-400">
            <p className="truncate" title={localHealth.endpoint}>
              <span className="text-slate-500">Target:</span> {localHealth.endpoint}
            </p>
            <p>
              <span className="text-slate-500">VLAN Segment:</span> VLAN 10 Admin (192.168.10.10)
            </p>
            <p>
              <span className="text-slate-500">Last Probe:</span>{" "}
              {localHealth.lastChecked ? localHealth.lastChecked.toLocaleTimeString("en-IN") : "Pending"}
            </p>
          </div>
        </div>

        {/* CARD 2: Cloud Central API (WAN) */}
        <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/80 space-y-3.5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              2. CENTRAL CLOUD API (WAN)
            </span>
            <span
              className={`w-3 h-3 rounded-full ${
                cloudHealth.status === "online"
                  ? "bg-emerald-400 ring-4 ring-emerald-500/20"
                  : cloudHealth.status === "checking"
                  ? "bg-amber-400 animate-spin"
                  : "bg-rose-500 ring-4 ring-rose-500/20"
              }`}
            />
          </div>

          <div>
            <div className="flex items-baseline space-x-2">
              <h4 className="text-2xl font-bold font-mono text-white">
                {cloudHealth.status === "online"
                  ? "REACHABLE"
                  : cloudHealth.status === "checking"
                  ? "PROBING..."
                  : "UNAVAILABLE"}
              </h4>
              {cloudHealth.latencyMs !== null && (
                <span className="text-xs font-mono text-emerald-400 font-semibold">
                  {cloudHealth.latencyMs}ms latency
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1 truncate" title={cloudHealth.message || ""}>
              {cloudHealth.message || "Awaiting cloud response..."}
            </p>
          </div>

          <div className="border-t border-slate-800/80 pt-3 space-y-1 text-[11px] font-mono text-slate-400">
            <p className="truncate" title={cloudHealth.endpoint}>
              <span className="text-slate-500">Target:</span> {cloudHealth.endpoint}
            </p>
            <p>
              <span className="text-slate-500">Backend:</span> Supabase PostgreSQL
            </p>
            <p>
              <span className="text-slate-500">Probe Rule:</span> Active HTTP Probe (Never onLine only)
            </p>
          </div>
        </div>

        {/* CARD 3: Physical Interface & Hardware Link */}
        <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/80 space-y-3.5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              3. DEVICE ADAPTER (NIC)
            </span>
            <span className={`w-3 h-3 rounded-full ${isBrowserOnline ? "bg-cyan-400" : "bg-rose-500"}`} />
          </div>

          <div>
            <h4 className="text-2xl font-bold font-mono text-white">
              {isBrowserOnline ? "LINK UP" : "LINK DOWN"}
            </h4>
            <p className="text-xs text-slate-400 mt-1">
              {isBrowserOnline
                ? "Physical Ethernet/Wi-Fi adapter is connected"
                : "No physical connection detected"}
            </p>
          </div>

          <div className="border-t border-slate-800/80 pt-3 space-y-1 text-[11px] font-mono text-slate-400">
            <p>
              <span className="text-slate-500">API:</span> navigator.onLine ({String(isBrowserOnline)})
            </p>
            <p>
              <span className="text-slate-500">Gateway:</span> 192.168.10.1 (Cisco 2911 Router)
            </p>
            <p className="text-[10px] text-amber-400/80 italic">
              Notice: NIC state only confirms hardware link, not Internet reachability.
            </p>
          </div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 5. SYNC TELEMETRY KPI COUNTERS */}
      {/* ==================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
        {/* Pending Orders in Outbox */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase">Pending In Outbox</span>
          <p className={`text-2xl font-bold ${pendingCount > 0 ? "text-amber-400 animate-pulse" : "text-white"}`}>
            {pendingCount}
          </p>
          <span className="text-[10px] text-slate-500 font-sans">Awaiting server dispatch</span>
        </div>

        {/* Failed Orders */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase">Failed Syncs</span>
          <p className={`text-2xl font-bold ${failedCount > 0 ? "text-rose-400" : "text-slate-400"}`}>
            {failedCount}
          </p>
          <span className="text-[10px] text-slate-500 font-sans">Transient or 4xx failures</span>
        </div>

        {/* Synced Orders Confirmed */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase">Synced Orders</span>
          <p className="text-2xl font-bold text-emerald-400">{syncedCount}</p>
          <span className="text-[10px] text-slate-500 font-sans">Server ACK received</span>
        </div>

        {/* Backoff Policy */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase">Retry Policy</span>
          <p className="text-sm font-bold text-white pt-1">Exp. Backoff + Jitter</p>
          <span className="text-[10px] text-slate-500 font-sans">Max 5 bounded retries</span>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 6. RECENT SYNC EVENTS TABLE (DURABLE OUTBOX LOG) */}
      {/* ==================================================== */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-3 p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">
              Recent Synchronization Events & Outbox Records
            </h3>
            <p className="text-xs text-slate-400">
              Direct telemetry from Dexie IndexedDB (`db.outbox`). Queued records are never discarded on timeout or network drop.
            </p>
          </div>

          <span className="text-xs font-mono text-slate-400">
            {outboxRecords.length} records currently in outbox
          </span>
        </div>

        {outboxRecords.length === 0 ? (
          <div className="text-center py-10 bg-emerald-500/5 rounded-xl border border-emerald-500/20 text-xs text-emerald-400 font-mono space-y-1">
            <p className="font-bold text-sm">✓ Outbox Queue Is Clear</p>
            <p className="text-slate-400">All local café orders have received explicit server acknowledgment (`acknowledged: true`).</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 uppercase text-[10px]">
                <tr>
                  <th className="p-3.5">Order ID (UUID)</th>
                  <th className="p-3.5">Target / Action</th>
                  <th className="p-3.5">Sync Status</th>
                  <th className="p-3.5">Retries</th>
                  <th className="p-3.5">Timestamp</th>
                  <th className="p-3.5">Diagnostic / Error Message</th>
                  <th className="p-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {outboxRecords.slice(0, 15).map((entry) => {
                  return (
                    <tr key={entry.id || entry.order_id} className="hover:bg-slate-800/40 transition">
                      <td className="p-3.5 font-bold text-emerald-400 font-mono">
                        {entry.order_id.slice(0, 8)}...{entry.order_id.slice(-6)}
                      </td>
                      <td className="p-3.5 text-slate-300">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] border border-slate-700">
                          POST /orders/sync
                        </span>
                      </td>
                      <td className="p-3.5">
                        {entry.status === "pending" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-bold border border-amber-500/30 text-[10px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            <span>Pending Dispatch</span>
                          </span>
                        )}
                        {entry.status === "in_flight" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-bold border border-blue-500/30 text-[10px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-spin" />
                            <span>In Flight</span>
                          </span>
                        )}
                        {entry.status === "failed" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-bold border border-rose-500/30 text-[10px]">
                            <span>⚠</span>
                            <span>Transient Retry</span>
                          </span>
                        )}
                        {entry.status === "permanent_failure" && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-red-900/30 text-red-300 font-bold border border-red-700/50 text-[10px]">
                            <span>✕</span>
                            <span>Validation Error (4xx)</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-300">
                        {entry.retry_count} / {entry.max_retries}
                      </td>
                      <td className="p-3.5 text-slate-400 text-[11px]">
                        {new Date(entry.created_at).toLocaleTimeString("en-IN")}
                      </td>
                      <td className="p-3.5 text-slate-400 text-[11px] max-w-xs truncate" title={entry.error_message || ""}>
                        {entry.error_message ? (
                          <span className="text-rose-400 font-mono text-[10px]">{entry.error_message}</span>
                        ) : entry.next_retry_at ? (
                          <span className="text-amber-400/80 font-mono text-[10px]">
                            Next backoff: {new Date(entry.next_retry_at).toLocaleTimeString("en-IN")}
                          </span>
                        ) : (
                          <span className="text-slate-500 italic">Ready for sync cycle</span>
                        )}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => handleEventRetry(entry.order_id)}
                          disabled={isSyncing}
                          className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 rounded-lg text-xs font-semibold border border-amber-500/30 transition cursor-pointer disabled:opacity-50"
                          title="Trigger immediate manual retry for this order"
                        >
                          🔄 Retry
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
