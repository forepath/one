# Topology Map

The topology map shows the cluster as a graph: where things run, which groups may talk to which, how nodes are tunnelled, where volume copies live, which hostnames and public addresses lead to which replicas, and the traffic that actually flowed. It can be wound back in time and can show what a pending plan would change. The console draws it; the API below serves the same data.

## What the map shows

Elements:

| Kind       | Id                                                                                                        | What                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site`     | `site:<site>`                                                                                             | A site, with its health                                                                                                                                                                                                   |
| `node`     | `node:<node>`                                                                                             | A node inside its site (`parent`): health, control-plane member, witness, ingress, overlay addresses                                                                                                                      |
| `replica`  | `replica:<replica id>`                                                                                    | A replica inside its node (`parent`): project, deployment, service, addresses, runtime state and health; for [autoscaled](./autoscaling.md) services also `autoscaled` (`4 (2..10)`), `lastScaled` and `autoscaleBlocked` |
| `group`    | `group:<project>/<group>`                                                                                 | A workload group (`exposed` when it is reachable from the internet)                                                                                                                                                       |
| `volume`   | `volume:<project>/<deployment>/<name>`                                                                    | A volume, with its cross-site mode and health                                                                                                                                                                             |
| `hostname` | `hostname:<host>`                                                                                         | An ingress hostname (including status page hostnames)                                                                                                                                                                     |
| `address`  | `address:<address>`                                                                                       | A public address and its owner (an ingress, a policy's egress, …)                                                                                                                                                         |
| `external` | `external:<cidr or addr>`, `external:host:<name>`, `external:builtin:<group>`, `external:clients:<group>` | Anything outside the cluster: a policy's CIDR, hostname, built-in group or remote client group, a flow endpoint                                                                                                           |

Edges, grouped in layers the console turns on and off:

| Layer        | Edge kinds | What                                                                                                                  |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `policies`   | `member`   | A replica belongs to a group (a replica can be in several)                                                            |
| `policies`   | `policy`   | One edge per `from` × `to` pair of a policy, with the policy name, mode (`enforce` / `monitor`), action and rules     |
| `policies`   | `flow`     | Traffic: protocol, port, decision (`allowed`, `observed`, `denied`), the policy that matched, packets, bytes, bytes/s |
| `tunnels`    | `tunnel`   | A WireGuard tunnel between two nodes, once per pair, from the desired state                                           |
| `storage`    | `volume`   | A copy of a volume on a node: `primary`, `sync` or `async`                                                            |
| `dns`        | `exposure` | A hostname reaches a replica, through the service it routes to (`<project>/<deployment>/<service>`)                   |
| `addressing` | `address`  | The node that currently holds a public address                                                                        |

The structure is built from the desired state and the live state (health, replica states, volume placements, address holders) on every request, so it is never older than the request.

```bash
curl -s https://<control-plane>/api/topology -H "Authorization: Bearer $TOKEN"
```

```json
{
  "elements": [
    { "id": "site:fra", "kind": "site", "label": "fra", "data": { "health": "healthy" } },
    {
      "id": "node:n1",
      "kind": "node",
      "label": "n1",
      "parent": "site:fra",
      "data": { "health": "healthy", "controlPlane": true, "witness": false, "ingress": true, "overlay": ["10.240.0.1"] }
    },
    {
      "id": "replica:shop/web/api/0",
      "kind": "replica",
      "label": "api/0",
      "parent": "node:n1",
      "project": "shop",
      "data": { "deployment": "web", "service": "api", "addresses": ["10.241.0.12/32"], "state": "running", "health": "healthy" }
    },
    { "id": "group:shop/frontend", "kind": "group", "label": "frontend", "project": "shop", "data": { "exposed": true } }
  ],
  "edges": [
    {
      "id": "member:shop/frontend:shop/web/api/0",
      "kind": "member",
      "source": "group:shop/frontend",
      "target": "replica:shop/web/api/0",
      "layer": "policies",
      "data": {}
    }
  ],
  "at": "2026-10-18T09:00:00.000Z"
}
```

## Who sees what

| Caller                                                | Sees                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cluster-admin`, `infra-operator`, `auditor`          | the whole map                                                                                                                                                                                                                                    |
| project members (any role, of the projects they read) | their projects' replicas, groups and volumes, the edges between them, and the hostnames and outside peers (`external`) connected to them. No sites, nodes, tunnels, public addresses or traffic (`flows=true` is ignored); replicas have no node |

- An edge is only shown when both its ends are visible. A policy edge from a group of your project to a group of another project is not shown; neither are volume copies (they point at nodes).
- Hostnames and outside peers only appear where an edge connects them to something visible.
- Traffic is for cluster roles only: flows carry addresses and policy names of every project, not a project of their own (see [Metrics](./metrics.md)).
- Policies with an inline `selector` peer get an anonymous group of their project (`data.selector: true`, labelled with the selector) with its members; `site` peers end at the site (hidden from project members).
- A plan that isn't visible to the caller answers `404` as an overlay, and a path trace through a hostname without any visible replica answers `404`, the same as an unknown hostname.
- Personal access tokens need the scope `cluster:read`.

