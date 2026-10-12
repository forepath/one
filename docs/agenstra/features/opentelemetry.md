# OpenTelemetry

Optional Prometheus metrics and OTLP export for Agenstra backend apps. Disabled by default; enable explicitly when you have a scraper or collector in place.

## Applications

| App                      | Default port | Service name fallback       |
| ------------------------ | ------------ | --------------------------- |
| Backend Agent Controller | `3100`       | `agenstra-agent-controller` |
| Backend Agent Manager    | `3000`       | `agenstra-agent-manager`    |

Both apps use the shared `@forepath/shared/backend` OpenTelemetry module. See [Environment configuration](../deployment/environment-configuration.md#opentelemetry) for variables.

## Kill switch

OpenTelemetry is **off** unless all of the following are true:

1. `OTEL_ENABLED` is exactly `true` (any other value disables the module).
2. `OTEL_USERNAME` and `OTEL_PASSWORD` are both non-empty after trim.

When disabled, no metrics route is registered, the SDK does not start, and startup logs explain why (for example `OTEL_ENABLED is not exactly "true"` or missing credentials).

## Metrics endpoint

When enabled, Prometheus exposition is served at **`OTEL_METRICS_PATH`** (default **`/otel/metrics`**) on the HTTP root. **outside** the `/api` global prefix.

- **Authentication:** HTTP Basic with `OTEL_USERNAME` / `OTEL_PASSWORD`.
- **Content-Type:** `text/plain` (Prometheus exposition format).
- **Unauthenticated requests:** `401 Unauthorized`.

### Smoke checks

**Agent Controller (port 3100):**

```bash
curl -u user:pass http://localhost:3100/otel/metrics
curl -i http://localhost:3100/otel/metrics   # expect 401
```

**Agent Manager (port 3000):**

```bash
curl -u user:pass http://localhost:3000/otel/metrics
curl -i http://localhost:3000/otel/metrics   # expect 401
```

Replace `user:pass` with your configured credentials. If you override `OTEL_METRICS_PATH`, adjust the URL accordingly.

## Startup logs

On module init, the process logs one line:

- **Disabled:** `OpenTelemetry disabled: <reason>`
- **Enabled:** `OpenTelemetry enabled: metricsPath=/otel/metrics, serviceName=<name>, otlp=enabled|disabled`

`otlp=enabled` when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (traces and logs export using the same Basic auth as metrics).

## Metrics overview

### Shared (all enabled apps)

| Area                     | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| **Host metrics**         | Node/process metrics via `nestjs-otel` (CPU, memory, etc.)         |
| **Runtime gauge**        | `otel_enabled` (1 when the SDK started)                            |
| **Auto-instrumentation** | HTTP instrumentation; health and metrics paths excluded from noise |

### Controller-specific

When BullMQ is configured, the controller registers **`queueNames`** for the notifications queue and exposes BullMQ job-count gauges (`bullmq_queue_jobs_waiting`, `active`, `delayed`, `paused`, `completed`, `failed`) labeled by queue name.

Domain gauges (meter `forepath.agenstra`, polled every 60 seconds when OTEL is enabled):

| Gauge                    | Labels                                       | Description                                        |
| ------------------------ | -------------------------------------------- | -------------------------------------------------- |
| `agenstra.workspaces`    | -                                            | Workspace (client) count                           |
| `agenstra.tickets`       | `client_id`, `status`                        | Ticket counts per workspace and status             |
| `agenstra.chat_messages` | `client_id`, `direction`, `interaction_kind` | Cumulative chat I/O message counts from statistics |
| `agenstra.chat_words`    | `client_id`, `direction`, `interaction_kind` | Cumulative word counts                             |
| `agenstra.chat_chars`    | `client_id`, `direction`, `interaction_kind` | Cumulative character counts                        |
| `agenstra.filter_drops`  | `client_id`, `direction`, `filter_type`      | Messages dropped by chat filters                   |
| `agenstra.filter_flags`  | `client_id`, `direction`, `filter_type`      | Messages flagged/modified by filters               |

### Application updates

When the controller registers `UpdatesModule`, shared update gauges (meter
`forepath.updates`, polled every 60 seconds when OTEL is enabled) expose release
and instance freshness. Labels always include `application_id` and `service_name`.

| Gauge                                  | Labels (extra)                                                                 | Description                                          |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `updates.info`                         | `installed_version`, `latest_version`, `update_state`, `last_check_status`     | Info gauge (`1`) for the checking process            |
| `updates.update_available`             | -                                                                              | `1` when this process is behind latest, else `0`     |
| `updates.instance_count`               | -                                                                              | Heartbeating / scraped instances in Redis            |
| `updates.outdated_instance_count`      | -                                                                              | Instances with `update_state=update_available`       |
| `updates.last_check_timestamp_seconds` | -                                                                              | Unix time of last check completion (or `0` if never) |
| `updates.instance_outdated`            | `instance_id`, `role`, `instance_service`, `installed_version`, `update_state` | `1` when that instance is outdated, else `0`         |

See **[Application updates](./application-updates.md)**.

### Manager-specific

The agent manager enables shared host and runtime metrics. When OTEL is enabled it also polls domain gauges every 60 seconds (local DB equivalents of the controller chat/filter surface; tickets/workspaces live on the controller only):

| Gauge                                 | Labels                         | Description                                               |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `agenstra.manager.agents`             | `agent_type`, `container_type` | Agents by type and container kind                         |
| `agenstra.manager.agents.total`       | -                              | Total agent count                                         |
| `agenstra.manager.agents.provisioned` | -                              | Agents with a non-null `container_id`                     |
| `agenstra.manager.chat_messages`      | `actor`, `filtered`            | Persisted chat messages (`user` / `agent`)                |
| `agenstra.manager.chat_words`         | `actor`, `filtered`            | Approximate word counts from message text                 |
| `agenstra.manager.chat_chars`         | `actor`, `filtered`            | Character counts from message text                        |
| `agenstra.manager.filter_triggers`    | `actor`                        | Messages marked filtered (manager has no drop/flag split) |

## Optional OTLP export

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to send traces and logs to an OTLP HTTP receiver. The same username and password are sent as Basic auth on OTLP requests.

## Related documentation

- **[Environment configuration](../deployment/environment-configuration.md#opentelemetry)** Variable reference
- **[Background jobs](../deployment/background-jobs.md)** BullMQ queues scraped on the controller

## API reference

- [Agent Controller OpenAPI](/spec/agent-controller/openapi.yaml) `GET /otel/metrics` (root server)
- [Agent Manager OpenAPI](/spec/agent-manager/openapi.yaml) `GET /otel/metrics` (root server)
