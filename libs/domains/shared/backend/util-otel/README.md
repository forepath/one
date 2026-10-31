# shared-backend-util-otel

Shared OpenTelemetry runtime configuration, SDK bootstrap, Prometheus metrics exposure, and BullMQ queue metrics for NestJS backend apps.

## Quick start

Import `OpenTelemetryModule` from `@forepath/shared/backend` and register it in a Nest module. Wire the app bootstrap to exclude the metrics path from the global `/api` prefix.

```typescript
import { OpenTelemetryModule, getOtelMetricsGlobalPrefixExcludes } from '@forepath/shared/backend/util-otel';
import { Module } from '@nestjs/common';

export const myOtelModule = OpenTelemetryModule.register({
  applicationId: 'my-service',
  // optional: override OTEL_SERVICE_NAME fallback
  serviceName: 'my-service',
  // optional: BullMQ job-count gauges (import collector from util-otel/bullmq)
  // queueNames: ['my-queue'],
  // extraProviders: [BullMqOtelMetricsCollector],
  // optional: domain-specific gauges/counters at startup
  registerDomainMetrics: (getMeter) => {
    getMeter('my.domain').createCounter('my.events').add(0);
  },
});

@Module({
  imports: [myOtelModule],
  exports: [myOtelModule],
})
export class MyOtelModule {}
```

In `main.ts`, pass `getOtelMetricsGlobalPrefixExcludes()` to `setGlobalPrefix` so `/otel/metrics` stays on the HTTP root:

```typescript
app.setGlobalPrefix('api', {
  exclude: getOtelMetricsGlobalPrefixExcludes(),
});
```

## Kill switch

OpenTelemetry is disabled unless **both** conditions hold:

1. `OTEL_ENABLED` is exactly `true`
2. `OTEL_USERNAME` and `OTEL_PASSWORD` are non-empty after trim

When disabled, `OpenTelemetryModule.register()` returns an empty module (no providers, no metrics route).

## Environment variables

| Variable                              | Description                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_ENABLED`                        | Must be exactly `true` to enable                                                                                                                                                  |
| `OTEL_USERNAME` / `OTEL_PASSWORD`     | HTTP Basic auth for the metrics scrape endpoint (both required when enabled)                                                                                                      |
| `OTEL_METRICS_PATH`                   | Prometheus scrape path on the HTTP root (default `/otel/metrics`)                                                                                                                 |
| `OTEL_SERVICE_NAME`                   | Service name resource attribute (falls back to `applicationId` from module options)                                                                                               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | Optional OTLP HTTP endpoint for traces and logs (uses same Basic auth)                                                                                                            |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Optional OTLP HTTP endpoint for metrics (full URL, e.g. `https://collector:4318/v1/metrics`); pushes every 60 s in addition to the Prometheus scrape route (uses same Basic auth) |

Example (disabled by default):

```env
OTEL_ENABLED=false
OTEL_USERNAME=
OTEL_PASSWORD=
# OTEL_METRICS_PATH=/otel/metrics
# OTEL_SERVICE_NAME=
# OTEL_EXPORTER_OTLP_ENDPOINT=
# OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=
```

## Metrics endpoint

When enabled, an Express route is registered at `OTEL_METRICS_PATH` with HTTP Basic auth middleware. Scrapers receive Prometheus text exposition (`text/plain`). Unauthenticated requests get `401`.

Workers and schedulers that bootstrap with `NestFactory.createApplicationContext` (no HTTP adapter) skip this route registration and keep running; scrape metrics from the HTTP API process instead.

Startup logs (via `OtelSdkBootstrap`):

- Disabled: `OpenTelemetry disabled: <reason>`
- Enabled: `OpenTelemetry enabled: metricsPath=..., serviceName=..., otlp=enabled|disabled`

## Exports

- `OpenTelemetryModule.register()` — Nest dynamic module with kill-switch via `OTEL_ENABLED`
- `resolveOtelRuntimeConfig()` / `isOtelEffectivelyEnabled()` — env-driven config
- `getOtelMetricsGlobalPrefixExcludes()` — exclude metrics path from Nest global prefix
- `startOtelSdk()` / `shutdownOtelSdk()` — NodeSDK lifecycle
- `incrementCounter()` / `recordHistogram()` / `setGauge()` — metric helpers
- `@forepath/shared/backend/util-otel/metrics` — lightweight meters for shared libs (no Nest/BullMQ)
- `@forepath/shared/backend/util-otel/bullmq` — `BullMqOtelMetricsCollector` (register via `extraProviders` + `queueNames`)

## Shared vs domain metrics

**Shared (when enabled):**

- Host/process metrics via `nestjs-otel`
- `otel_enabled` gauge when the SDK starts
- HTTP auto-instrumentation (health and metrics paths ignored)
- BullMQ job-count gauges when `queueNames` + `BullMqOtelMetricsCollector` (`util-otel/bullmq`) are registered

**Domain (via `registerDomainMetrics` or app collectors):**

- Apps pass a callback to register custom meters at startup (for example Chatwoot configuration gauge on the communication service)
- Product collectors poll gauges with `setGauge` (billing, agenstra, application updates via `UpdatesMetricsCollector` in `@forepath/shared/backend/feature-updates`)

## Tests

`nx run shared-backend-util-otel:test`

## Related documentation

- `docs/agenstra/features/opentelemetry.md`
- `docs/decabill/features/opentelemetry.md`
- `docs/forepath/features/opentelemetry.md`
