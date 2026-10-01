# Container image security

This page documents **first-party Docker images**: runtime users, bind mounts, entrypoints, and **restricted `sudo`**. It complements **[Operational hardening](./operational-hardening.md)** and **[Docker deployment](../deployment/docker-deployment.md)**.

For image build targets and registry names, see **[Backend Agent Manager](../applications/backend-agent-manager.md)** (`project.json` / `Dockerfile.*`).

## Runtime users

| Image family                                             | User       | Default UID/GID | Notes                                   |
| -------------------------------------------------------- | ---------- | --------------- | --------------------------------------- |
| Manager/controller **API**, **worker**                   | `agenstra` | **10001**       | `ARG APP_UID` / `APP_GID` at build time |
| Frontend **server** images (agent console, portal, docs) | `node`     | **1000**        | Alpine-based SSR images                 |

Processes do **not** run as root after container start. The optional SSH image still starts **`sshd`** via a single allowed `sudo` invocation in the entrypoint.

## Agent workload bind mounts

When the agent manager creates an agent, it bind-mounts host paths into child containers (`AgentsService`):

| Host path            | Container path                      | Access        | Used by          |
| -------------------- | ----------------------------------- | ------------- | ---------------- |
| `/opt/agents/{uuid}` | Provider **`basePath`** (see below) | Read/write    | Primary worker   |
| `/opt/agents`        | `/opt/workspace`                    | **Read-only** | All of the above |

**Provider `basePath`:**

| Agent type | Primary image             | `basePath` | Git clone target |
| ---------- | ------------------------- | ---------- | ---------------- |
| `opencode` | `agenstra-manager-worker` | `/app`     | `/app`           |

Each agent worker mounts its host directory at the provider **`basePath`** (typically `/app`).

### Host directory ownership

Docker may create missing bind-mount sources on the host as **root-owned** directories. Entrypoints run **`sudo chown -R agenstra:agenstra`** on the writable mount so UID **10001** can use the workspace. Operators should still provision **`/opt/agents`** with appropriate host permissions in production (for example ownership **10001:10001** or a dedicated group).

### Entrypoints outside masked paths

Entrypoint scripts live under **`/usr/local/bin/docker-entrypoint.sh`**, not under bind-mounted workspace paths (for example `/app`), so a workspace mount cannot hide the container startup script.

## Restricted `sudo`

`agenstra` is **not** a member of the Debian **`sudo`** group. Full `sudo` with a password is therefore **not** available. Privilege is granted only via **`/etc/sudoers.d/agenstra`**, with **passwordless** (`NOPASSWD`) access to explicit binaries:

| Image                               | Allowed commands (passwordless only)                            | Purpose                                                                                        |
| ----------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **worker**                          | `/usr/bin/chown`                                                | Fix ownership on `/app` bind mount at startup                                                  |
| **Manager API**, **controller API** | `/usr/sbin/groupmod`, `/usr/sbin/groupadd`, `/usr/sbin/usermod` | Align in-container `docker` group GID with mounted `/var/run/docker.sock` before starting Node |

Any other `sudo` attempt (for example `sudo bash`, `sudo apt`) should **fail** with “not allowed” and must not prompt for a password.

**Layer VFS absolute paths** (for example `/opt/skills/…`): the agent manager installs these with Docker **`exec` as UID 0** from the API host (not in-container `sudo`), keeps **root ownership**, and sets mode **`u=rwX,go=rX`** so OpenCode (`agenstra`) can **read** them but cannot rewrite injected context. Workspace-relative paths under `/app` stay as the runtime user.

**Operator check** (after rebuild):

```bash
docker exec -u agenstra <container> sudo id          # expect: not allowed
docker exec -u agenstra <container> sudo /usr/bin/chown --version   # expect: success (worker)
```

## Manager and controller API images

- Mount **`/var/run/docker.sock`** only when the service must create agent containers on the host.
- Build-time **`DOCKER_GID`** (default **995**) should match the host `docker` group:
  `stat -c '%g' /var/run/docker.sock`
- Entrypoint: if the socket is present, sync the `docker` group GID, add `agenstra` to `docker`, then start Node with **`sg docker`** so socket access is effective without running Node as root.
- Secrets (database, Keycloak, `STATIC_API_KEY`, etc.) are supplied at **deploy time**, not as default `ENV` in the image.
- **`VERSION`** is baked at image build time (`ARG`/`ENV`, `--build-arg VERSION=$VERSION`). Release sets it from semantic-release (`release.yml` after `needs: publish`). Runtime `VERSION` / `APP_VERSION` may override.
- Debian-based images (`Dockerfile.api`, worker) run `apt-get upgrade` after `apt-get update` so OS packages such as `perl-base` pick up Debian security fixes newer than the published base tag.

## Coordinated upgrades

Deploy **manager API and worker** images from the **same release tag** when user IDs, home paths, or mount layouts change. Mismatched tags can break shared volumes.

## Related documentation

- **[Operational hardening](./operational-hardening.md)** Summary table and cross-links
- **[Docker deployment](../deployment/docker-deployment.md#container-security-images)** Compose and `DOCKER_GID`
- **[Production checklist](../deployment/production-checklist.md)** Pre-flight checks
- **[Environment configuration](../deployment/environment-configuration.md)** Per-provider image env vars
