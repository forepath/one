# Loadweaver Cloud

Loadweaver Cloud is a **dedicated cluster per customer** (own control plane, nodes and keys), ordered and billed through Decabill and operated through the multi-cluster console. Decabill's bundled service kind `loadweaver` provisions the first server as a complete single-node cluster; operator details are in Decabill's [server provisioning](../../decabill/features/server-provisioning.md#loadweaver-service-kind) docs.

## What you get

- One server with the control plane, the console and the node agent, set up with the normal `loadweaver-agent bootstrap` from the signed release (the manifest signature and the agent checksum are verified before anything runs).
- `https://<your-cluster>.<provider domain>`: the console on `/`, the API on `/api` (Let's Encrypt certificate, DNS record created by Decabill).
- The cluster secrets (database passwords, encryption key, JWT secret, certificate authority) are generated on the server itself. Decabill never sees them.

Decabill bills only this server, as a normal subscription. The **Cluster** tab of the service in the billing console shows the endpoint, the health of control plane and console, and the steps below.

## First steps

1. Open the console and **register right away** with the **admin claim token** from the Cluster tab: the first registered account becomes the cluster administrator. Until then, registration is refused without the token, so nobody who finds the URL first can take the cluster over. The tab hides the token once the cluster reports its first account.
2. Set up two-factor authentication and, under Backups, an external target for platform backups and the recovery kit (see [Disaster recovery](../features/disaster-recovery.md)).
3. Add nodes (below) and declare your workloads.

## Adding nodes

Further nodes run on **your own servers or provider accounts**. You pay the provider directly; Decabill neither provisions nor bills them.

1. In the console, create a join token (Nodes, Add node).
2. On the new server (see [host requirements](./host-requirements.md)), run the installer shown there:

   ```bash
   curl -fsSL https://<your-cluster>/api/install/install.sh | sudo LOADWEAVER_JOIN_TOKEN=<token> bash -s -- --name n2 --endpoint-host n2.example.com
   ```

The control plane grows automatically from two nodes on (see [nodes and joining](../features/nodes-and-joining.md)).

The Decabill-provisioned server serves the console and the API on ports 80 / 443 through its management proxy. Run public ingress on other nodes (keep this node out of the ingress pool).

## Updates

The cluster updates itself through Loadweaver's own rollout from signed release bundles (Updates in the console; see [Updates](../features/updates.md)). Decabill doesn't pull or restart anything of the cluster; it only aligns the console image of the management proxy with the version your cluster runs, **by digest**: every release's signed manifest pins the console image (`consoleImage`, built and resolved by the release pipeline next to the control-plane image the manifest already pins), and Decabill verifies that manifest's signature, product and version (as for the agent binary at provisioning) before it re-pins the console to that digest. Nothing is pulled by tag. If the plan pins the console image itself (`loadweaverConsoleImageDigest`), that pin wins at provisioning and is kept on updates (the console then doesn't follow the cluster version until the plan's digest changes).

## Security and trust model

- **Decabill keeps root SSH access** to the server it provisions (key-only, `PermitRootLogin prohibit-password`). The scheduler's update command (above) uses it. Root on the node can read everything the cluster keeps there (database, `ENCRYPTION_KEY`, `JWT_SECRET`, the cluster CA key), so the operator running Decabill is trusted with the cluster's secrets in the same way as the hosting provider (who can read the disk). Decabill never stores those secrets; they exist only on the node.
- **Narrowing the key (optional).** Operators who want Decabill's key limited to the update can restrict it with an OpenSSH forced command in `/root/.ssh/authorized_keys`, e.g. `command="/usr/local/sbin/loadweaver-cloud-update",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA…`, where the script runs the update command (and nothing else). The forced command ignores what the client sends, so the key can then only trigger console re-pins; rescue access goes through the provider's console. This is not the default: Decabill's scheduler sends the command it builds, and changes to that command would need the script on every server updated. Customers who don't accept operator root access should run their own cluster (self-hosted) and register it in the fleet instead.
- **API port off the public address.** The control-plane API listens on port 3400 on every address of the host (host network). The node's Loadweaver firewall only filters Loadweaver's own interfaces, so cloud-init adds an nftables table of its own (`inet loadweaver_cloud`, `/etc/loadweaver-cloud/firewall.nft`, loaded by `loadweaver-cloud-firewall.service` at every boot before Docker and the agent, and again whenever `nftables.service` reloads): port 3400 is dropped on every interface except loopback and Loadweaver's overlay / pod interfaces (`lw-*`, `lwbr0`, `lwk*`, still filtered by the Loadweaver table; status pages reach the members over the overlay). The only public way in is Nginx on 80 / 443, which proxies to `127.0.0.1:3400`. Check: `curl -m 5 http://<public IP>:3400/api/health` from outside must time out, `nft list table inet loadweaver_cloud` shows the drop counter. The agent stream (gRPC, port 7443) stays reachable for joining nodes.
- **Proxy hardening.** `server_tokens off`, HSTS (`max-age=31536000; includeSubDomains`) on the TLS server only, request bodies up to 64 MB on the API (the API's own limits are lower) and 1 MB on the console; release-bundle uploads, backup imports and registry pushes stream without a proxy limit (the control plane enforces `LOADWEAVER_BUNDLE_MAX_BYTES` and the import cap). Nginx overwrites `X-Forwarded-For` with the peer address (the control plane trusts it from loopback only) and limits `/api/` to 20 requests/s (burst 60) per client.

## Cancelling

Cancelling deletes the Decabill-provisioned server, its addresses and DNS records **with all cluster data on it**. Before you cancel:

1. Run a final platform backup and copy it to your external target (Backups, Platform).
2. Save the recovery kit and the disaster-recovery info file: without them a backup can't be restored.
3. Drain and remove nodes in your own provider accounts, or keep them for re-use. Decabill never deletes them.

The billing console asks you to confirm these steps explicitly; without the confirmation the cancellation is refused. After a regular cancellation takes effect, the cluster keeps running for a grace period (7 days by default, not billed) so you can still export. A withdrawal or an instant cancel (by you or an administrator) ends billing right away under the usual withdrawal rules, including the refund, but the server and its data stay for the same grace period before they are deleted. Withdrawing through the public e-mail-code form follows the same rule. The grace period is set with `LOADWEAVER_TEARDOWN_GRACE_DAYS` on the billing manager.

A cancelled cluster can be brought back on a new server from its external backups with `loadweaver-agent bootstrap --restore` (see [Disaster recovery](../features/disaster-recovery.md)).

## Admin claim

`loadweaver-agent bootstrap --admin-claim-token-file <file>` (or `LOADWEAVER_ADMIN_CLAIM_TOKEN`) protects the first registration of any new cluster in `users` mode, not only Loadweaver Cloud:

- The control plane stores only the token's SHA-256 (`ADMIN_CLAIM_TOKEN_SHA256` in its environment). It is replicated to every control-plane member and carried in the DR envelope, so a member or a restored cluster that was never claimed keeps requiring the token instead of opening the first registration.
- While no account exists, `POST /api/auth/register` needs `adminClaimToken` (constant-time comparison; 403 without or with a wrong token; 429 after repeated failures from one client). The console's registration form shows a claim-token field only while `GET /api/install/claim-status` returns `{ "claimRequired": true, "claimConfigured": true }`.
- **After the claim, registration is closed** (as with `DISABLE_SIGNUP`: `503 Signup is disabled`): the claimed administrator creates further users or invites them (Users page). The token is never checked again. Without the option nothing changes: the first registered account becomes administrator and signup follows `DISABLE_SIGNUP` (Agenstra and Decabill don't set it).
- `claimConfigured` tells whether the answering control plane has the claim at all. Decabill's Cluster tab wipes its copy of the token only on `claimConfigured: true` with `claimRequired: false`; a cluster that doesn't report `claimConfigured` (older release) keeps the token shown with the state "unknown".

Loadweaver Cloud hands the token over in the server's user-data (root-only file, removed after bootstrap, never on a command line or in a log). The provider's metadata service serves user-data to the server itself (and to the provider account) only, and the token is worthless once the first account exists.

## Open points

- **Final backup and read-only grace through the fleet.** Decabill holds no credentials for your cluster. When the operator has registered the cluster in the [fleet service](../features/fleet.md#loadweaver-cloud) and Decabill is configured with `LOADWEAVER_FLEET_URL` / `LOADWEAVER_FLEET_TOKEN`, the start of the grace period triggers the cluster's final backup (platform data, every volume, copies to your external targets) and caps access through the fleet at viewer until the teardown. Without that, Decabill links to the backup and recovery-kit pages and requires your confirmation, as before. Your own admin account in the cluster is never restricted.
- **Keep the Decabill-provisioned node out of the ingress pool.** Its management proxy holds ports 80 / 443 for the console and the API; run public ingress on your other nodes.

## Bootstrapping behind a TLS proxy

The service kind passes `--public-url https://<fqdn>` to `loadweaver-agent bootstrap`. This sets `LOADWEAVER_PUBLIC_URL` (installer line, registry token realm, OAuth callbacks) and `CORS_ORIGIN` of the new cluster to the origin the proxy serves. The same option works for self-hosted clusters that put console and API behind one proxy. The control plane's secret-free `GET /api/install/components.sh` returns the installer's component setup on its own, for a first node bootstrapped from a release agent.
