# NetKeep Cyber Cafe — Cisco Packet Tracer Topology

This folder contains network topology documentation, ready-to-paste Cisco IOS configuration scripts, and IP specifications for simulating the **NetKeep Cyber Cafe** network in Cisco Packet Tracer (Version 7.x, 8.x, or later).

---

## Files in this Directory

| File | Description |
|---|---|
| [`network_notes.md`](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer/network_notes.md) | In-depth network design, subnet calculations, VLAN mapping & theory |
| [`cisco_router_config.ios`](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer/cisco_router_config.ios) | Ready-to-paste Cisco IOS commands for the 2911 Router |
| [`cisco_switch_config.ios`](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer/cisco_switch_config.ios) | Ready-to-paste Cisco IOS commands for Catalyst 2960 Switch |
| [`topology_spec.json`](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer/topology_spec.json) | JSON metadata schema of all network devices, ports, and subnets |
| [`generate_packet_tracer_guide.py`](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer/generate_packet_tracer_guide.py) | Python helper to verify subnet calculations and print ASCII topology |

---

## Quick Setup Instructions in Cisco Packet Tracer

1. **Place the Devices on the Workspace**:
   - 1x **Cisco 2911 Router** (Label: `NetKeep-Router`)
   - 1x **Cisco 2960-24TT Switch** (Label: `NetKeep-Switch`)
   - 1x **Server-PT** (Label: `Edge-Server`, IP: `192.168.10.10/24`)
   - 1x **PC-PT** for Admin (Label: `Admin-POS-01`, IP: `192.168.10.11/24`)
   - 4x **PC-PT** for Gaming Rigs (Labels: `PC-GAME-01` to `04`)
   - 4x **PC-PT** for Standard Workstations (Labels: `PC-STD-01` to `04`)
   - 1x **AccessPoint-PT** (Label: `Cafe-Guest-WAP`)
   - 2x **Smartphone-PT / Laptop-PT** (for Guest Wi-Fi test)
   - 1x **Printer-PT** (Label: `Network-Printer`, IP: `192.168.50.10/24`)
   - 1x **Cloud-PT** / ISP Router (Label: `ISP-Gateway`, IP: `203.0.113.1/30`)

2. **Cabling**:
   - Connect `NetKeep-Router` `Gig0/1` to `NetKeep-Switch` `Gig0/1` using a **Copper Straight-Through** cable (this will be the 802.1Q trunk).
   - Connect `NetKeep-Router` `Gig0/0` to `ISP-Gateway` using a **Copper Cross-over** or Serial cable.
   - Connect PCs to switch ports FastEthernet `0/1` through `0/24` based on the VLAN port assignments.

3. **Apply Configurations**:
   - Open Router CLI -> Paste contents of [`cisco_router_config.ios`](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer/cisco_router_config.ios).
   - Open Switch CLI -> Paste contents of [`cisco_switch_config.ios`](file:///c:/Users/Kishore/Desktop/netkeep/packet-tracer/cisco_switch_config.ios).

4. **Verify Connectivity**:
   - Set PCs to **DHCP**. Verify they receive correct IPs from their respective VLAN pools.
   - Ping from `PC-GAME-01` (`192.168.20.X`) to `Edge-Server` (`192.168.10.10`) -> **Success**.
   - Ping from Guest Smartphone (`192.168.40.X`) to `Edge-Server` (`192.168.10.10`) -> **Failed (Blocked by ACL)**.
   - Ping from any station to ISP Public IP `203.0.113.1` -> **Success (NAT Overload working)**.
