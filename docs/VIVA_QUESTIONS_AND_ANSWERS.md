# NetKeep Cafe — Comprehensive Academic & Capstone Viva Defense Guide

This guide contains **50 curated viva and technical examination questions & answers** covering Computer Networks, Edge-Cloud Systems, Database Architecture, Security, and Full-Stack Engineering.

---

## Section A: Computer Networks & Packet Tracer Design

### Q1. Why did you choose a hybrid Edge-Cloud architecture rather than a pure cloud system?
**Answer:** In a cyber cafe or gaming lounge, uninterrupted operations are critical. If the cafe relies entirely on a cloud API, an ISP fiber cut or internet outage immediately freezes the billing timer, prevents users from unlocking PCs, stops cash transactions, and leads to revenue loss. Our Edge-Cloud model executes real-time session timers, heartbeats, and local billing locally in SQLite with zero latency and 100% offline resilience. The cloud acts asynchronously for multi-branch sync, wallet top-up, and remote reservations.

### Q2. What is the difference between a Collision Domain and a Broadcast Domain?
**Answer:**
- A **Collision Domain** is a network segment where data packets can collide with one another when sent on a shared medium. Switches break collision domains; each switch port is its own collision domain.
- A **Broadcast Domain** is a network segment where any device broadcasting a frame sends it to all other devices in the domain. Routers and VLANs break broadcast domains.

### Q3. Why do we need VLANs in NetKeep Cafe?
**Answer:**
1. **Security**: Separates public untrusted guest Wi-Fi from internal admin/billing servers.
2. **Performance**: Reduces broadcast storm traffic by restricting broadcast frames within their respective subnets.
3. **QoS (Quality of Service)**: Allows prioritizing gaming workstation traffic (VLAN 20) over general browsing or file printing traffic.

### Q4. What is "Router-on-a-Stick"?
**Answer:** Router-on-a-Stick is an Inter-VLAN routing technique where a single physical router interface connects to a switch trunk port using an 802.1Q encapsulation protocol. The physical router interface is divided into virtual sub-interfaces (e.g., `Gig0/1.10`, `Gig0/1.20`), with each sub-interface acting as the default gateway for its respective VLAN.

### Q5. Explain how NAT Overload (PAT) works in this project.
**Answer:** Port Address Translation (PAT) allows multiple private IPv4 addresses (from subnets `192.168.10.0/24` to `192.168.50.0/24`) to share a single public IP address provided by the ISP (`203.0.113.2`). The router maps private IP and source port combinations to unique source ports on the public IP address in its NAT translation table.

### Q6. What is the role of DHCP in your cafe network?
**Answer:** Dynamic Host Configuration Protocol (DHCP) automatically assigns IP addresses, subnet masks, default gateway, and DNS servers to client workstations and guest phones. We configured separate DHCP pools for each VLAN directly on the Cisco router with IP exclusions for static infrastructure (printers, servers, gateways).

### Q7. Why did you implement Switch Port Security?
**Answer:** On the gaming PC switch ports (VLAN 20), we configured `switchport port-security` with a maximum limit of 2 MAC addresses and a `restrict` violation mode. This stops malicious patrons from unplugging a gaming rig and plugging in an unauthorized rogue laptop to probe the local subnet.

### Q8. What does Spanning Tree Protocol (STP) do, and why is `spanning-tree portfast` enabled?
**Answer:** STP prevents Layer 2 switching loops that cause broadcast storms. `portfast` bypasses the standard Listening (15s) and Learning (15s) states, immediately moving terminal access ports into the Forwarding state upon cable connection, ensuring rapid DHCP acquisition.

### Q9. How do Access Control Lists (ACLs) enforce network security in your cafe?
**Answer:** We implemented an extended ACL named `GUEST_ISOLATION` on router sub-interface `Gig0/1.40`. It explicitly denies any IP packets originating from Guest Wi-Fi (`192.168.40.0/24`) destined for the Admin subnet (`192.168.10.0/24`) or Workstations, while permitting all outbound traffic to `any` (the Internet).

### Q10. What is ARP Spoofing and how can it be mitigated in a cyber cafe?
**Answer:** ARP spoofing involves an attacker sending fake ARP messages over the LAN to link their MAC address with the default gateway's IP, allowing them to sniff or alter traffic (Man-In-The-Middle). It is mitigated by enabling Dynamic ARP Inspection (DAI) and DHCP Snooping on the Cisco switch.

---

## Section B: Backend & System Architecture

