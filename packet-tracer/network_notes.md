# Cyber Cafe Network Notes — Packet Tracer Deep-Dive

## 1. Network Requirements & Justification

A modern cyber cafe is not a simple home network with an unmanaged switch. It is a commercial, multi-tenant environment with high bandwidth consumption, latency sensitivity, financial transactions, and untrusted guest devices.

### Key Technical Challenges Addressed:
1. **Network Sniffing & Session Hijacking**: If all PCs are in the same broadcast domain, any user running Wireshark could capture ARP requests, unencrypted passwords, and DNS queries of adjacent users.
   - *Solution*: VLAN segmentation + Private VLAN port isolation.
2. **Bufferbloat & Lag in Gaming Rigs**: Heavy file downloads on browsing PCs or guest phones should never spike ping on competitive gaming rigs (Valorant, CS:GO, Dota 2).
   - *Solution*: VLAN separation allowing Class-Based Weighted Fair Queuing (CBWFQ) / QoS priority for VLAN 20.
3. **Malware & Ransomware Lateral Movement**: If a customer plugs in an infected USB drive, worms spread via SMB (Port 445).
   - *Solution*: Switch access-port security and client-to-client traffic blocking.
4. **Billing & Server Protection**: The Edge Server hosts local financial records and session databases.
   - *Solution*: Strict Extended Access Control Lists (ACLs) restricting server access strictly to authorized ports.

---

## 2. Variable Length Subnet Masking (VLSM) Calculations

Starting with Class C Block `192.168.0.0/16`:

### VLAN 10 — Management, Server & Admin POS
- **Required Hosts**: ~10 (Server, 2 POS PCs, Manager PC, CCTV NVR, Access Controller)
- **Allocated Subnet**: `192.168.10.0/24` (254 Usable Hosts)
- **Subnet Mask**: `255.255.255.0` (`/24`)
- **Usable Range**: `192.168.10.1` to `192.168.10.254`
- **Default Gateway**: `192.168.10.1`
- **Edge Server Static IP**: `192.168.10.10`
- **Admin POS Static IP**: `192.168.10.11`

### VLAN 20 — VIP Gaming Terminals
- **Required Hosts**: 30-50 high-end rigs
- **Allocated Subnet**: `192.168.20.0/24`
- **Subnet Mask**: `255.255.255.0`
- **Usable Range**: `192.168.20.1` to `192.168.20.254`
- **Default Gateway**: `192.168.20.1`
- **DHCP Allocation**: `192.168.20.11` through `192.168.20.100`

### VLAN 30 — Standard Browsing & Study PCs
- **Required Hosts**: 30 standard PCs
- **Allocated Subnet**: `192.168.30.0/24`
- **Subnet Mask**: `255.255.255.0`
- **Usable Range**: `192.168.30.1` to `192.168.30.254`
- **Default Gateway**: `192.168.30.1`
- **DHCP Allocation**: `192.168.30.11` through `192.168.30.100`

### VLAN 40 — Public Guest Wi-Fi Zone (BYOD)
- **Required Hosts**: 50-100 phones/laptops
- **Allocated Subnet**: `192.168.40.0/24`
- **Subnet Mask**: `255.255.255.0`
- **Usable Range**: `192.168.40.1` to `192.168.40.254`
- **Default Gateway**: `192.168.40.1`
- **DHCP Allocation**: `192.168.40.11` through `192.168.40.200`
- **Lease Time**: 2 hours (Aggressive recycling of IP addresses)

### VLAN 50 — Shared Printers, Scanners & NAS
- **Required Hosts**: ~5 static network peripherals
- **Allocated Subnet**: `192.168.50.0/24`
- **Subnet Mask**: `255.255.255.0`
- **Default Gateway**: `192.168.50.1`
- **Laser Printer 1**: `192.168.50.10`
- **Color Scanner/Printer 2**: `192.168.50.11`
- **LAN Game Cache Server**: `192.168.50.20`

---

## 3. 802.1Q Trunking Protocol Details

When a frame leaves a workstation on VLAN 20, the switch tags the Ethernet frame with a **4-byte 802.1Q header**:
```
[ Preamble | Dest MAC | Src MAC | 802.1Q Tag (VLAN ID 20) | EtherType | Payload | FCS ]
```
The Cisco 2911 router receives this tagged frame on physical interface `Gig0/1`, checks the VLAN ID in the tag, directs it to the virtual sub-interface `Gig0/1.20`, strips the tag, and performs routing or NAT translation.

---

## 4. NAT Overload (PAT) Translation Mechanics

When workstation `192.168.20.15:45231` accesses an external game server at `198.51.100.50:7777`:
1. The packet reaches router sub-interface `Gig0/1.20` (marked as `ip nat inside`).
2. The router matches `192.168.20.15` against Access List `1`.
3. The router translates source IP to public WAN IP `203.0.113.2` and assigns a distinct public port (e.g. `50021`).
4. The router records the translation in its NAT table:
   ```
   Inside Local: 192.168.20.15:45231
   Inside Global: 203.0.113.2:50021
   Outside Local: 198.51.100.50:7777
   Outside Global: 198.51.100.50:7777
   ```
5. When the server replies to `203.0.113.2:50021`, the router rewrites the destination to `192.168.20.15:45231` and forwards it through trunk `Gig0/1` with VLAN tag 20.
