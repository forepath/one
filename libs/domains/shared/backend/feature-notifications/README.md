# shared-backend-feature-notifications

Shared NestJS module for tenant- or instance-scoped webhook notification endpoints, async delivery via BullMQ, and admin CRUD.

## Registration

```typescript
NotificationsModule.register({
  applicationId: 'decabill',
  eventCatalog: BILLING_NOTIFICATION_EVENTS,
  scopeMode: 'tenant_id',
  controllerPath: 'admin/billing/webhooks',
  queueName: 'billing',
  resolveScopeKey: () => getTenantIdOrDefault(),
  assertAdmin: (req) => assertBillingAdmin(req),
});
```

## Exports

- `NotificationsModule` — dynamic module with entities, repositories, dispatcher, delivery service, and admin controller factory
- `NotificationDispatcherService` — matches endpoints and enqueues `webhook-deliver` jobs
- `WebhookEndpointService` / `WebhookDeliveryService` — admin CRUD and HTTP delivery

## Migrations

Webhook tables are defined in `src/lib/migrations/1774300000000_CreateWebhookNotificationTables.ts`. Both Decabill and Agenstra compile this shared migration into their deploy artifacts (same pattern as identity `util-auth` migrations).

## Tests

`nx run shared-backend-feature-notifications:test`
