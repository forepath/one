# Groups and Policies

Everything in Loadweaver is a policy: two endpoints can only talk if a policy allows it.

## Groups

| Kind            | Members                                                    | Scope   |
| --------------- | ---------------------------------------------------------- | ------- |
| `NodeGroup`     | Nodes selected by labels or names                          | Cluster |
| `WorkloadGroup` | Services selected by labels                                | Project |
| Built-in        | `internet`, `cluster`, `control-plane`, `{ site: <name> }` | —       |

Members of one group may talk to each other (`intraGroup: allow`, the default) unless the group sets `intraGroup: isolate`.

## Policies

```yaml
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: web-to-db, project: shop }
spec:
  mode: enforce # or monitor: allowed and logged as "observed"
  from: [{ group: web }]
  to: [{ group: db }]
  rules: [{ protocol: tcp, ports: [5432] }]
```

- Between groups, policies only **allow**. `deny` exists only at L7 (hostname destinations or HTTP matches), where deny wins.
- Policies are **never transitive**: A ↔ B and B ↔ C don't let A reach C.

## What a policy compiles to

| Layer     | Effect                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tunnels   | A WireGuard link between two nodes exists only if a policy needs it; AllowedIPs list exactly the remote addresses involved |
| Routing   | BIRD exchanges a node's pod subnet only with nodes whose workloads may talk to it                                          |
| Filtering | Stateful nftables rules on both ends; everything else on Loadweaver interfaces is dropped and logged                       |
| DNS       | `<service>.<project>.lw` resolves only for callers that may reach the service                                              |

Control-plane traffic (agents to the API, etcd / Postgres between members, BGP sessions) is expressed as built-in policies and shows up like any other edge. Clusters with 16 or more nodes route it through two route reflectors / hubs per site, so the number of tunnels grows with the policies, not with the square of the node count.
