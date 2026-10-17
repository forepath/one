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

## What happens on join

1. The agent generates its WireGuard key (X25519) and node key (ECDSA P-256) locally. Private keys never leave the node.
2. The control plane validates the token, allocates the node's overlay addresses and pod subnets (IPv4 and IPv6), issues the node certificate and records the join in the audit log, all in one transaction.
3. The network is recompiled. The agent connects over its outbound stream and receives its desired state.
4. As soon as the WireGuard path to a control-plane member is up, the agent moves its stream onto it (make-before-break); the path used for joining is no longer needed.

## Control-plane growth

| Nodes       | Control plane                                      | Failover       |
| ----------- | -------------------------------------------------- | -------------- |
| 1           | 1 member                                           | none           |
| 2           | 2 members, data replicated                         | manual confirm |
| 2 + witness | 2 members + witness vote                           | automatic      |
| 3 or more   | 3 members (5 when configured), spread across sites | automatic      |

Membership is computed continuously: new members are taken from the least represented site, existing members stay while they are healthy, and sizes above two stay odd.

## Lifecycle

- **Cordon**: no new workloads on the node.
- **Drain**: prepares the node for leaving.
- **Leave**: only for drained nodes; the node identity is revoked immediately and its tunnels disappear from every other node. The last node can't leave.

Former nodes can join again under their old name with a new token.
