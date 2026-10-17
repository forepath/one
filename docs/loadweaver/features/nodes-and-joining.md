# Nodes and Joining

## Join tokens

| Property | Behaviour                                                                                  |
| -------- | ------------------------------------------------------------------------------------------ |
| Lifetime | 60 minutes by default, at most 24 hours (`ttlMinutes`)                                     |
| Use      | Single use; the plaintext is shown once, only a SHA-256 hash is stored                     |
| Scope    | Site, labels and witness role are fixed by the token; the joining node can't choose others |
| Who      | Infra operators and cluster admins (PAT scope `cluster:nodes`)                             |
| Failures | Unknown, used, revoked or expired tokens all return the same `401`                         |

The installer sends the token only over HTTPS and pins the cluster CA (`--ca-cert-hash`). Pass the token through `LOADWEAVER_JOIN_TOKEN`, not as a command-line argument.

The console's installer line keeps the token out of the shell history: it reads it without echo and hands it to the installer through the environment.

```sh
printf 'Join token: ' && read -rs LOADWEAVER_JOIN_TOKEN && echo && export LOADWEAVER_JOIN_TOKEN && \
  curl -fsSL https://<console>/api/install/install.sh | sudo --preserve-env=LOADWEAVER_JOIN_TOKEN bash -s -- --name <node>
```

## What happens on join

1. The agent generates its WireGuard key (X25519) and node key (ECDSA P-256) locally. Private keys never leave the node.
2. The control plane validates the token, allocates the node's overlay addresses and pod subnets (IPv4 and IPv6), issues the node certificate and records the join in the audit log, all in one transaction.
3. The network is recompiled. The agent connects over its outbound stream and receives its desired state.
4. As soon as the WireGuard path to a control-plane member is up, the agent moves its stream onto it (make-before-break); the path used for joining is no longer needed.

Hosts that already run containers or compose projects, and former Loadweaver nodes, join with `install.sh --discover`: only the agent is installed, it discovers read-only and joins as `pending` (no desired state) until the import wizard's join plan is applied — see [Importing Docker hosts and former nodes](./import.md).

## Control-plane growth

| Nodes       | Control plane                                      | Failover       |
| ----------- | -------------------------------------------------- | -------------- |
| 1           | 1 member                                           | none           |
| 2           | 2 members, data replicated                         | manual confirm |
| 2 + witness | 2 members + witness vote                           | automatic      |
| 3 or more   | 3 members (5 when configured), spread across sites | automatic      |

Membership is computed continuously: new members are taken from the least represented site, existing members stay while they are healthy, and sizes above two stay odd. Imported nodes whose host services use member ports are never promoted ([Importing](./import.md#conflicts)).

Each member's Postgres serves a server certificate from the cluster CA (name `postgres.loadweaver` plus the member's overlay address, valid for a year); the API on every member connects with TLS and verifies it. The control plane stores one certificate per member and sends the same one with every desired state, so pushes of an unchanged state are identical whichever control-plane replica sends them. It issues a new one when the member's address or the cluster CA changed, or once only a third of the lifetime is left; a daily check re-sends the desired state to members whose certificate passed two thirds of its lifetime, so a member renews even when nothing else changes (`LOADWEAVER_POSTGRES_CERTIFICATE_RENEWAL=off` disables the check). The agent switches to the new certificate on the same rules, with one Postgres restart.

## Lifecycle

- **Pending**: joined with `--discover`, waiting for its join plan; no desired state, nothing changed on the host (its agent still sends heartbeats and metrics). Cordon / drain don't apply; discarding the import (`DELETE /api/imports/{node}`) lets it leave right away.
- **Importing**: its join plan is applied; the planner places its imported deployments, the import controller installs the components and then activates it.
- **Cordon**: no new workloads on the node.
- **Drain**: prepares the node for leaving.
- **Leave**: only for drained nodes; the node identity is revoked immediately and its tunnels disappear from every other node. The last node can't leave.

Former nodes can join again under their old name with a new token; with `--discover`, replicas the cluster still assigns to them are reused ([Importing](./import.md#former-nodes)).
