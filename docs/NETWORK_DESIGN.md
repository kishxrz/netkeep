# NetKeep Cyber Cafe — Network Design Specification

## 1. Network Topology Overview

The NetKeep Cyber Cafe network is architected using a hierarchical **Core/Distribution - Access** model simulated in Cisco Packet Tracer. The network infrastructure accommodates:
- **20+ High-Performance Gaming Workstations**
- **10+ Standard Internet & Browsing Terminals**
- **4 Private Streaming Booths**
- **Front Desk Management POS & Edge Server Appliance**
- **Public Guest Wi-Fi Zone**
- **Network Attached Storage (NAS) & Laser Printers**

---

## 2. Logical Topology Diagram

```
                 [ ISP Internet Cloud / WAN ]
                              │
                     Public IP: 203.0.113.2/30
                              │
                    [ Cisco 2911 Router ]
                    (Gateway & NAT / PAT)
                     Gig0/0 (WAN) | Gig0/1 (Trunk)
                                  │ 802.1Q Trunk
                                  │ (VLANs 10, 20, 30, 40, 50)
                                  │
                   [ Cisco Catalyst 2960-24TT Switch ]
                   (Core / Distribution Switch)
          ┌──────────────┬──────────────┬──────────────┬──────────────┐
     FastEth 0/1-4  FastEth 0/5-12 FastEth 0/13-18 FastEth 0/19-22 FastEth 0/23-24
        VLAN 10        VLAN 20        VLAN 30        VLAN 40        VLAN 50
           │              │              │              │              │
      [ Admin &      [ Gaming Rig   [ Standard     [ WAP / Guest  [ Printers &
     Local Server ]    Stations ]     Browsing ]       Wi-Fi ]     Storage NAS ]
```

---

## 3. Comprehensive Subnetting & IP Addressing Scheme

Network Base: `192.168.0.0/16` (Private IPv4 Class C Block)

| Network Segment | VLAN ID | Network Address | Subnet Mask | Usable Host Range | Broadcast Address | Default Gateway | DHCP Pool Name |
|---|---|---|---|---|---|---|---|
| **Admin & Edge Server** | 10 | `192.168.10.0/24` | `255.255.255.0` | `192.168.10.2` - `192.168.10.254` | `192.168.10.255` | `192.168.10.1` | `VLAN10_ADMIN` |
| **VIP Gaming Stations** | 20 | `192.168.20.0/24` | `255.255.255.0` | `192.168.20.2` - `192.168.20.254` | `192.168.20.255` | `192.168.20.1` | `VLAN20_GAMING` |
| **Standard Browsing** | 30 | `192.168.30.0/24` | `255.255.255.0` | `192.168.30.2` - `192.168.30.254` | `192.168.30.255` | `192.168.30.1` | `VLAN30_STANDARD` |
| **Guest Wi-Fi (BYOD)** | 40 | `192.168.40.0/24` | `255.255.255.0` | `192.168.40.2` - `192.168.40.254` | `192.168.40.255` | `192.168.40.1` | `VLAN40_GUEST` |
| **Printers & Infrastructure** | 50 | `192.168.50.0/24` | `255.255.255.0` | `192.168.50.2` - `192.168.50.254` | `192.168.50.255` | `192.168.50.1` | `Static IP Only` |

---

## 4. Cisco Router CLI Configurations (Router-on-a-Stick, DHCP & NAT)

The router handles Inter-VLAN routing, assigns dynamic IP addresses via DHCP, and performs NAT Overload (PAT) so all internal machines can access the Internet through one public WAN IP.

### Sub-Interfaces & 802.1Q Encapsulation:
```cisco
enable
configure terminal
hostname NetKeep-Router

! WAN Interface to ISP
interface GigabitEthernet0/0
 ip address 203.0.113.2 255.255.255.252
 ip nat outside
 no shutdown
exit

! LAN Physical Trunk Interface
interface GigabitEthernet0/1
 no ip address
 no shutdown
exit

! Sub-interface for VLAN 10 (Admin)
interface GigabitEthernet0/1.10
 encapsulation dot1Q 10
 ip address 192.168.10.1 255.255.255.0
 ip nat inside
exit

! Sub-interface for VLAN 20 (Gaming)
interface GigabitEthernet0/1.20
 encapsulation dot1Q 20
 ip address 192.168.20.1 255.255.255.0
 ip nat inside
exit

! Sub-interface for VLAN 30 (Standard Browsing)
interface GigabitEthernet0/1.30
 encapsulation dot1Q 30
 ip address 192.168.30.1 255.255.255.0
 ip nat inside
exit

! Sub-interface for VLAN 40 (Guest Wi-Fi)
interface GigabitEthernet0/1.40
 encapsulation dot1Q 40
 ip address 192.168.40.1 255.255.255.0
 ip nat inside
exit

! Sub-interface for VLAN 50 (Printers & NAS)
interface GigabitEthernet0/1.50
 encapsulation dot1Q 50
 ip address 192.168.50.1 255.255.255.0
 ip nat inside
exit
```

