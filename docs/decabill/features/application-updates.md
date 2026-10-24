# Application updates (Decabill)

Standalone **check and report** feature for detecting newer releases from the
GitHub repository [`forepath/one`](https://github.com/forepath/one/releases).
It does **not** apply updates automatically (deployment variants differ).

This feature is independent of identity login payloads and customer profiles.

## Access (admin only)

| Surface  | Path / rule                                             |
| -------- | ------------------------------------------------------- |
| Admin UI | `/updates` (admin guard)                                |
| REST     | `GET/POST /admin/billing/updates*`                      |
| PAT      | Admin role + scope `updates:admin`                      |
| Sidebar  | Admin popover entry + badge when an update is available |

Non-admins receive `401`/`403` on the API and never see the nav entry or badge.

## Architecture

Shared Nest module `@forepath/shared/backend/feature-updates` (`UpdatesModule.register`)
mirrors the notifications/webhook extension pattern. Decabill registers it in
`BillingUpdatesModule` with:

- `applicationId` / `productScope`: `decabill`
- `serviceName`: `billing-manager`
- `controllerPath`: `admin/billing/updates`
- Queue: `billing`

State lives in **Valkey** (same Valkey as BullMQ, keyed under `VALKEY_KEY_PREFIX`).
There are no TypeORM tables for update state.

```mermaid
flowchart TD
  Scheduler[scheduler]
  GitHub[GitHub Releases API]
  Valkey[(Valkey<br/>release snapshot + instance rows)]
  Heartbeats[api / worker / scheduler heartbeats]

  Scheduler -->|daily update-check| GitHub
  Scheduler --> Valkey
  GitHub --> Valkey
  Heartbeats --> Valkey
```

## Instance identity

Each billing-manager process registers a heartbeat (~60s) with:

- Stable `instanceId`: `INSTANCE_ID` env, else `{serviceName}:{role}:{hostname}`
- Role: `QUEUE_ROLE` (`api` / `worker` / `scheduler` / `all`)
- Installed version: `VERSION` or `APP_VERSION` (baked into release images; runtime
  override optional)
- Dependency health: Valkey, BullMQ queue, database
- Hostname, uptime, environment

## Update check job

| Item           | Value                                             |
| -------------- | ------------------------------------------------- |
| Job name       | `update-check`                                    |
| Schedule       | Cron `UPDATE_CHECK_CRON` (default `0 0 * * *`)    |
| Timezone       | `UPDATE_CHECK_TIMEZONE` (default `Europe/Berlin`) |
| Manual trigger | `POST /admin/billing/updates/check` (admin)       |

Steps: fetch latest GitHub release → list releases newer than the installed
version → parse and merge changelogs → persist snapshot → recompute per-instance
`updateState` → emit webhook events on transitions.

## Changelog scoping

Release notes follow the conventional-changelog shape used in `CHANGELOG.md`.
The check aggregates bullets from **every published non-prerelease release newer
than the installed version** up to and including latest (not only the newest
release body). Each bullet is classified as:

1. Conventional `(scope)` if present
2. Else leading `agenstra` / `decabill` product token
3. Else `shared`

The Decabill UI shows **decabill + shared** entries only.

## Admin API

| Method | Path                            | Purpose                                    |
| ------ | ------------------------------- | ------------------------------------------ |
| `GET`  | `/admin/billing/updates`        | Full state (instances, changelog, release) |
| `GET`  | `/admin/billing/updates/status` | Compact summary (Admin badge)              |
| `POST` | `/admin/billing/updates/check`  | Enqueue immediate check                    |

## Valkey flush

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

## OpenTelemetry

When OpenTelemetry is effectively enabled on the billing-manager API, the shared
`UpdatesMetricsCollector` publishes update gauges (meter `forepath.updates`, polled
every 60 seconds). See **[OpenTelemetry](./opentelemetry.md#application-updates)**.

## Notification events (webhook only)

See [Webhooks](./webhooks.md#application-updates). No email channel.

## Frontend

Shared libraries:

- `@forepath/shared/frontend/data-access-updates`
- `@forepath/shared/frontend/feature-updates`

Wired into the billing console with `adminGuard`. Optional `Environment.appVersion`
can show the console build version on the Updates page.

## Out of scope

- One-click / automatic apply of updates to running instances
- Coupling to login or customer-profile DTOs
