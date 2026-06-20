# Container image security

This page documents **first-party Docker images**: runtime users, bind mounts, entrypoints, and **restricted `sudo`**. It complements **[Operational hardening](./operational-hardening.md)** and **[Docker deployment](../deployment/docker-deployment.md)**.

For image build targets and registry names, see **[Backend Agent Manager](../applications/backend-agent-manager.md)** (`project.json` / `Dockerfile.*`).

## Runtime users

| Image family                                                                 | User       | Default UID/GID | Notes                                   |
| ---------------------------------------------------------------------------- | ---------- | --------------- | --------------------------------------- |
| Manager/controller **API**, **worker**, **VNC**, **SSH**, **agi** (OpenClaw) | `agenstra` | **10001**       | `ARG APP_UID` / `APP_GID` at build time |
| Frontend **server** images (agent console, portal, docs)                     | `node`     | **1000**        | Alpine-based SSR images                 |

Processes do **not** run as root after container start. The optional SSH image still starts **`sshd`** via a single allowed `sudo` invocation in the entrypoint.

## Agent workload bind mounts

When the agent manager creates an agent, it bind-mounts host paths into child containers (`AgentsService`):

| Host path            | Container path                      | Access        | Used by                              |
| -------------------- | ----------------------------------- | ------------- | ------------------------------------ |
| `/opt/agents/{uuid}` | Provider **`basePath`** (see below) | Read/write    | Primary worker, optional SSH sidecar |
| `/opt/agents/{uuid}` | `/home/agenstra/environment`        | Read/write    | VNC virtual workspace only           |
| `/opt/agents`        | `/opt/workspace`                    | **Read-only** | All of the above                     |

**Provider `basePath`:**

| Agent type           | Primary image             | `basePath`  | Git clone target      |
| -------------------- | ------------------------- | ----------- | --------------------- |
| `cursor`, `opencode` | `agenstra-manager-worker` | `/app`      | `/app`                |
| `openclaw`           | `agenstra-manager-agi`    | `/openclaw` | `/openclaw/workspace` |

The same host directory is shared across the worker, SSH, and VNC containers for one agent; only the **in-container mount point** differs (for example worker `/app` vs VNC `/home/agenstra/environment`).

### Host directory ownership

Docker may create missing bind-mount sources on the host as **root-owned** directories. Entrypoints run **`sudo chown -R agenstra:agenstra`** on the writable mount so UID **10001** can use the workspace. Operators should still provision **`/opt/agents`** with appropriate host permissions in production (for example ownership **10001:10001** or a dedicated group).

### Entrypoints outside masked paths

Entrypoint scripts live under **`/usr/local/bin/docker-entrypoint.sh`**, not under bind-mounted workspace paths (for example `/app`), so a workspace mount cannot hide the container startup script.

## Restricted `sudo`

`agenstra` is **not** a member of the Debian **`sudo`** group. Full `sudo` with a password is therefore **not** available. Privilege is granted only via **`/etc/sudoers.d/agenstra`**, with **passwordless** (`NOPASSWD`) access to explicit binaries:

| Image                               | Allowed commands (passwordless only)                            | Purpose                                                                                        |
| ----------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **worker**                          | `/usr/bin/chown`                                                | Fix ownership on `/app` bind mount at startup                                                  |
| **VNC**                             | `/usr/bin/chown`                                                | Fix ownership on `/home/agenstra/environment` bind mount                                       |
| **agi** (OpenClaw)                  | `/usr/bin/chown`                                                | Fix ownership on `/openclaw` bind mount                                                        |
| **SSH**                             | `/usr/bin/chown`, `/usr/sbin/chpasswd`, `/usr/sbin/sshd`        | Workspace ownership, set login password from `SSH_PASSWORD`, start SSH daemon                  |
| **Manager API**, **controller API** | `/usr/sbin/groupmod`, `/usr/sbin/groupadd`, `/usr/sbin/usermod` | Align in-container `docker` group GID with mounted `/var/run/docker.sock` before starting Node |

Any other `sudo` attempt (for example `sudo bash`, `sudo apt`) should **fail** with “not allowed” and must not prompt for a password.

**Operator check** (after rebuild):

```bash
docker exec -u agenstra <container> sudo id          # expect: not allowed
docker exec -u agenstra <container> sudo /usr/bin/chown --version   # expect: success (worker/vnc/agi/ssh)
```

## Manager and controller API images

- Mount **`/var/run/docker.sock`** only when the service must create agent containers on the host.
- Build-time **`DOCKER_GID`** (default **995**) should match the host `docker` group:
  `stat -c '%g' /var/run/docker.sock`
- Entrypoint: if the socket is present, sync the `docker` group GID, add `agenstra` to `docker`, then start Node with **`sg docker`** so socket access is effective without running Node as root.
- Secrets (database, Keycloak, `STATIC_API_KEY`, etc.) are supplied at **deploy time**, not as default `ENV` in the image.

## SSH sidecar image

- Runtime **`SSH_PASSWORD`** is **required** (no default in the image).
- Interactive login user: **`agenstra`** (console SSH URLs use `agenstra@` by default).
- **`PermitRootLogin no`** in `sshd_config`.

## VNC image

- Runtime **`VNC_PASSWORD`** is **required**.
- Shared agent repo is mounted at **`/home/agenstra/environment`**, not `/app`.
- TigerVNC / XFCE / websockify run as `agenstra` without `sudo` after startup `chown`.

## OpenClaw (agi) image

- Registry image: `ghcr.io/forepath/agenstra-manager-agi:latest` (override with `OPENCLAW_AGENT_DOCKER_IMAGE`).
- Gateway listens on port **18789**; `OPENCLAW_HOME=/openclaw`.

## Coordinated upgrades

Deploy **manager API, worker, VNC, SSH, and agi** images from the **same release tag** when user IDs, home paths, or mount layouts change. Mismatched tags can break shared volumes or console SSH/VNC URLs.

## Related documentation

- **[Operational hardening](./operational-hardening.md)** — Summary table and cross-links
- **[Docker deployment](../deployment/docker-deployment.md#container-security-images)** — Compose and `DOCKER_GID`
- **[Production checklist](../deployment/production-checklist.md)** — Pre-flight checks
- **[VNC browser access](../features/vnc-browser-access.md)** — Feature architecture
- **[Environment configuration](../deployment/environment-configuration.md)** — Per-provider image env vars
