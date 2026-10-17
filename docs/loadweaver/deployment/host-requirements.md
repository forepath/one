# Host Requirements

| Requirement  | Value                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| OS           | Debian 12 / 13, Ubuntu 22.04 / 24.04 LTS                                                                                                    |
| Architecture | amd64, arm64                                                                                                                                |
| Privileges   | root / sudo for the installer                                                                                                               |
| Outbound     | HTTPS to the control plane, TCP 7443 to the control plane (agent stream)                                                                    |
| WireGuard    | UDP reachability between nodes where policies need a tunnel; at least one side of each pair must be reachable (the other may be behind NAT) |

The installer sets up Docker (with live-restore), gVisor, WireGuard tools, nftables, BIRD 2, keepalived and the node agent, enables IPv4 / IPv6 forwarding and lets services bind addresses a node doesn't hold yet (`ip_nonlocal_bind`, for floating addresses). Nothing is configured over SSH; nodes join with a token only.

## Ports

| Port                                     | Where                                                               | Purpose                                                   |
| ---------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| 3400 / tcp                               | control-plane members                                               | Loadweaver API (behind the ingress in production)         |
| 7443 / tcp                               | control-plane members                                               | Node agent stream (gRPC, mutual TLS)                      |
| 51820+ / udp                             | every node with tunnels                                             | WireGuard, one port per peer                              |
| 2379, 2380, 5432, 8008 / tcp             | control-plane members, overlay only                                 | etcd, Postgres, Patroni                                   |
| 3900, 3901, 3903, 3910, 3911, 3913 / tcp | object-store nodes (control-plane members), overlay only            | Garage S3, RPC and admin of two generations               |
| 5000-5016 / tcp                          | control-plane members, overlay only                                 | Built-in registry (private instance and mirrors)          |
| 7479 / tcp                               | every node, loopback only                                           | Pull router of the built-in registry                      |
| 6390 / tcp                               | control-plane members, loopback only                                | Valkey of the rate-limit service                          |
| 8081 / tcp                               | control-plane members, overlay only                                 | Cluster-wide rate-limit service of the ingress            |
| 80, 443 / tcp                            | ingress nodes                                                       | Ingress (HTTP, HTTPS); published ports as well            |
| 53 / udp, tcp                            | bind9 nodes                                                         | Hosted authoritative DNS                                  |
| 179 / tcp, 3784-3785 / udp               | edge nodes                                                          | External BGP sessions and BFD                             |
| 15001 / tcp                              | every node, pod gateway                                             | Service mesh outbound (local workloads to the node proxy) |
| 15443 / tcp                              | every node, overlay only                                            | Service mesh inbound (proxy to proxy, mutual TLS)         |
| 15080, 15444 / tcp                       | every node, pod gateway; active VPN gateway, client-network address | Egress filtering (HTTP by Host, TLS by SNI)               |
| 51800 / udp                              | remote access gateways                                              | WireGuard for remote clients (`remoteAccess.port`)        |
| 53 / udp, tcp                            | active VPN gateway, client-network address                          | Split DNS for remote clients                              |
| IP protocol 112                          | VRRP pool members                                                   | keepalived (VRRP) between candidates                      |
