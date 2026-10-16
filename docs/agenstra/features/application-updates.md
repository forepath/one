# Application updates (Agenstra)

Standalone **check and report** feature for detecting newer releases from the
GitHub repository [`forepath/one`](https://github.com/forepath/one/releases).
It does **not** apply updates automatically (deployment variants differ).

This feature is independent of identity login payloads and Decabill customer
profiles.

## Access (admin only)

| Surface  | Path / rule                                             |
| -------- | ------------------------------------------------------- |
| Admin UI | `/updates` (admin guard)                                |
| REST     | `GET/POST /admin/updates*`                              |
| PAT      | Admin role + scope `updates:admin`                      |
| Sidebar  | Admin popover entry + badge when an update is available |

Non-admins receive `401`/`403` on the API and never see the nav entry or badge.

## Architecture

Shared Nest module `@forepath/shared/backend/feature-updates` (`UpdatesModule.register`)
mirrors the notifications/webhook extension pattern. Agenstra registers it in
`AgenstraUpdatesModule` with:

- `applicationId` / `productScope`: `agenstra`
- `serviceName`: `agent-controller`
- `controllerPath`: `admin/updates`
- Queue: `agent-controller`

State lives in **Redis** (same Redis as BullMQ, keyed under `REDIS_KEY_PREFIX`).
There are no TypeORM tables for update state.

```mermaid
flowchart TD
  Scheduler[scheduler]
  GitHub[GitHub Releases API]
  Redis[(Redis<br/>release snapshot + instance rows)]
  Heartbeats[api / worker / scheduler heartbeats]
  Controller[agent-controller]
  Manager[agent-manager]

  Scheduler -->|daily update-check| GitHub
  Scheduler --> Redis
  GitHub --> Redis
  Heartbeats --> Redis
  Controller -->|scrape GET /api/instance-status| Manager
```

## Instance identity

Each process registers a heartbeat (~60s) with:

- Stable `instanceId`: `INSTANCE_ID` env, else `{serviceName}:{role}:{hostname}`
- Role: `QUEUE_ROLE` (`api` / `worker` / `scheduler` / `all`) on the controller
- Installed version: `VERSION` or `APP_VERSION` (baked into release images; runtime
  override optional)
- Dependency health: Redis, BullMQ queue, database
- Hostname, uptime, environment

Agent-manager processes (no Redis) expose `GET /api/instance-status`. The
controller **API** (or `QUEUE_ROLE=all`) scrapes API-key workspace endpoints about
every 60 seconds and on each `update-check`, then upserts rows into controller Redis
(same 5-minute TTL as heartbeats). Without the periodic scrape, managers disappear
from `/updates` a few minutes after the last check. Keycloak workspaces are skipped.
Manager roles use `AGENT_MANAGER_ROLE` when set.

## Update check job

| Item           | Value                                             |
| -------------- | ------------------------------------------------- |
| Job name       | `update-check`                                    |
| Schedule       | Cron `UPDATE_CHECK_CRON` (default `0 0 * * *`)    |
| Timezone       | `UPDATE_CHECK_TIMEZONE` (default `Europe/Berlin`) |
| Manual trigger | `POST /admin/updates/check` (admin)               |

Steps: optional manager scrape → fetch latest GitHub release → list releases
newer than the installed version → parse and merge changelogs → persist snapshot →
recompute per-instance `updateState` → emit webhook events on transitions.

## Changelog scoping

Release notes follow the conventional-changelog shape used in `CHANGELOG.md`.
The check aggregates bullets from **every published non-prerelease release newer
than the installed version** up to and including latest (not only the newest
release body). Each bullet is classified as:

1. Conventional `(scope)` if present
2. Else leading `agenstra` / `decabill` product token
3. Else `shared`

The Agenstra UI shows **agenstra + shared** entries only.

## Admin API

| Method | Path                    | Purpose                                    |
| ------ | ----------------------- | ------------------------------------------ |
| `GET`  | `/admin/updates`        | Full state (instances, changelog, release) |
| `GET`  | `/admin/updates/status` | Compact summary (Admin badge)              |
| `POST` | `/admin/updates/check`  | Enqueue immediate check                    |

## Redis flush

- Instance rows reappear as heartbeats resume (deterministic IDs stay stable).
- Release/check snapshot returns after the next successful check.
- The next check may re-emit webhook transition events (expected after flush).

## Configuration

| Variable                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERSION` / `APP_VERSION`   | Installed version reported by the process. Release builds bake `VERSION` into every container image via Docker `ARG`/`ENV` (`release.yml` sets `VERSION` from `needs.publish.outputs.new_release_version`; image targets pass `--build-arg VERSION` from the host/CI env, otherwise the Dockerfile default `0.0.0`). Runtime env overrides the baked value when set. Unresolved placeholders such as `$VERSION` are ignored. |
| `INSTANCE_ID`               | Optional stable instance id override                                                                                                                                                                                                                                                                                                                                                                                         |
| `UPDATE_CHECK_GITHUB_TOKEN` | Optional GitHub token for Releases API                                                                                                                                                                                                                                                                                                                                                                                       |
| `UPDATE_CHECK_CRON`         | Daily check cron (default `0 0 * * *`)                                                                                                                                                                                                                                                                                                                                                                                       |
| `UPDATE_CHECK_TIMEZONE`     | Cron timezone (default `Europe/Berlin`)                                                                                                                                                                                                                                                                                                                                                                                      |
| `AGENT_MANAGER_ROLE`        | Manager container role label (`api`, `worker`, …)                                                                                                                                                                                                                                                                                                                                                                            |

## OpenTelemetry

When OpenTelemetry is effectively enabled on the agent-controller API, the shared
`UpdatesMetricsCollector` publishes update gauges (meter `forepath.updates`, polled
every 60 seconds). See **[OpenTelemetry](./opentelemetry.md#application-updates)**.

## Notification events (webhook only)

See [Webhooks](./webhooks.md#application-updates). No email channel.

## Frontend

Shared libraries:

- `@forepath/shared/frontend/data-access-updates`
- `@forepath/shared/frontend/feature-updates`

Wired into the agent console with `adminGuard`. Optional `Environment.appVersion`
can show the console build version on the Updates page.

## Out of scope

- One-click / automatic apply of updates to running instances
- Coupling to login or customer-profile DTOs
