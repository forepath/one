# Agenstra Manager

The Agenstra agent manager runs AI agent environments. This app installs it with **Loadweaver as its runtime** (`AGENT_RUNTIME=loadweaver`): each environment becomes a Loadweaver deployment in the project you install into, at the isolation level it asks for (gVisor, gVisor on KVM or a microVM), with egress filtered by the cluster's node proxies. Release **4.1.0**, the same images as the Docker Compose setup, pinned by digest.

It is the app store form of [Agenstra on Loadweaver](https://github.com/forepath/one/blob/main/docs/loadweaver/guides/agenstra-on-loadweaver.md). The Docker-host runtime, Decabill's bundled `agenstra-manager` stack and Agenstra Cloud stay available.

| Service    | Image                                         | Notes                                  |
| ---------- | --------------------------------------------- | -------------------------------------- |
| `api`      | `ghcr.io/forepath/agenstra-manager-api:4.1.0` | Runs in gVisor, no Docker socket       |
| `postgres` | `postgres:16-alpine`                          | Bundled unless `bundlePostgres: false` |

Agent environments use `agenstra-manager-worker:4.1.0` and `agenstra-manager-worker-microvm:4.1.0`, also pinned by digest.

## Before you install

1. Install into the project the environments should live in (`loadweaverProject` is that project's name).
2. Create a personal access token of a **project operator** with the scopes `projects:read resources:read plans:create plans:apply secrets:write logs:read metrics:read live:access live:exec`.
3. Create the secrets in the project:

   | Secret                       | Value                                           |
   | ---------------------------- | ----------------------------------------------- |
   | `db-password`                | Database password                               |
   | `encryption-key`             | `openssl rand -base64 32`                       |
   | `static-api-key`             | `openssl rand -hex 32` (the controller uses it) |
   | `agent-context-token-secret` | `openssl rand -hex 32`                          |
   | `loadweaver-token`           | The token from step 2                           |

4. Point `domain` at the cluster's ingress. Only the controller-facing routes are exposed (`/api/agents`, `/api/egress`, `/api/config`, `/api/health`, `/api/instance-status`, `/api/isolation`, `/socket.io`); the agent context API stays inside the cluster.

## Parameters

| Parameter                                                 | Default    | Meaning                                                                 |
| --------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `domain`                                                  | (required) | Hostname the controller reaches the manager on                          |
| `loadweaverUrl`                                           | (required) | This cluster's control-plane URL                                        |
| `loadweaverProject`                                       | (required) | The project the app is installed into                                   |
| `corsOrigin`                                              | empty      | Browser origins of the Agenstra console                                 |
| `environmentVolumeSize`                                   | `20g`      | Volume of each agent environment                                        |
| `sandboxKvmEnabled`, `microvmEnabled`                     | `true`     | Offer the gVisor-on-KVM and microVM levels (where nodes pass the probe) |
| `microvmCpus`, `microvmMemory`                            | `2`, `2g`  | Guest size of microVM environments                                      |
| `bundlePostgres` / `dbHost`, `dbPort`, `dbUser`, `dbName` | `true` / … | Bundled database or an existing PostgreSQL 16                           |
| `postgresVolumeSize`                                      | `10g`      | Size of the bundled database volume                                     |

## After the install

In the Agenstra console, add a client with the manager URL `https://<domain>` and the `static-api-key`.

## Licence

AGPL-3.0-or-later.
