# External BGP

Bring your own ASN and prefixes and peer with upstreams, IXP route servers or your provider's BGP, per site. Nodes with upstream sessions form the **edge**; services elsewhere are reached over WireGuard.

```yaml
apiVersion: loadweaver.com/v1
kind: AutonomousSystem
metadata: { name: own }
spec:
  asn: 4200000001
  prefixes: [203.0.113.0/24, 2001:db8:100::/48]
  rtrServers: [{ address: 192.0.2.10, port: 3323 }] # optional RPKI validators
---
apiVersion: loadweaver.com/v1
kind: BgpPeer
metadata: { name: transit-fra }
spec:
  asn: 64500
  address: 198.18.0.1
  nodeGroup: edge-fra
  password: 'secret://infra/transit-fra' # MD5, optional
  bfd: true
  import: default # none | default | partial | full
---
apiVersion: loadweaver.com/v1
kind: BgpAnnouncement
metadata: { name: web }
spec:
  prefixes: [203.0.113.0/24]
  nodeGroup: edge
  mode: anycast # or primary-backup with primarySite
  communities: ['64500:100']
  prepend: 0
  whenHealthy: { service: shop/web/api, scope: site } # node | site | cluster
```

## Route safety

- Only prefixes the cluster holds (its `AutonomousSystem` or its IP pools) can be announced; anything else fails the plan.
- The plan checks the ROA for every announced prefix and warns when it is missing or invalid.
- Imports drop bogons, your own prefixes, RPKI-invalid routes (with validators) and overly specific routes, and are capped by max-prefix limits.
- BFD detects a dead upstream quickly. A draining node announces with the graceful-shutdown community (RFC 8326) so traffic moves away before the session drops.
- Peer passwords are stored as secrets and reach the node only when its configuration is pushed.

## Anycast and primary / backup

- **anycast:** every node of the group announces and the nearest site wins. Use it for stateless web and DNS.
- **primary-backup:** the primary site announces plainly, others prepend. Use it for L4 forwards that must not switch sites mid-connection; the plan warns about anycast with L4 forwards.

`whenHealthy` withdraws an announcement from nodes where the service has no healthy replica in the chosen scope, so traffic only goes to sites that can serve it. The plan warns when a prefix is announced from a single node.

## Outbound

Per peer, `import: default` or `partial` gives the edge an upstream route for egress; `full` tables only on edge nodes with enough memory. To leave with addresses from your own prefixes, including from nodes without BGP, see [egress from own prefixes](./public-addresses.md#egress-from-own-prefixes).

## Ports

| Port             | Where      | Purpose                   |
| ---------------- | ---------- | ------------------------- |
| 179 / tcp        | edge nodes | BGP sessions to the peers |
| 3784, 3785 / udp | edge nodes | BFD                       |
