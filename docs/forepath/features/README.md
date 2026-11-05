# Features Documentation

Documentation for Forepath domain backend features.

## Features

### [OpenTelemetry](./opentelemetry.md)

Optional Prometheus metrics scrape and OTLP export for the communication service. Disabled by default; requires `OTEL_ENABLED=true` and Basic auth credentials.

**Key capabilities:**

- Kill switch via `OTEL_ENABLED`
- Prometheus exposition at `/otel/metrics` (outside `/api`)
- HTTP Basic auth for scrapers
- Chatwoot configuration health gauge

### [Webhook event naming](./webhook-events.md)

Naming convention for outbound webhook event types shared by Agenstra and Decabill, shared event groups, cross-application events and the rename history.

**Key capabilities:**

- `<resource>[.<child>].<action>` convention (Stripe / Standard Webhooks style), enforced at bootstrap
- Shared identity, application-update and search event groups
- Same event names for the same concept across applications (cross-application syncs)

### [Blog](./blog.md)

Marketing blog pages on the ForePath landing site, fed by the Ghost Content API at `blog.forepath.io`.

**Key capabilities:**

- `/blog` browse and title search
- `/blog/:slug` post pages with SEO meta from Ghost
- Content API key configured via `environment.blog`

## Related documentation

- **Library:** `libs/domains/shared/backend/util-otel/README.md`
- **App:** `apps/forepath/backend-communication/`
