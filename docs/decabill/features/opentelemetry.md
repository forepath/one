# OpenTelemetry

Optional Prometheus metrics and OTLP export for the Decabill billing manager. Disabled by default; enable explicitly when you have a scraper or collector in place.

## Application

| App                     | Default port | Service name fallback      |
| ----------------------- | ------------ | -------------------------- |
| Backend Billing Manager | `3200`       | `decabill-billing-manager` |

See [Environment configuration](../deployment/environment-configuration.md#opentelemetry) for variables.

## Kill switch

OpenTelemetry is **off** unless all of the following are true:

1. `OTEL_ENABLED` is exactly `true` (any other value disables the module).
2. `OTEL_USERNAME` and `OTEL_PASSWORD` are both non-empty after trim.

When disabled, no metrics route is registered, the SDK does not start, and startup logs explain why.

## Metrics endpoint

When enabled, Prometheus exposition is served at **`OTEL_METRICS_PATH`** (default **`/otel/metrics`**) on the HTTP root. **outside** the `/api` global prefix.

- **Authentication:** HTTP Basic with `OTEL_USERNAME` / `OTEL_PASSWORD`.
- **Content-Type:** `text/plain` (Prometheus exposition format).
- **Unauthenticated requests:** `401 Unauthorized`.

### Smoke checks

```bash
curl -u user:pass http://localhost:3200/otel/metrics
curl -i http://localhost:3200/otel/metrics   # expect 401
```

Replace `user:pass` with your configured credentials. If you override `OTEL_METRICS_PATH`, adjust the URL accordingly.

## Startup logs

On module init, the process logs one line:

- **Disabled:** `OpenTelemetry disabled: <reason>`
- **Enabled:** `OpenTelemetry enabled: metricsPath=/otel/metrics, serviceName=<name>, otlp=enabled|disabled`

## Metrics overview

### Shared

| Area                     | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| **Host metrics**         | Node/process metrics via `nestjs-otel`                  |
| **Runtime gauge**        | `otel_enabled` (1 when the SDK started)                 |
| **Auto-instrumentation** | HTTP instrumentation; health and metrics paths excluded |

### Billing-specific

The billing manager registers the main BullMQ billing queue and exposes job-count gauges (`bullmq_queue_jobs_*`) per queue state, polled every 15 seconds.

Domain gauges (meter `forepath.decabill`, labels include `tenant_id`, polled every 60 seconds when OTEL is enabled):

| Gauge                                    | Labels   | Description                                        |
| ---------------------------------------- | -------- | -------------------------------------------------- |
| `decabill.invoices.open`                 | `status` | Open/overdue invoice counts by status              |
| `decabill.invoices.overdue`              | -        | Overdue invoice count                              |
| `decabill.invoices.open_total`           | -        | Sum of `balance_due` on open/overdue invoices      |
| `decabill.open_positions.unbilled_total` | -        | Open-position totals not yet on invoices           |
| `decabill.open_positions.unbilled_users` | -        | Users with unbilled open positions                 |
| `decabill.subscriptions.active`          | -        | Active subscription count                          |
| `decabill.projects`                      | `status` | Billing projects by status (`active` / `archived`) |
| `decabill.project_tickets`               | `status` | Project tickets (tasks) by status                  |
| `decabill.project_time.unbilled_minutes` | -        | Unbilled project time across projects              |

### Application updates

When billing registers `UpdatesModule`, shared update gauges (meter
`forepath.updates`, polled every 60 seconds when OTEL is enabled) expose release
and instance freshness. Labels always include `application_id` and `service_name`.

| Gauge                                  | Labels (extra)                                                                 | Description                                          |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `updates.info`                         | `installed_version`, `latest_version`, `update_state`, `last_check_status`     | Info gauge (`1`) for the checking process            |
| `updates.update_available`             | -                                                                              | `1` when this process is behind latest, else `0`     |
| `updates.instance_count`               | -                                                                              | Heartbeating instances in Valkey                     |
| `updates.outdated_instance_count`      | -                                                                              | Instances with `update_state=update_available`       |
| `updates.last_check_timestamp_seconds` | -                                                                              | Unix time of last check completion (or `0` if never) |
| `updates.instance_outdated`            | `instance_id`, `role`, `instance_service`, `installed_version`, `update_state` | `1` when that instance is outdated, else `0`         |

See **[Application updates](./application-updates.md)**.

## Optional OTLP export

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to send traces and logs to an OTLP HTTP receiver (Basic auth uses the same credentials as the metrics endpoint).

## Related documentation

- **[Environment configuration](../deployment/environment-configuration.md#opentelemetry)** Variable reference
- **[Background jobs](../deployment/background-jobs.md)** BullMQ roles and queues

## API reference

- [Billing Manager OpenAPI](/spec/billing-manager/openapi.yaml) `GET /otel/metrics` (root server)
