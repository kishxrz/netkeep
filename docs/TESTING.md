# NetKeep Cafe — Comprehensive Testing & Validation Guide

## 1. Test Strategy Overview

NetKeep Cafe uses a multi-tier testing strategy ensuring that every layer of the cyber cafe ecosystem operates reliably under real-world conditions, including high concurrent load, terminal network disconnects, and cloud outages.

```
       ┌───────────────────────────────────────────────┐
       │             E2E Flow Tests                    │
       │   (Kiosk / Web Dashboard -> Edge -> Cloud)    │
       ├───────────────────────────────────────────────┤
       │         Integration & Sync Tests              │
       │    (Offline SQLite Queue -> Ingestion API)    │
       ├───────────────────────────────────────────────┤
       │           Local Terminal Tests                │
       │    (Heartbeat Watchdog, Rate Calculation)     │
       ├───────────────────────────────────────────────┤
       │              Unit Tests                       │
       │       (Models, Schemas, Validation)           │
       └───────────────────────────────────────────────┘
```

---

## 2. Test Cases Matrix

| Test ID | Module | Scenario | Expected Outcome | Status |
|---|---|---|---|---|
| **TC-01** | `local-server` | Initialize database schema | Tables `stations`, `sessions`, `users`, `transactions`, `sync_logs` created | Pass |
| **TC-02** | `local-server` | Seed default workstations | 16 stations populated with correct IP, MAC, and Station Type | Pass |
| **TC-03** | `local-server` | Start prepaid session for 60 min | Station status -> `IN_USE`, session created with start/end time | Pass |
| **TC-04** | `local-server` | Station heartbeat received within timeout | Heartbeat timestamp updated, status remains `IN_USE` | Pass |
| **TC-05** | `local-server` | Heartbeat timeout (> 30s) | Terminal flagged as `OFFLINE` or alarm trigger | Pass |
| **TC-06** | `local-server` | Stop session & calculate cost | Station status -> `AVAILABLE`, bill finalized, transaction logged | Pass |
| **TC-07** | `local-server` | Insufficient wallet balance | HTTP 400 error: "Insufficient wallet balance to start session" | Pass |
| **TC-08** | `sync-worker` | Queue offline session transaction | Record created in `sync_logs` with status `PENDING` | Pass |
| **TC-09** | `sync-worker` | Flush offline queue when Cloud is online | Batch sent to Cloud API, status transitioned to `SYNCED` | Pass |
| **TC-10** | `cloud-api` | Ingest duplicate sync payload | Cloud detects existing UUID idempotently, returns HTTP 200 without duplicate rows | Pass |
| **TC-11** | `cloud-api` | Fetch aggregated branch analytics | Correct daily revenue, peak occupancy, total active stations | Pass |
| **TC-12** | `frontend` | Visual floor plan status sync | Workstation tile updates color dynamically on status change | Pass |
| **TC-13** | `network` | Ping between VLAN 40 (Guest) and VLAN 10 (Admin) | Destination Unreachable (Blocked by Cisco ACL) | Pass |
| **TC-14** | `network` | Ping from VLAN 20 (Gaming) to ISP WAN (NAT) | ICMP Echo Reply (Translated via NAT Overload) | Pass |

---

## 3. Running Automated Tests

### 3.1 Local Server Test Suite
```bash
cd local-server
# Run automated pytest / test script
python test_local_api.py
```

### 3.2 Cloud API Test Suite
```bash
cd cloud-api
python test_cloud_api.py
```

### 3.3 End-to-End Terminal Simulator
To simulate 16 real cyber cafe terminals connecting, sending heartbeats, and transitioning states:
```bash
cd local-server
python terminal_agent_simulator.py
```

---

## 4. Edge-Cloud Outage Simulation Test

1. **Step 1**: Disconnect edge server network or stop `cloud-api`.
2. **Step 2**: Create 5 customer sessions and complete billing in `local-server`.
3. **Step 3**: Verify SQLite table `sync_logs`: all records should show `PENDING`.
4. **Step 4**: Restart `cloud-api` or re-enable network.
5. **Step 5**: Observe `sync_client.py`: auto-detects internet connection, pushes 5 records, and flags them `SYNCED`.
