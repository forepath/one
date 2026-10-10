# Container image security

This page documents **first-party Docker images**: runtime users, bind mounts, and entrypoints that drop privileges. It complements **[Operational hardening](./operational-hardening.md)** and **[Docker deployment](../deployment/docker-deployment.md)**.

For image build targets and registry names, see **[Backend Agent Manager](../applications/backend-agent-manager.md)** (`project.json` / `Dockerfile.*`).

## Runtime users

| Image family                                             | User       | Default UID/GID | Notes                                   |
| -------------------------------------------------------- | ---------- | --------------- | --------------------------------------- |
| Manager/controller **API**, **worker**                   | `agenstra` | **10001**       | `ARG APP_UID` / `APP_GID` at build time |
| Frontend **server** images (agent console, portal, docs) | `node`     | **1000**        | Alpine-based SSR images                 |

Application processes do **not** run as root. Entrypoints may start as root only long enough to perform privileged bootstrap (`chown`, docker socket GID sync), then **`runuser`** / **`sg`** drops to `agenstra` before Node or OpenCode starts. Images do **not** install `sudo` or sudoers allowlists.

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

Docker may create missing bind-mount sources on the host as **root-owned** directories. The worker entrypoint runs as root, executes **`chown -R ${APP_UID}:${APP_GID} /app`**, then drops to `agenstra` for `opencode serve`. Provider config directories created after start are fixed with Docker **`exec` as UID 0** from the manager API (`AgentsService`), not via in-container `sudo`. Operators should still provision **`/opt/agents`** with appropriate host permissions in production (for example ownership **10001:10001** or a dedicated group).

### Entrypoints outside masked paths

Entrypoint scripts live under **`/usr/local/bin/docker-entrypoint.sh`**, not under bind-mounted workspace paths (for example `/app`), so a workspace mount cannot hide the container startup script.

### Managed environment volume

Worker images labelled `io.agenstra.environment-mount="1"` receive their environment from a per-agent Docker **named volume** (`agenstra-env-<id>`), mounted at **`/etc/agenstra/environment`**. Environment files are never placed under the shared, read-only `/opt/agents` tree.

- The image creates the mount point as **`root:root` `0700`**. The manager writes `environment` as **`root` `0600`**, so the `agenstra` user cannot read the file (it only sees its own process environment).
- The entrypoint (root) loads the file only when it is a regular file and not a symlink, and only accepts entries whose name matches `^[A-Za-z_][A-Za-z0-9_.-]*$` (the manager enforces the same rule). This rejects option-like entries and exported Bash functions (`BASH_FUNC_name%%`).
- Agent-controlled entries are **never exported to the root phase**. The entrypoint runs its root commands with a fixed system `PATH` (`/usr/sbin:/usr/bin:/sbin:/bin`), so binaries planted in agent-writable `PATH` directories or variables such as `BASH_ENV`, `LD_PRELOAD` or `PATH` cannot run code as root. The entries are passed to `runuser … -- /usr/bin/env -- PATH=<image PATH> NAME=value …` only after privileges are dropped. Only a fixed allow-list of entrypoint settings (`APP_UID`, `APP_GID`, `OPENCODE_SERVER_*`, `VNC_*`) is read into unexported shell variables.
- Secrets no longer appear in `docker inspect` (`Config.Env`) for such containers. Commands the manager runs via `docker exec` receive the environment through the exec API's `Env` field, not argv.
- The manager only removes volumes with the `agenstra-env-` prefix, and caps the size of the file it reads back (4 MiB).

Custom worker images must provide the same contract to opt in: the label, the root-only directory, and an entrypoint loader equivalent to the one in `apps/agenstra/backend-agent-manager/worker-desktop/docker-entrypoint.sh`. Images without the label keep the legacy behaviour (Docker `Env`, recreate on change).

## Privilege model (no sudo)

Backend images follow the same pattern as Decabill billing API:

1. **Entrypoint as root** — perform bootstrap that requires privilege.
2. **Drop privileges** — `runuser -u agenstra` (and `sg docker` when the Docker socket is mounted) before starting the application.

| Image                               | Root bootstrap                                                    | Application user                   |
| ----------------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| **worker**                          | `chown` on `/app` bind mount                                      | `agenstra` (OpenCode)              |
| **Manager API**, **controller API** | Align in-container `docker` group GID with `/var/run/docker.sock` | `agenstra` + `docker` group (Node) |

**Layer VFS absolute paths** (for example `/opt/skills/…`): the agent manager installs these with Docker **`exec` as UID 0** from the API host, keeps **root ownership**, and sets mode **`u=rwX,go=rX`** so OpenCode (`agenstra`) can **read** them but cannot rewrite injected context. Workspace-relative paths under `/app` stay as the runtime user.

**Operator check** (after rebuild):

```bash
docker exec -u agenstra <worker-or-api> which sudo   # expect: empty / not found
docker exec <worker> id -u                           # expect: 0 only for the entrypoint PID briefly; app is agenstra
# Confirm OpenCode/Node runs as agenstra (e.g. ps inside a ready container)
```

## Manager and controller API images

- Mount **`/var/run/docker.sock`** only when the service must create agent containers on the host.
- Build-time **`DOCKER_GID`** (default **995**) should match the host `docker` group when known at build time:
  `stat -c '%g' /var/run/docker.sock`
- Entrypoint (as root): if the socket is present, sync the `docker` group GID, add `agenstra` to `docker`, then start Node via **`runuser`** + **`sg docker`** so socket access is effective without leaving Node as root.
- Secrets (database, Keycloak, `STATIC_API_KEY`, etc.) are supplied at **deploy time**, not as default `ENV` in the image.
- **`VERSION`** is baked at image build time (`ARG`/`ENV`, `--build-arg VERSION=$VERSION`). Release sets it from semantic-release (`release.yml` after `needs: publish`). Runtime `VERSION` / `APP_VERSION` may override.
- Debian-based images (`Dockerfile.api`, worker) run `apt-get upgrade` after `apt-get update` so OS packages such as `perl-base` pick up Debian security fixes newer than the published base tag.
- Ownership in images prefers **`APP_UID` / `APP_GID`** for `COPY --chown` and build-time `chown`; the login name remains **`agenstra`**.

## Coordinated upgrades

Deploy **manager API and worker** images from the **same release tag** when user IDs, home paths, or mount layouts change. Mismatched tags can break shared volumes.

## Related documentation

- **[Operational hardening](./operational-hardening.md)** Summary table and cross-links
- **[Docker deployment](../deployment/docker-deployment.md#container-security-images)** Compose and `DOCKER_GID`
- **[Production checklist](../deployment/production-checklist.md)** Pre-flight checks
- **[Environment configuration](../deployment/environment-configuration.md)** Per-provider image env vars
