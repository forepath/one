# Secrets and Encryption

## Secrets

Compose `secrets` and `configs` reference values by name, never by content: `secret://<project>/<name>`. Values are set through the API (`/api/projects/{project}/secrets`), are write-only and versioned. A plan pins the version each deployment uses; rotating a secret is a plan with `refresh`.

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
