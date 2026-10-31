# Getting Started

## 1. Create a cluster on the first server

On a supported host (see [host requirements](./deployment/host-requirements.md)) with the node agent installed:

```bash
sudo loadweaver-agent bootstrap --name n1 --public-host n1.example.com
sudo systemctl enable --now loadweaver-agent
```

`bootstrap` generates the control-plane secrets, starts etcd, Postgres (Patroni, TimescaleDB) and the Loadweaver API on this node, creates the cluster (id, certificate authority, default `Cluster` and `Site` resources) and joins the node with a one-time token. One node is a complete cluster, without high availability.

The first user who registers in the console becomes the administrator (and a cluster admin, so their personal access tokens work for the registry and automation too). Register right after the bootstrap.

Give `bootstrap` your SMTP server (`--smtp-host`, `--smtp-port`, `--smtp-user`, `--smtp-password-file`, `--email-from`) so the cluster can send login codes, confirmations and alerts. Without it, the email code at login is not required (the console shows a warning to cluster admins); SMTP comes from the control-plane environment only and can't be changed on a running cluster yet, so set it at bootstrap. Set up an authenticator app under Security — see [Email and two-factor login](./console.md#email-and-two-factor-login).

A lost cluster is restored on a fresh node with `loadweaver-agent bootstrap --restore` from the external copy of its backups — see [Disaster recovery](./features/disaster-recovery.md).

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
