# Public Addresses

Loadweaver hands out public addresses from **IP pools**: your own prefixes or addresses from your hosting provider. Ingress addresses, egress addresses and name-server addresses all come from pools. Each pool says which nodes may hold its addresses and how an address moves when its node fails.

```yaml
apiVersion: loadweaver.com/v1
kind: IpPool
metadata: { name: public }
spec:
  cidrs: [203.0.113.0/28]
  nodeGroup: edge # who may hold the addresses
  failover: vrrp # vrrp | bgp | provider | none
  purposes: [ingress, egress, dns, port-forward]
  cooldownSeconds: 86400
```

## Failover modes

| Mode       | How the address moves                                                                                                                            | Needs                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `vrrp`     | keepalived on every candidate; a backup takes over within seconds and doesn't take it back (no flapping)                                         | the candidates share an L2 segment            |
| `bgp`      | the holder announces the address, the other candidates announce it with a longer path; `bgpMode: anycast` makes every holder announce it equally | [External BGP](./external-bgp.md)             |
| `provider` | the control plane moves the address through the hosting provider's API (e.g. Hetzner floating IPs)                                               | `provider: { type, credentials: secret://… }` |
| `none`     | the address stays on its node; use [DNS failover](./dns-failover.md) or accept the pin                                                           |                                               |

## Assignment

- Addresses are desired state. The plan lists every new assignment, e.g. "assigns 203.0.113.1 from pool public to ingress/0", and fails when a pool is exhausted or not meant for that purpose.
- A claim keeps its address while it exists. Released addresses cool down before anyone gets them again.
- The plan warns when only one node can hold a pool's addresses, or when they can't move at all: both are pins.

## Egress from own prefixes

A policy can send a workload group's outbound traffic out with a stable address from a pool, so third parties can allowlist it:

```yaml
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: out, project: shop }
spec:
  from: [{ group: api }]
  to: [{ builtin: internet }]
  rules: [{ ports: [443] }]
  egress:
    pools: [egress-v4, egress-v6] # one address per pool
    reverseDns: out.example.com # optional PTR
```

The address is held by a node of the pool's group, typically an edge node with BGP. Workloads on other nodes are routed to it over WireGuard, where their traffic leaves with the egress address. Traffic inside the cluster is unaffected. A workload can have one egress address per IP version.

## Reverse DNS

`reverseDns` creates the PTR record in the managed reverse zone covering the address (e.g. a `DnsZone` for `113.0.203.in-addr.arpa`). If you don't manage that zone, the plan says so; set the PTR where the address is delegated. You can also declare PTR records directly as `DnsRecord`s.
