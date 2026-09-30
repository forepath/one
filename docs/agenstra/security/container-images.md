# Container image security

This page documents **first-party Docker images**: runtime users, bind mounts, entrypoints, and the **root bootstrap → privilege drop** model (no in-container `sudo`). It complements **[Operational hardening](./operational-hardening.md)** and **[Docker deployment](../deployment/docker-deployment.md)**.

For image build targets and registry names, see **[Backend Agent Manager](../applications/backend-agent-manager.md)** (`project.json` / `Dockerfile.*`).

## Runtime users

| Image family                                             | User       | Default UID/GID | Notes                                   |
| -------------------------------------------------------- | ---------- | --------------- | --------------------------------------- |
| Manager/controller **API**, **worker**, **VNC**, **SSH** | `agenstra` | **10001**       | `ARG APP_UID` / `APP_GID` at build time |
| Frontend **server** images (agent console, portal, docs) | `node`     | **1000**        | Alpine-based SSR images                 |

Entrypoints start as **root** only long enough for privileged bootstrap (bind-mount `chown`, Docker socket GID sync, SSH `chpasswd`/`sshd`). They then **`exec setpriv --reuid=agenstra --regid=agenstra --init-groups`** so the long-running process is never root. The `sudo` package is **not** installed; there is no `/etc/sudoers.d` allowlist.

## Workspace vs home (invariant)

| Path | Role |
| ---- | ---- |
| **`/app`** | Agent **workspace** (`WORKDIR` + bind mount of `/opt/agents/{uuid}` for worker/SSH). Git clone target for OpenCode (`getBasePath()`). May be a git repo. |
| **`/home/agenstra`** | User **`$HOME`** (`ENV HOME`, `useradd --home-dir`). Credentials and tooling: `.ssh`, `.netrc`, `.opencode` (CLI), `.config/opencode`. **Not** bind-mounted to the agent volume. |
| **`/home/agenstra/environment`** | VNC-only mount of the same host agent volume (desktop view of the workspace). |

**Why this split matters:** If `$HOME` were the workspace, tools would write `.ssh`, `.opencode`, and similar into a directory that can be committed and pushed. Keep workspace and home separate.

Project-level OpenCode context under **`/app/.opencode/`** (agent rules/commands in the repo) is intentional and distinct from **`$HOME/.opencode`** (CLI install under home).

## Agent workload bind mounts

When the agent manager creates an agent, it bind-mounts host paths into child containers (`AgentsService`):

| Host path            | Container path                      | Access        | Used by                              |
| -------------------- | ----------------------------------- | ------------- | ------------------------------------ |
| `/opt/agents/{uuid}` | Provider **`basePath`** (see below) | Read/write    | Primary worker, optional SSH sidecar |
| `/opt/agents/{uuid}` | `/home/agenstra/environment`        | Read/write    | VNC virtual workspace only           |
| `/opt/agents`        | `/opt/workspace`                    | **Read-only** | All of the above                     |

**Provider `basePath`:**

| Agent type | Primary image             | `basePath` | Git clone target |
| ---------- | ------------------------- | ---------- | ---------------- |
| `opencode` | `agenstra-manager-worker` | `/app`     | `/app`           |

The same host directory is shared across the worker, SSH, and VNC containers for one agent; only the **in-container mount point** differs (for example worker `/app` vs VNC `/home/agenstra/environment`).

### Host directory ownership

Docker may create missing bind-mount sources on the host as **root-owned** directories. Entrypoints run plain **`chown -R agenstra:agenstra`** as root on the writable mount, then drop privileges with **`setpriv`**. Operators should still provision **`/opt/agents`** with appropriate host permissions in production (for example ownership **10001:10001** or a dedicated group).

### Entrypoints outside masked paths

Entrypoint scripts live under **`/usr/local/bin/docker-entrypoint.sh`**, not under bind-mounted workspace paths (for example `/app`), so a workspace mount cannot hide the container startup script.

