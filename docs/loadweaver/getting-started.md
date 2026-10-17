# Getting Started

## 1. Create a cluster on the first server

On a supported host (see [host requirements](./deployment/host-requirements.md)) with the node agent installed:

```bash
sudo loadweaver-agent bootstrap --name n1 --public-host n1.example.com
sudo systemctl enable --now loadweaver-agent
```

`bootstrap` generates the control-plane secrets, starts etcd, Postgres (Patroni, TimescaleDB) and the Loadweaver API on this node, creates the cluster (id, certificate authority, default `Cluster` and `Site` resources) and joins the node with a one-time token. One node is a complete cluster, without high availability.

The first user who registers in the console becomes the administrator. Register right after the bootstrap.

## 2. Add nodes

Create a join token (valid for one hour, usable once):

```bash
curl -X POST https://cp.example.com/api/join-tokens -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"site": "default"}'
```

Run the installer on the new server:

```bash
curl -fsSL https://cp.example.com/api/install/install.sh | sudo LOADWEAVER_JOIN_TOKEN=<token> bash -s -- --name n2 --endpoint-host n2.example.com
```

The control plane grows automatically: two nodes replicate the database, three nodes give automatic failover. See [nodes and joining](./features/nodes-and-joining.md).

## 3. Declare your first policy

```yaml
apiVersion: loadweaver.com/v1
kind: NodeGroup
metadata: { name: storage }
spec:
  selector: { matchLabels: { role: storage } }
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: storage-replication }
spec:
  from: [{ group: storage }]
  to: [{ group: storage }]
  rules: [{ protocol: tcp, ports: ['7000-7100'] }]
```

Submit it as a plan, review the compiled effect (tunnels, routes, firewall rules), then apply it. See [plan and apply](./features/plan-and-apply.md).
