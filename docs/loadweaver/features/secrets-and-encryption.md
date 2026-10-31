# Secrets and Encryption

## Secrets

Compose `secrets` and `configs` reference values by name, never by content: `secret://<project>/<name>`. Values are set through the API (`/api/projects/{project}/secrets`), are write-only and versioned. A plan pins the version each deployment uses; rotating a secret is a plan with `refresh`.

`PUT` and `DELETE /api/projects/{project}/secrets/{name}` require a project **admin or operator**, or a **cluster admin**. Developers, viewers and non-members receive `403`; a cluster infra-operator role alone grants no write access (an infra operator must also be an admin or operator of that project). Names starting with `lw-` are platform-reserved: only cluster admins may write or delete them, never project roles, including through personal access tokens.

Personal access tokens require `secrets:write` and remain bounded by their owner's current effective roles. Denied writes return `403` before checking project existence. Every write and delete audits the actor, project and secret name, never the value. Nobody can read values back. **Listing** names and version metadata (`GET /api/projects/{project}/secrets`, cluster-wide `GET /api/secrets?project=&q=&limit=`, the name typeahead `…/secrets/names`) follows the write rule: project admins / operators of the project and cluster admins (`secrets:read` for PATs); `lw-` names are listed for cluster admins only. Each entry carries the current version, who set it when, and the resources referencing it with the version their last applied plan pinned (`usedBy`). `DELETE` is refused with `409` and that list while anything references the secret. Every secrets answer is sent with `Cache-Control: no-store`; malformed or oversized request bodies are rejected with a fixed message that never quotes the body.

### Managing secrets in the console

**Delivery › Secrets** lists every secret you may manage; a project's **Secrets** tab shows that project's. Add a secret with **+**, write a new version with **Set new value** (a password field, or **Or load a file** for multi-line values; the browser sends the value once and forgets it), then **Roll out**: a normal plan with `refresh` for the resources still pinned to an older version (preview, approvals and apply as usual). Through a fleet this works the same as long as the cluster verifies the fleet's identity: the fleet relays secrets only as the signed person (the cluster applies its own rules to that person and audits them on behalf of), streams the value through without logging or storing it, and records only method, project, name and status in its own audit log.

- Values are stored **envelope-encrypted**: every version has its own data key, wrapped by the cluster **master key**.
- Only the node that runs a workload referencing a secret receives its value, over the authenticated agent stream. It is written to **tmpfs** and mounted read-only into the container; it never touches a disk.
- Plans, logs and the audit log contain versions and fingerprints, never values. Names starting with `lw-` are reserved for the platform (for example volume keys).

## Master key

The master key exists only in the memory of running control-plane replicas. It is held in one of two ways:

**Split across the control-plane members (default).** The key is split Shamir-style (2 of 3, 3 of 5); every share is sealed to one member's key. A starting replica collects enough shares, re-encrypted for it alone, from the members' agents. Someone with only a database copy learns nothing. When the members change, the key is split again and every data key is re-wrapped. A single-node cluster holds its only share locally, which the plan reports as weaker.

**External KMS / Vault (optional).** With `LOADWEAVER_MASTER_KEY_KMS` set, the key is wrapped by the KMS instead and the control plane stores only the wrapped value:

| Variable                         | Meaning                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `LOADWEAVER_MASTER_KEY_KMS`      | `vault-transit`, or the id of a KMS plugin                         |
| `VAULT_ADDR`, `VAULT_TOKEN`      | Vault / OpenBao address (HTTPS) and token                          |
| `VAULT_NAMESPACE`                | Optional Vault namespace                                           |
| `LOADWEAVER_VAULT_TRANSIT_MOUNT` | Transit engine mount, default `transit`                            |
| `LOADWEAVER_VAULT_TRANSIT_KEY`   | Transit key, default `loadweaver`                                  |
| `DYNAMIC_KMS_PROVIDERS`          | Further KMS providers as plugins (same mechanism as other plugins) |

Switching between shares and a KMS, or to another KMS key, creates a new master key and re-wraps every data key; secret values themselves are not re-encrypted. Every change is recorded in the audit log.

### Built-in control-plane member

A control plane started on its own (for example the compose stack) has no node that could hold a share, so secrets, SOPS, provider credentials and backup keys would not work. The **built-in control-plane member** fills that gap: a key holder that runs **inside the existing control-plane API container** (no extra container). It is not a node, never appears as a schedulable node and never runs workloads; the console lists it read-only as **Control plane (built-in)** next to the nodes.

- **No control-plane node with a seal key registered:** the built-in member is the **active**, sole key holder (1 of 1).
- **One or more such nodes registered:** the shares and the threshold use the **real members only**. The built-in member keeps a **standby copy** of the key, re-sealed on every split / re-key, and does not answer unseal requests.
- **Back to zero:** when the last member is removed (deregistered, or marked as left), the built-in member **takes over** from its standby copy, also after an abrupt loss and a control-plane restart, and becomes the sole holder again. Members that are only **unreachable** but still registered don't trigger a takeover: the key stays sealed until enough of them answer.

Its private seal key is a file on the control-plane state volume (never in the database, never replicated to member control planes, never in the DR envelope); only its public key is registered.

| Variable                           | Default                             | Meaning                                                                                             |
| ---------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `LOADWEAVER_BUILTIN_MEMBER`        | `auto`                              | `auto` (as above), `always` (also a share holder next to the members, plus the standby copy), `off` |
| `LOADWEAVER_BUILTIN_MEMBER_DIR`    | `/var/lib/loadweaver-control-plane` | Directory of the seal key file (`builtin-seal.key`, 0600 in a 0700 directory), on its own volume    |
| `LOADWEAVER_BUILTIN_SEAL_KEY_FILE` | –                                   | Optional operator-managed key file (Docker / Kubernetes secret); never generated                    |

Control planes on member nodes always run with `off`. An external KMS replaces the built-in member as it replaces the shares.

The control-plane **database** follows the same members: an external control plane hands its database over to the first real member and keeps its own Postgres as a read-only copy, used again when no member is registered any more (see [Architecture: Control plane](../architecture/README.md#control-plane)).

**Security trade-off.** The standby copy means that a database dump **together with** the control-plane state volume can rebuild the master key, even while real members hold the shares. Either one alone is not enough. The console's inbox keeps a quiet info item about this for as long as the standby copy exists; protect the volume like the database, or set `off` / configure a KMS if that is not acceptable.

**Losing the volume.** While the built-in member is the only key holder (no node, no KMS), the state volume is the only place the key can be opened from: losing it loses the master key and every secret. The inbox shows a pinned warning ("only one key holder") until a node or a KMS holds the key. Back up the volume (compose: `control_plane_state`) and the backup recovery kit, or add a node / a KMS. If the volume is replaced while the registered key still holds the master key, the control plane does not overwrite the registration: it reports a seal-key mismatch (critical inbox item) until the original volume is mounted again.
