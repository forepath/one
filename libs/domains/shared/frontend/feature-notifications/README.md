# shared-frontend-feature-notifications

Shared admin UI for webhook endpoint management.

## App integration

```typescript
import { createNotificationAdminRoutes, notificationAdminProviders } from '@forepath/shared/frontend/feature-notifications';

export const routes = [...createNotificationAdminRoutes([adminGuard])];

export const providers = [...notificationAdminProviders];
```

Provide `NOTIFICATION_ADMIN_ENVIRONMENT` in `app.config.ts` with the admin webhooks API base URL. Optionally provide `NOTIFICATION_ADMIN_CLIENT_PROVIDER` when client filtering is enabled (Agenstra).

## Tests

Component tests are intentionally omitted. State and HTTP tests live in `shared-frontend-data-access-notifications`.
