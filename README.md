# NetKeep Cafe — Hybrid Edge-Cloud Cyber & Gaming Cafe Management System

[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-14%2B-black.svg?logo=next.js&logoColor=white)](https://nextjs.org)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC.svg?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-WAL--Mode-003B57.svg?logo=sqlite&logoColor=white)](https://sqlite.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1.svg?logo=postgresql&logoColor=white)](https://supabase.com)
[![Cisco Packet Tracer](https://img.shields.io/badge/Cisco_Packet_Tracer-8.x-1BA0D7.svg?logo=cisco&logoColor=white)](https://www.netacad.com)

**NetKeep Cafe** is a production-grade, fault-tolerant cyber cafe management ecosystem built with a **Hybrid Edge-Cloud Architecture**. It eliminates single-point-of-failure vulnerabilities in traditional internet cafes by decoupling local real-time terminal timers, lockscreens, and offline billing from centralized cloud reservations and fleet analytics.

---

## Workspace Structure

```
netkeep-cafe/
├── frontend/          # Next.js, React, Tailwind CSS (Live Terminal Floor Plan & POS)
├── local-server/      # FastAPI + SQLite (Edge Server: Real-time sessions, heartbeats, WAL mode)
├── cloud-api/         # FastAPI + Supabase PostgreSQL (Centralized reservations, sync & analytics)
├── packet-tracer/     # Cisco Packet Tracer network topology, notes & ready-to-paste IOS configs
├── docs/              # Comprehensive Architecture, Network Design, Testing & 50+ Viva Q&A
└── README.md          # Master documentation & quickstart guide
```

---

## 1. System Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │    Cloud Infrastructure (Supabase)     │
                      │   - Multi-branch fleet management      │
                      │   - Advance seat reservations          │
                      │   - Idempotent sync ingestion          │
                      └──────────────────┬─────────────────────┘
                                         │ HTTPS / TLS Sync Stream
                                         ▼
                      ┌────────────────────────────────────────┐
                      │   Local Edge Server (FastAPI + SQLite) │
                      │   - Zero-internet local billing        │
                      │   - Live heartbeat watchdog            │
                      │   - Offline store-and-forward queue    │
                      └───────┬────────────────────────┬───────┘
                              │                        │
               REST / WebSocket                        UDP / TCP Heartbeats
                              │                        │
                              ▼                        ▼
               ┌──────────────────────┐      ┌────────────────────────┐
               │ Next.js Admin UI POS │      │ Client Workstations    │
               │ - Live Floor Plan    │      │ - VIP Gaming Rigs      │
               │ - Session Timers     │      │ - Browsing Terminals   │
               │ - Quick Snack Orders │      │ - Streaming Booths     │
               └──────────────────────┘      └────────────────────────┘
```

---

## 2. Cisco Packet Tracer Network Topology

The network uses a **Core/Distribution - Access** model segmented into 5 dedicated Virtual LANs (VLANs) with **Router-on-a-Stick (802.1Q)** and **NAT Overload (PAT)**:

| VLAN ID | Segment Name | Subnet | Gateway | Security / Policy |
|---|---|---|---|---|
| **VLAN 10** | Admin & Edge Server | `192.168.10.0/24` | `192.168.10.1` | Protected subnet; hosts FastAPI SQLite server (`192.168.10.10`) |
| **VLAN 20** | VIP Gaming Workstations | `192.168.20.0/24` | `192.168.20.1` | Port Security enabled (Max 2 MACs); CBWFQ QoS priority |
| **VLAN 30** | Standard Browsing | `192.168.30.0/24` | `192.168.30.1` | General workstations with PortFast enabled |
| **VLAN 40** | Public Guest Wi-Fi | `192.168.40.0/24` | `192.168.40.1` | Isolated via Extended ACL `GUEST_SECURITY_POLICY`; WAN only |
| **VLAN 50** | Printers & NAS | `192.168.50.0/24` | `192.168.50.1` | Static IPs for heavy-duty laser printers and game cache NAS |

*Cisco CLI scripts ready to paste into Cisco Packet Tracer 8.x are available in [`packet-tracer/`](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer).*

---

## 3. Quickstart & Installation

### Prerequisites
- **Python 3.10+** (Tested on Python 3.13)
- **Node.js 18+** & **npm**

### 3.1 Start the Local Edge Server (Port 8000)
```bash
cd local-server
# Run tests
python test_local_api.py

# Start edge server
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- Swagger Interactive Docs: `http://localhost:8000/docs`
- Health Check: `http://localhost:8000/api/v1/health`

### 3.2 Start the Cloud Central API (Port 8001)
```bash
cd cloud-api
# Run automated integration tests (11 pytest unit tests + 7 integration tests)
python -m pytest tests/test_cloud_api.py -v
python test_cloud_api.py

# Start cloud central API
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```
- Swagger Interactive Docs: `http://localhost:8001/docs`
- Owner Central Dashboard: `http://localhost:8001/api/v1/owner/dashboard`
- Cloud Setup & Supabase Guide: [`cloud-api/README.md`](file:///c:/Users/Kishore/Desktop/netkeep/cloud-api/README.md)

### 3.3 Start the Client Terminal Simulator (Optional Demo)
Simulates 16 physical gaming and browsing terminals reporting heartbeats, CPU/RAM utilization, and responding to lock/unlock triggers:
```bash
cd local-server
python terminal_agent_simulator.py
```

### 3.4 Start the Next.js Frontend (Port 3000)
```bash
cd frontend
# Run frontend unit tests (Integer paise pricing & Dexie local persistence)
npm test

# Start development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the NetKeep Café POS!

---

## 4. Offline-First POS & Dexie IndexedDB Architecture

NetKeep Café implements a strict **offline-first local-first pattern**:
1. **Integer Paise Financial Calculations**:
   - All prices, subtotals, taxes (5% GST), discounts, and totals are computed and stored as integer paise (`1 Rupee = 100 paise`), preventing IEEE 754 floating-point rounding errors.
2. **Dexie IndexedDB Schema (`NetKeepCafeDB`)**:
   - `menu_cache`: Local cache of menu items and live stock levels.
   - `orders`: Master orders table with UUID primary key, order code, status (`local_pending` vs `synced`), and timestamps.
   - `order_items`: Line items referencing `orders.id` foreign key.
   - `outbox`: Store-and-forward sync queue table.
   - `sync_metadata`: Sync timestamps and version tracking.
3. **Atomic Local Persistence**:
   - When the user clicks Checkout, the order, all line items, outbox record, and stock decrements are committed **atomically** in an IndexedDB transaction **BEFORE any network request is attempted**.
4. **Server Acknowledgment Rule**:
   - **Critical Safety Invariant**: Orders are **never marked `synced` without an explicit server acknowledgment** (`{ acknowledged: true }`). If the server is offline or the network drops, the order remains safely in `local_pending` and is clearly badged in the UI.
5. **Printable Receipt**:
   - Instant printable receipt modal formatted with store branding, itemized breakdown, tax details, customer name, payment mode, and sync status.

## 5. Reliable Synchronization & Idempotency Guarantee

NetKeep Café features end-to-end reliable synchronization across its three-tier architecture:

### 5.1 Browser-to-Edge Sync Engine (`frontend`)
- **Atomic Local Persistence**: Orders, order items, outbox entries, and stock decrements are committed in a single Dexie transaction before any network call.
- **Sequential FIFO Queue**: Outbox entries are dispatched sequentially in order of creation to prevent out-of-order race conditions.
- **Stable UUIDv4 Idempotency Keys**: Generated at order creation time and re-used on all retries.
- **Bounded Exponential Backoff with Jitter**:
  $$\text{backoff} = \min\left(\text{maxBackoff},\, \left(\text{minBackoff} + 2^{\text{retry}-1} \times \text{initialBackoff}\right)\right) \times (0.5 + 0.5 \times \text{random})$$
- **Transient vs Permanent Error Classification**:
  - **Transient Errors** (5xx, timeouts, offline drops): Kept as `pending`, bounded to 5 retries with backoff and jitter. Outbox records are never discarded on timeout or failure.
  - **Permanent Validation Failures** (400, 422): Explicitly marked as `permanent_failure` and `failed` order status, halting infinite background retry loops while preserving data for user inspection.
- **Explicit Server Acknowledgment**: Orders are never marked `synced` without `{ acknowledged: true }` from the server.
- **Telemetry & Manual Retry**: UI displays visible `synced` (emerald), `local_pending` (amber), and `failed` (rose) badges, last sync timestamp, outbox queue inspection table, and per-order manual retry buttons.

### 5.2 Local Edge Server (`local-server`)
- **Single-Transaction Commit**: Validates line items, menu existence, unit prices, and quantities; writes order, order items, inventory movements, and `sync_events` in one SQLite transaction.
- **Idempotency Deduplication**: Repeating the same order UUID returns the committed order without deducting stock twice.
- **Durable Store-and-Forward**: Unsynced records in `sync_events` are held until cloud connection is established.

### 5.3 Cloud Central API (`cloud-api`)
- **Supabase PostgreSQL Schema**: Enforces unique primary key constraint on `CloudOrder.id` (UUID idempotency key).
- **Duplicate Sync Filtering**: Automatically skips already-ingested sync events without error.

### 5.4 Automated Test Suite Coverage
Run the full test suite across all three tiers:
```bash
# 1. Frontend: 16 tests covering pricing, Dexie persistence, exponential backoff, jitter,
#    offline queuing, duplicate retries, lost response after commit, server restart recovery, and manual retry
cd frontend && npm test

# 2. Local Edge Server: 14 pytest unit tests + 5 API integration tests covering
#    atomic transactions, UUID idempotency, stock deductions, LAN auth, and validation
cd ../local-server && python -m pytest tests/test_local_server.py -v && python test_local_api.py

# 3. Cloud Central API: 11 pytest unit tests + 7 API integration tests
cd ../cloud-api && python -m pytest tests/test_cloud_api.py -v && python test_cloud_api.py

# 4. Zero-Mock End-to-End Pilot Lifecycle Test (Real WAN failure, recovery & idempotency)
python tests/verify_pilot_lifecycle.py
```

---

## 6. Documentation Directory Map

- [Pilot Audit, Network Infrastructure & Deployment Guide](file:///c:/Users/Kishore/Desktop/netkeep/docs/PILOT_AUDIT_AND_DEPLOYMENT.md) *(Master Production Guide & 5-min Demo Script)*
- [System Architecture Specification](file:///c:/Users/Kishore/Desktop/netkeep/docs/ARCHITECTURE.md)
- [Cisco Network Topology & Packet Tracer Design](file:///c:/Users/Kishore/Desktop/netkeep/docs/NETWORK_DESIGN.md)
- [Comprehensive Testing Matrix & Test Plan](file:///c:/Users/Kishore/Desktop/netkeep/docs/TESTING.md)
- [50+ Capstone Viva Questions and Answers](file:///c:/Users/Kishore/Desktop/netkeep/docs/VIVA_QUESTIONS_AND_ANSWERS.md)
- [Packet Tracer Cisco IOS Scripts](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer/README.md)
