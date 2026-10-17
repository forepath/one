# Loadweaver Documentation

**Loadweaver** turns a handful of servers into a resilient multi-site cluster: an encrypted network between your sites, shared storage on every node and ingress that fails over on its own. A single node is already a complete cluster; clusters grow to around 1,000 nodes across many sites.

## Documentation Structure

### [Getting Started](./getting-started.md)

Create a cluster on one server, add nodes, write your first policy.

### [Architecture](./architecture/README.md)

- [Overview](./architecture/README.md) Control plane, node agents, the policy compiler and how desired state reaches every node

### Features

- [Nodes and joining](./features/nodes-and-joining.md) Join tokens, the one-line installer, control-plane growth, cordon / drain / leave
- [Groups and policies](./features/groups-and-policies.md) Node and workload groups, allow-only policies and what they compile to
- [Plan and apply](./features/plan-and-apply.md) Declarative YAML, plans, stale-plan protection
- [Deployments and jobs](./features/deployments-and-jobs.md) Compose deployments, migration, drain and failover, one-off and cron jobs
- [Volumes](./features/volumes.md) Replicated, always encrypted volumes
- [Secrets and encryption](./features/secrets-and-encryption.md) Envelope-encrypted secrets, the master key, external KMS / Vault
- [Built-in registry](./features/built-in-registry.md) Pull-through cache, private images, the object store
- [Ingress](./features/ingress.md) Hostnames and port forwards, ACME and uploaded certificates, rate limits, WAF
- [Public addresses](./features/public-addresses.md) IP pools, VRRP / BGP / provider failover, egress from own prefixes, reverse DNS
- [DNS](./features/dns.md) Records as desired state, Cloudflare, hosted bind9, AXFR secondaries, DNSSEC
- [DNS failover](./features/dns-failover.md) Probes with quorum, fail-back, weighted / geo / latency steering
- [External BGP](./features/external-bgp.md) Own ASN and prefixes, peers, announcements, RPKI, graceful shutdown
- [Service mesh](./features/service-mesh.md) East-west traffic through the node proxies, mTLS with workload identities, L7 rules
- [Egress filtering](./features/egress-filtering.md) Hostname allow / deny lists for web egress, monitor / enforce / offline
- [Image policies](./features/image-policies.md) cosign signatures, Trivy vulnerability scans, enforcement at plan and on the node
- [Remote access](./features/remote-access.md) WireGuard for people, machines and offices, split tunnel and DNS, posture
- [Audit log](./features/audit-log.md) Hash-chained, append-only record of every change

### Deployment

- [Host requirements](./deployment/host-requirements.md) Supported systems, ports, kernel features

## API

- REST: `libs/domains/loadweaver/backend/feature-control-plane/spec/openapi.yaml`
- Node agent stream (gRPC): `libs/domains/loadweaver/shared/util-agent-protocol/proto/agent.proto`
- JSON Schemas of every resource kind: `GET /api/schemas/{kind}`