### DHCP Pools Configuration:
```cisco
! Exclude default gateways and static servers
ip dhcp excluded-address 192.168.10.1 192.168.10.20
ip dhcp excluded-address 192.168.20.1 192.168.20.10
ip dhcp excluded-address 192.168.30.1 192.168.30.10
ip dhcp excluded-address 192.168.40.1 192.168.40.10

! VLAN 10 Admin DHCP Pool
ip dhcp pool VLAN10_ADMIN
 network 192.168.10.0 255.255.255.0
 default-router 192.168.10.1
 dns-server 8.8.8.8 1.1.1.1
 lease 1

! VLAN 20 Gaming DHCP Pool
ip dhcp pool VLAN20_GAMING
 network 192.168.20.0 255.255.255.0
 default-router 192.168.20.1
 dns-server 1.1.1.1 8.8.8.8
 lease 0 12

! VLAN 30 Standard PC DHCP Pool
ip dhcp pool VLAN30_STANDARD
 network 192.168.30.0 255.255.255.0
 default-router 192.168.30.1
 dns-server 8.8.8.8
 lease 0 8

! VLAN 40 Guest Wi-Fi DHCP Pool
ip dhcp pool VLAN40_GUEST
 network 192.168.40.0 255.255.255.0
 default-router 192.168.40.1
 dns-server 8.8.8.8
 lease 0 2
```

### NAT Overload (PAT) & Access Lists:
```cisco
! Access List defining which private subnets are translated to WAN
access-list 1 permit 192.168.10.0 0.0.0.255
access-list 1 permit 192.168.20.0 0.0.0.255
access-list 1 permit 192.168.30.0 0.0.0.255
access-list 1 permit 192.168.40.0 0.0.0.255
access-list 1 permit 192.168.50.0 0.0.0.255

! Bind ACL 1 to WAN interface with overload
ip nat inside source list 1 interface GigabitEthernet0/0 overload

! Default Route to ISP Gateway
ip route 0.0.0.0 0.0.0.0 203.0.113.1
```

---

## 5. Security Access Control Lists (ACL)

To secure the cafe environment:
1. Guest Wi-Fi (VLAN 40) is blocked from accessing Admin (VLAN 10) and internal Workstations.
2. Gaming and Standard terminals can only reach the Edge Server on port `8000` (FastAPI API).

```cisco
! Extended ACL to isolate Guest Wi-Fi
ip access-list extended GUEST_ISOLATION
 deny ip 192.168.40.0 0.0.0.255 192.168.10.0 0.0.0.255
 deny ip 192.168.40.0 0.0.0.255 192.168.20.0 0.0.0.255
 deny ip 192.168.40.0 0.0.0.255 192.168.30.0 0.0.0.255
 deny ip 192.168.40.0 0.0.0.255 192.168.50.0 0.0.0.255
 permit ip 192.168.40.0 0.0.0.255 any
exit

interface GigabitEthernet0/1.40
 ip access-group GUEST_ISOLATION in
exit
```

---

## 6. Cisco Switch CLI Configurations (VLANs, Trunk & Port Security)

```cisco
enable
configure terminal
hostname NetKeep-Switch

! Create VLANs
vlan 10
 name Management_Admin
vlan 20
 name VIP_Gaming
vlan 30
 name Standard_Browsing
vlan 40
 name Guest_WiFi
vlan 50
 name Printers_NAS
exit

! Configure Trunk Port connected to Router Gig0/1
interface GigabitEthernet0/1
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30,40,50
 no shutdown
exit

! Ports for VLAN 10 (Admin POS & Edge Server)
interface range FastEthernet0/1 - 4
 switchport mode access
 switchport access vlan 10
 spanning-tree portfast
 no shutdown
exit

! Ports for VLAN 20 (Gaming PCs)
interface range FastEthernet0/5 - 12
 switchport mode access
 switchport access vlan 20
 spanning-tree portfast
 switchport port-security
 switchport port-security maximum 2
 switchport port-security violation restrict
 no shutdown
exit

! Ports for VLAN 30 (Standard PCs)
interface range FastEthernet0/13 - 18
 switchport mode access
 switchport access vlan 30
 spanning-tree portfast
 no shutdown
exit

! Ports for VLAN 40 (Wireless Access Point)
interface range FastEthernet0/19 - 22
 switchport mode access
 switchport access vlan 40
 spanning-tree portfast
 no shutdown
exit

! Ports for VLAN 50 (Network Printers)
interface range FastEthernet0/23 - 24
 switchport mode access
 switchport access vlan 50
 spanning-tree portfast
 no shutdown
exit
```
