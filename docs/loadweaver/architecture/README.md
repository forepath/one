# Architecture Overview

```
 Console / CLI / API  ──►  Control plane (API, policy compiler, Postgres + TimescaleDB, etcd)
                                 │  desired state per node (revisioned, NOTIFY to every replica)
                                 ▼
                 one outbound gRPC stream per node (mutual TLS, node identity from the cluster CA)
                                 ▼
 Node agent (TypeScript, single executable, systemd) ──► WireGuard · BIRD · nftables · DNS · Docker
```

## Control plane

- Runs on 1 to 5 designated nodes (the control-plane members). Below three nodes it runs on whatever exists; with two nodes an optional witness provides the third vote.
- State lives in Postgres managed by Patroni (streaming replication, automatic leader failover) with etcd as consensus store. The API reaches the current leader through a local proxy on every member.
- The **API is the source of truth** for desired state. Every declarative change goes through plan → apply.
- The **policy compiler** turns groups and policies into the configuration of every enforcement layer, per node, and stores it as a revisioned desired state.

## Node agent

- A TypeScript Node.js single executable application, run by systemd outside Docker: it manages Docker and the host network and keeps working while Docker is restarted.
- Opens one persistent, outbound stream to the control plane. Nodes need no inbound management port; nodes behind NAT work.
- Applies desired states layer by layer (tunnels → routing → filtering / services → DNS → control-plane role). If a layer fails, the previous state is re-applied and the report says exactly what happened.
- Owns only what carries its prefix: `lw-*` WireGuard interfaces, the `lw0` loopback, the `inet loadweaver` nftables table, the `lwbr0` workload bridge. Foreign tunnels and firewall rules stay untouched.

## Identity

- Every cluster has its own certificate authority. Nodes get certificates with the identity `spiffe://<cluster>.loadweaver/node/<name>`; the control plane decides the identity, not the request.
- Node certificates rotate automatically when less than a third of their lifetime is left. A node that leaves loses its identity immediately.