## Privilege model (no sudo)

| Image                               | Root bootstrap steps                                              | Then (as `agenstra`)                          |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| **worker**                          | `chown -R agenstra:agenstra /app`                                 | `opencode serve` via `setpriv`                |
| **VNC**                             | `chown -R agenstra:agenstra /home/agenstra/environment`           | VNC/XFCE/websockify via `setpriv`             |
| **SSH**                             | `chown /app`; `chpasswd`; start `sshd`                            | idle `tail -f` via `setpriv`                  |
| **Manager API**, **controller API** | Sync `docker` group GID to `/var/run/docker.sock`; `usermod -aG` | Node via `setpriv --init-groups`              |

**Runtime ownership from the manager API** (for example ensuring `~/.config/opencode` exists): Docker **`exec` as UID 0** (`sendCommandToContainer(..., { user: '0' })`), not in-container `sudo`. Same pattern as Layer VFS installs.

**Layer VFS absolute paths** (for example `/opt/skills/…`): the agent manager installs these with Docker **`exec` as UID 0**, keeps **root ownership**, and sets mode **`u=rwX,go=rX`** so OpenCode (`agenstra`) can **read** them but cannot rewrite injected context. Workspace-relative paths under `/app` stay as the runtime user.

**Operator check** (after rebuild):

```bash
docker exec -u agenstra <container> which sudo   # expect: empty / not found
docker exec -u agenstra <container> id -u        # expect: 10001
docker exec <container> id -u                    # main process after setpriv: 10001
```

## Manager and controller API images

- Mount **`/var/run/docker.sock`** only when the service must create agent containers on the host.
- Build-time **`DOCKER_GID`** (default **995**) should match the host `docker` group:
  `stat -c '%g' /var/run/docker.sock`
- Entrypoint: if the socket is present, sync the `docker` group GID as root, add `agenstra` to `docker`, then **`setpriv --init-groups`** and start Node so socket access is effective without running Node as root.
- Secrets (database, Keycloak, `STATIC_API_KEY`, etc.) are supplied at **deploy time**, not as default `ENV` in the image.
- **`VERSION`** is baked at image build time (`ARG`/`ENV`, `--build-arg VERSION=$VERSION`). Release sets it from semantic-release (`release.yml` after `needs: publish`). Runtime `VERSION` / `APP_VERSION` may override.
- Debian-based images (`Dockerfile.api`, worker, SSH, VNC) run `apt-get upgrade` after `apt-get update` so OS packages such as `perl-base` pick up Debian security fixes newer than the published base tag.

## SSH sidecar image

- Runtime **`SSH_PASSWORD`** is **required** (no default in the image).
- Interactive login user: **`agenstra`** (console SSH URLs use `agenstra@` by default).
- **`PermitRootLogin no`** in `sshd_config`.
- Entrypoint starts `sshd` as root, then drops to `agenstra` for the keep-alive process.

## VNC image

- Runtime **`VNC_PASSWORD`** is **required**.
- Shared agent repo is mounted at **`/home/agenstra/environment`**, not `/app`.
- `$HOME` is still **`/home/agenstra`** (desktop config under home; workspace under `environment`).
- TigerVNC / XFCE / websockify run as `agenstra` after startup `chown` and `setpriv`.

## Coordinated upgrades

Deploy **manager API, controller API, worker, VNC, and SSH** images from the **same release tag** when user IDs, home paths, privilege model, or mount layouts change. Mismatched tags can break shared volumes or console SSH/VNC URLs.

## Related documentation

- **[Operational hardening](./operational-hardening.md)** Summary table and cross-links
- **[Docker deployment](../deployment/docker-deployment.md#container-security-images)** Compose and `DOCKER_GID`
- **[Production checklist](../deployment/production-checklist.md)** Pre-flight checks
- **[VNC browser access](../features/vnc-browser-access.md)** Feature architecture
- **[Environment configuration](../deployment/environment-configuration.md)** Per-provider image env vars
