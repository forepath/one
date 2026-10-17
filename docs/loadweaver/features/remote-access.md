# Remote Access

People, machines and whole offices can join the cluster's network over WireGuard. A client reaches exactly what policies allow, like any workload: "sales may reach the CRM on 443" is a policy from a client group to a workload group.

```yaml
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: cluster }
spec:
  remoteAccess:
    nodeGroup: vpn # the gateways
    endpoint: vpn.example.com # one name for all clients, points at the gateway address
    pool: vpn-public # IpPool with purpose vpn, held by the same node group
    clientNetwork: 10.250.0.0/22 # client addresses (IPv4)
    port: 51800 # default
---
apiVersion: loadweaver.com/v1
kind: ClientGroup
metadata: { name: sales }
spec:
  idpGroups: [sales] # identity-provider groups (roles) whose users' devices belong here
  keyLifetimeDays: 30 # default
  requireMfa: true
  fullTunnel: false
  posture:
    diskEncryption: true
    screenLock: true
    minOsVersion: { macos: '14.5', windows: '10.0.22631' }
  restrictedGroup: sales-restricted
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: sales-to-crm }
spec:
  from: [{ clients: sales }]
  to: [{ group: crm, project: backoffice }]
  rules: [{ protocol: tcp, ports: [443] }]
```

## Gateways

- Every node of `remoteAccess.nodeGroup` runs the WireGuard interface `lw-vpn` with all valid clients as peers. Peers are updated with `wg syncconf` (the gateway key passes through stdin), so running sessions survive changes.
- The gateways share one key. It is created with the first compilation that has remote access, so gateways come up before anyone enrolls. A node that hasn't got the key leaves `lw-vpn` as it is and still applies the rest of its configuration.
- The **active** gateway is the one holding the gateway address (`vpn/0`) from the pool. It alone gets the first address of the client network, routes the office subnets and carries the clients' traffic. Clients count as located there in every policy; without an active gateway they reach nothing.
- Standby gateways keep the peers, so a failover only moves the address (see [Public addresses](./public-addresses.md)).
- The active gateway reports active sessions (handshake in the last 3 minutes) every minute.

## Enrolling a device

The key pair is generated on the device; the private key never leaves it.

```bash
wg genkey | tee key | wg pubkey   # prints the public key
curl -X POST https://<control-plane>/api/vpn/devices \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name": "laptop", "publicKey": "<public key>"}'
```

- Enrollment needs an interactive login, not a personal access token. The device joins every client group whose `idpGroups` contain one of the user's roles; users in none can't enroll.
- If any of those groups sets `requireMfa`, the login must carry a second factor in its `amr` claim.
- The answer contains a wg-quick configuration with a placeholder for the private key: put the content of `key` there. A user can have up to 20 active devices and enroll at most 20 per day.
- `GET /api/vpn/devices/{id}/config` returns the current configuration again; it changes when policies do.

## Renewal and revocation

- Device keys expire after the shortest `keyLifetimeDays` of the device's groups. `POST /api/vpn/devices/{id}/renew` after a fresh interactive login (with a second factor where required) extends it, takes the groups from the current roles and can rotate the public key.
- `DELETE /api/vpn/devices/{id}` revokes at once; the gateways drop the peer with the next push. Owners revoke their own devices, admins anyone's.
- `POST /api/vpn/users/{userId}/revoke` revokes every device of a user, e.g. when they leave.
- The address of a revoked or expired client is given out again after 7 days. The client itself is deleted 90 days after it was revoked or expired.

## Machines and offices

Admins add machine clients, optionally with office networks behind them (site-to-site):

```bash
curl -X POST https://<control-plane>/api/vpn/machines \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name": "office-berlin", "publicKey": "<public key>", "groups": ["office"], "subnets": ["192.168.10.0/24"], "lifetimeDays": 365}'
```

- Subnets must be IPv4 and may not overlap the client network, the cluster's pod, service and overlay ranges, or another machine's subnets.
- The office subnets are routed to the machine and act as client addresses in policies.
- Machine keys last `lifetimeDays` (default 365, at most 3650). Admins renew them with `POST /api/vpn/machines/{id}/renew` (body `{ "lifetimeDays": 365 }`, optional, same limits); the new expiry counts from now.
- Hosts behind an office router resolve cluster names only through the router's own client address: DNS answers depend on the client address, so the office subnets get no view of their own.

## What a client gets

- **Split tunnel** (default): IPv4 routes for exactly what its policies allow, the service IPs it may reach and the DNS address. Nothing else goes through the tunnel.
- **Full tunnel** (`fullTunnel` on any of its groups): `0.0.0.0/0` and `::/0`; all traffic goes through the cluster and its egress policies.
- Hostname destinations only work with a full tunnel: a split tunnel routes by address, so traffic to the host never reaches the gateway. The plan warns about such policies.
- **Split DNS:** the gateway's client-network address answers DNS for the cluster's names, showing only the names the client may reach.
- Web traffic of clients goes through [egress filtering](./egress-filtering.md) on the active gateway.

## Policies with clients

- `{ clients: <group> }` works as source or destination of cluster-wide policies.
- In project policies, clients can only be sources, and may only reach the project's own workloads (selectors or the project's own workload groups): no other projects, nodes, sites or the internet.
- `http` matches don't apply to clients: such a rule is skipped for them, with a warning.
- L7 denies are not enforced for clients either; only allow policies decide what they reach.

## Posture

A client group can require device checks. Devices report them with `POST /api/vpn/devices/{id}/posture` (interactive login).

- A user device reports only for itself; admins report only for machines.
- Core checks: `diskEncryption`, `firewall`, `screenLock`, `minOsVersion` per platform, `minAppVersion`. The device's app reports them itself; plugins are the independent source.
- Plugins (`DYNAMIC_POSTURE_PLUGINS`) ask an MDM or EDR for a verdict; `require: compliant` needs `compliant`, `require: low-risk` accepts `compliant` or `low-risk`. A plugin that isn't installed, fails or takes longer than 10 seconds gives `unknown`, which fails.
- A missing report, or one older than 24 hours, fails.
- The `deviceId` is pinned once a plugin recognised it (a verdict other than `unknown`). Later reports with another id are rejected, and no other valid client can report a pinned id.
- A failing device loses the group and gets its `restrictedGroup` instead (or nothing). The restricted group can't have posture requirements of its own, so it is always reachable. The device list shows why a device is restricted.

## Plan checks

- `remoteAccess.nodeGroup` must exist, and the pool's `nodeGroup` must be the same group.
- The client network must be IPv4 and at least a `/29`, and may not overlap the pod, service or overlay ranges.
- The client network can't move while enrolled (valid) clients have addresses outside it: revoke them first.
- `remoteAccess.port` may not lie in the range of the node links (51820–52843).
- `ClientGroup`s need `remoteAccess` in the `Cluster`; restricted groups and client groups named in policies must exist.
- Project policies with clients as destinations, or with client sources reaching beyond the project's own workloads, are rejected.

## Apps

Desktop and mobile apps and a CLI command for enrollment and posture reports come later. Until then, use the API and any WireGuard client.

## Ports

| Port               | Where                                  | Purpose                      |
| ------------------ | -------------------------------------- | ---------------------------- |
| 51800 / udp        | gateways (`remoteAccess.port`)         | WireGuard for clients        |
| 53 / udp, tcp      | active gateway, client-network address | Split DNS for clients        |
| 15080, 15444 / tcp | active gateway, client-network address | Egress filtering for clients |