### Q11. Why did you choose FastAPI over Flask or Django?
**Answer:**
1. **Asynchronous Concurrency**: Built on `Starlette` and `asyncio`, enabling hundreds of concurrent terminal heartbeat pings without blocking threads.
2. **Pydantic Validation**: Automatic data parsing, type-hint validation, and serializing error messages.
3. **Automatic OpenAPI/Swagger Docs**: Interactive docs generated at `/docs` for testing and demonstration.
4. **Speed**: Benchmarks close to Go and NodeJS thanks to Starlette and Uvicorn.

### Q12. Why SQLite for the Local Edge Server and PostgreSQL (Supabase) for the Cloud?
**Answer:**
- **SQLite**: Zero-configuration, serverless, single-file embedded database. Perfect for an on-premise edge kiosk where managing a separate database daemon is prone to local corruption on sudden power loss. With WAL (Write-Ahead Log) mode, it handles concurrent reads effortlessly.
- **Supabase PostgreSQL**: Enterprise-grade cloud relational database with JSONB support, row-level security (RLS), real-time subscriptions, and auto-generated REST APIs.

### Q13. How does the Edge-Cloud synchronization handle network failures and duplicate data?
**Answer:**
1. **Store-and-Forward**: All transactions are written locally to SQLite with `sync_status = 'PENDING'`.
2. **Asynchronous Worker**: A background thread or task queries pending records periodically and pushes them to the Cloud Ingestion API.
3. **Idempotency via UUIDs**: Each transaction generates a unique `sync_event_id` (UUIDv4). The Cloud API verifies whether this UUID has already been ingested. If it has, the duplicate insert is gracefully skipped, preventing duplicate financial transactions.

### Q14. What happens if a workstation abruptly loses power or crashes during an active session?
**Answer:** The workstation runs a lightweight client daemon that emits a UDP/TCP heartbeat to `POST /api/v1/stations/{id}/heartbeat` every 5-10 seconds. The server's watchdog background worker flags stations with no heartbeat for over 30 seconds as `OFFLINE`. The session timer pauses or auto-terminates based on admin configuration to prevent unfairly overcharging the customer.

### Q15. How are rates and billing calculated?
**Answer:**
```
Total Cost = (Duration in minutes / 60) * Hourly Station Rate + Snack/POS Additions
```
For prepaid sessions, the remaining balance countdown is computed on every heartbeat. When remaining time is under 5 minutes, a warning event is pushed to the client. At 0 minutes, the server triggers a lock signal.

---

## Section C: Frontend & User Experience

### Q16. Why did you use Next.js and Tailwind CSS?
**Answer:**
- **Next.js**: Hybrid rendering (SSR and Client Components), built-in routing, API route proxying, and production-grade optimization.
- **Tailwind CSS**: Utility-first CSS allowing rapid construction of custom, high-tech, responsive user interfaces without CSS bloat, utilizing CSS variables for theme customization.

### Q17. How does the frontend display real-time terminal status without page reloads?
**Answer:** The frontend dashboard polls the edge server's `/api/v1/stations` endpoint at configurable intervals (e.g., 2000ms) or connects via WebSocket. The state updates the React component tree, dynamically transitioning workstation status tiles between emerald green (`AVAILABLE`), ruby red (`IN_USE`), amber (`RESERVED`), and gray (`OFFLINE`).

---

## Section D: Security & Practical Operations

### Q18. How do you prevent patrons from bypassing the cyber cafe client lock screen?
**Answer:** On production Windows/Linux terminals, the client agent acts as a replacement desktop shell or runs as a top-most borderless fullscreen window hook that intercepts low-level keyboard hooks (`WH_KEYBOARD_LL`), disabling the Windows Key, Task Manager (`Ctrl+Shift+Esc`), and `Alt+Tab`. The station unlocks only upon receiving an authorized JWT session token from the Edge Server.

### Q19. How are user passwords and sensitive tokens secured?
**Answer:** Passwords are never stored in plaintext; they are hashed using `bcrypt` with salt rounds. Communication between Edge and Cloud uses HTTPS/TLS.

### Q20. What is ACID compliance and does your system adhere to it?
**Answer:**
- **Atomicity**: The transaction (debiting wallet balance + extending session time) either completely succeeds or rolls back.
- **Consistency**: Invariants like non-negative station count and valid foreign keys are enforced.
- **Isolation**: Handled via transaction locks in SQLite and row-level locks in PostgreSQL.
- **Durability**: Written to persistent disk storage (WAL log).
