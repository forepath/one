# shared-backend-feature-notifications

Shared NestJS module for tenant- or instance-scoped webhook notification endpoints, async delivery via BullMQ, optional transactional email delivery, and admin webhook CRUD.

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
  email: {
    templateRoots: resolveBillingEmailTemplateRoots(),
    emailEventCatalog: BILLING_EMAIL_EVENTS,
    subjectRegistry: BILLING_EMAIL_SUBJECTS,
    companyName: resolveEmailCompanyName(),
    companyFrom: resolveEmailCompanyFrom(),
  },
});
```

Company brand fields resolve from `EMAIL_COMPANY_*` with `BILLING_ISSUER_*` fallback (see `resolveEmailCompanyFrom`).

## Exports

- `NotificationsModule` — dynamic module with webhook + optional email channel
- `NotificationDispatcherService` — matches endpoints and enqueues `webhook-deliver` jobs
- `EmailNotificationDispatcherService` — enqueues `email-deliver` jobs (when `email` options set)
- `EmailDeliveryService` — renders Handlebars templates and sends via nodemailer
- `WebhookEndpointService` / `WebhookDeliveryService` — admin CRUD and HTTP delivery

## Migrations

Shared migrations live in `src/lib/migrations/` and are compiled into both Decabill and Agenstra deploy artifacts via each app’s `compile-migrations` target (same pattern as identity `util-auth` migrations).

## Tests

`nx run shared-backend-feature-notifications:test`