See [Projects and access](./projects-and-access.md#who-sees-what).

## Flows: live and timeline

With `flows=true`, the map gets `flow` edges from the [flow metrics](./metrics.md): the minute before `at` (default now), summed over all nodes, the top 2,000 by packets.

```bash
# now
curl -sG https://<control-plane>/api/topology -H "Authorization: Bearer $TOKEN" --data-urlencode 'flows=true'

# timeline: the minute before 08:30
curl -sG https://<control-plane>/api/topology -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'flows=true' --data-urlencode 'at=2026-10-17T08:30:00Z'
```

- Within the last 30 days the raw flows (`lw_flows`) are used: the edges are the minute before `at`, and `bytesPerSecond` is per second of that minute.
- Beyond 30 days only the hourly roll-up (`lw_flows_1h`) is left: the edges are the whole hour containing `at`, and `bytesPerSecond` is per second of that hour.
- Each side of a flow is a firewall set or an address. Sets are resolved with the sets of the node that reported the flow; an address of a replica becomes that replica, a node's overlay address that node, anything else stays an outside peer `external:<address>`.
- A set side with several members spreads the flow's packets and bytes evenly over them (`data.estimated: true`): totals are right, the split between members is an estimate.
- `at` (the response field) is the time the flows are for.

### Live

The Socket.IO namespace `socket/topology` (env `LOADWEAVER_TOPOLOGY_WEBSOCKET_NAMESPACE`) sends the flows of the last minute every 10 seconds. Authenticate in the handshake as with the other sockets; personal access tokens are refused.

```js
import { io } from 'socket.io-client';

const socket = io('https://<control-plane>/socket/topology', {
  auth: { Authorization: `Bearer ${token}` },
});

socket.emit('subscribe');
socket.on('flows', ({ at, edges }) => render(at, edges));
socket.on('error', ({ message }) => console.error(message));
// later
socket.emit('unsubscribe');
```

- Cluster roles only; others get `error` (`live traffic needs a cluster role`). Access is re-checked every minute: a removed cluster role ends the stream with that error.
- `flows` is `{ at, edges }`, the `flow` edges of `GET /api/topology?flows=true`. Outside peers that only appear in flows are referenced by id (`external:<address>`).
- The first subscriber gets flows right away, then every 10 seconds; they are computed once per tick for all subscribers and read from the database, so every control-plane replica serves them. The map's structure is cached for up to 10 seconds; a new compiled revision or any placement change (replicas placed, moved, draining or removed) refreshes it at once.
- Subscribing again on the same socket does nothing. `unsubscribe` or disconnecting stops the flows. A control-plane replica holds up to 2,000 subscribers and 5 per user; beyond that `subscribe` answers `error` (`too many subscribers`).

## Plan overlay

With `plan=<id>`, the answer carries `overlay`: element and edge ids and what the plan does to them (`create`, `update`, `delete`).

```bash
curl -sG https://<control-plane>/api/topology -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'plan=3f0c1d8e-5a2b-4c7d-9e10-6b4a2f8c9d31'
```

| Plan change            | Marked                                                  |
| ---------------------- | ------------------------------------------------------- |
| `WorkloadGroup`        | the group                                               |
| `Policy`               | its existing edges                                      |
| `Deployment`           | its replicas                                            |
| `Node`                 | the node                                                |
| `Policy` create/update | its proposed edges, added to the map as `create` if new |

- Proposed edges are computed from the policy in the plan and carry `data.proposed: true` (new outside peers and selector groups are added with them); an edge that already exists keeps its id and gets the plan's action.
- Project members only get marks for ids they can see.
- The plan must be visible to the caller (otherwise `404`). Any plan status works, so an applied plan can be looked at afterwards, against today's map.

## Path trace

`GET /api/topology/trace?host=<hostname>` follows a hostname into the cluster: the hostname, the public ingress addresses and the nodes holding them, the replicas behind it (with their node) and the volumes of their deployments.

```bash
curl -sG https://<control-plane>/api/topology/trace -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'host=shop.example.com'
```

```json
{
  "steps": [
    { "kind": "hostname", "id": "hostname:shop.example.com", "label": "shop.example.com" },
    { "kind": "address", "id": "address:203.0.113.10", "label": "203.0.113.10 → n1" },
    { "kind": "replica", "id": "replica:shop/web/api/0", "label": "api/0 on n1" },
    { "kind": "volume", "id": "volume:shop/web/data", "label": "shop/web/data" }
  ]
}
```

- The host is matched case-insensitively; wildcard hostnames can't be traced.
- Project members get the replicas and volumes of the projects they read, without addresses and nodes. A hostname with none of their replicas answers `404`.
- The address steps are all public addresses owned by an ingress, not only the ones the hostname's DNS records point at.

## Not there yet

- Flow edges are summed over the whole cluster per source, destination, protocol, port and decision; they don't say which node reported them.
- Traffic for project members needs flows attributed to projects.
- The overlay compares a plan with the current map, not with the map at the time the plan was made.
