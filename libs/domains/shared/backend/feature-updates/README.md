# shared-backend-feature-updates

Shared NestJS module for application update checks (GitHub Releases → Valkey state →
admin REST + BullMQ job). Product apps register via `UpdatesModule.register(options)`.

## Usage

```ts
UpdatesModule.register({
  applicationId: 'decabill',
  productScope: 'decabill',
  serviceName: 'billing-manager',
  controllerPath: 'admin/billing/updates',
  queueName: 'billing',
  resolveScopeKey: () => getTenantIdOrDefault(),
  assertAdmin: (req) => {
    /* admin + updates:admin */
  },
  publishNotification: (type, data) => publisher.publish(type, data),
});
```

## OpenTelemetry

When OTEL is effectively enabled on the host app, `UpdatesMetricsCollector` polls
Valkey-backed update state every 60s and publishes gauges on meter `forepath.updates`
(see application-updates docs). No extra wiring is required beyond
`UpdatesModule.register(...)`.

## Docs

- [Agenstra application updates](../../../../../../docs/agenstra/features/application-updates.md)
- [Decabill application updates](../../../../../../docs/decabill/features/application-updates.md)
- [Agenstra OpenTelemetry](../../../../../../docs/agenstra/features/opentelemetry.md)
- [Decabill OpenTelemetry](../../../../../../docs/decabill/features/opentelemetry.md)
