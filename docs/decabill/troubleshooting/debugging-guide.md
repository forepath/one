# Debugging Guide

Debugging strategies and tools for troubleshooting Decabill issues.

## Logging

### Application Logs

```bash
# Billing manager API (local)
nx serve decabill-backend-billing-manager

# Docker Compose
cd apps/decabill/backend-billing-manager
docker compose logs -f backend-billing-manager
docker compose logs -f backend-billing-manager-worker
docker compose logs -f backend-billing-manager-scheduler
```

### Log Levels

Configure log levels via environment variables where supported:

- `LOG_LEVEL=debug` - Detailed debugging information
- `LOG_LEVEL=info` - General information
- `LOG_LEVEL=warn` - Warnings
- `LOG_LEVEL=error` - Errors only

### Correlation IDs

Pass `X-Correlation-Id` or `X-Request-Id` on API requests to trace a single operation across API and worker logs. Access logs include `[corr=…]` in Nest output when inside the request context.

### Log Patterns

Common patterns to search for:

- **Connection errors**: Database, Redis, SMTP, Stripe, cloud APIs
- **Authentication errors**: Invalid API key, expired JWT, tenant mismatch
- **Queue errors**: BullMQ connection failures, job processor exceptions
- **Payment errors**: Stripe signature failures, checkout session errors

Secrets are redacted in access logs; do not rely on logs for full token values.

## Bull Board and Queue Debugging

When `QUEUE_BULL_BOARD_ENABLED=true` on the API:

- URL: `http://localhost:3200/admin/queues`
- Credentials: `QUEUE_BULL_BOARD_USERNAME` / `QUEUE_BULL_BOARD_PASSWORD`

Use Bull Board to:

- Inspect failed jobs and stack traces
- Retry stalled subscription billing or provisioning jobs
- Verify coordinator repeatable jobs are registered

Job names are defined in `apps/decabill/backend-billing-manager/src/queue/job-registry.ts`.

## Debugging Tools

### Browser DevTools

- **Network tab**: Monitor API calls, WebSocket upgrade, Stripe redirects
- **Console tab**: CSP violations, Angular errors
- **Application tab**: Storage and cookies for Keycloak sessions

### Docker Debugging

```bash
docker exec -it billing-manager-api /bin/sh
docker exec -it billing-manager-worker /bin/sh
docker stats billing-manager-api
```

### Redis Debugging

```bash
# From host (compose default port)
redis-cli -p 6380 ping

# Inside compose network
docker compose exec redis redis-cli ping
docker compose exec redis redis-cli keys 'decabill-billing*'
```

### Database Debugging

```bash
psql -h localhost -U postgres -d postgres

# Example tenant-scoped queries
SELECT id, tenant_id, status FROM subscriptions LIMIT 10;
SELECT id, tenant_id, status FROM invoices ORDER BY created_at DESC LIMIT 10;
```

## API Testing

### Health Check

```bash
curl http://localhost:3200/api/health
```

### Authenticated Request

```bash
curl -H "Authorization: ApiKey your-api-key" \
  -H "X-Tenant: default" \
  http://localhost:3200/api/billing/subscriptions
```

Adjust path to match your OpenAPI specification.

### Stripe Webhook (local testing)

Use Stripe CLI to forward webhooks to your local API:

```bash
stripe listen --forward-to localhost:3200/api/billing/stripe/webhook
```

Set `STRIPE_WEBHOOK_SECRET` to the signing secret from `stripe listen`.

## WebSocket Testing

Billing WebSocket gateway listens on port **8082** with namespace **`billing`**.

Use browser DevTools Network tab or a Socket.IO client with:

- Correct origin (CORS)
- Auth token or session as required by your auth mode
- **`X-Tenant`** header on handshake for multi-tenant setups

## Common Debugging Scenarios

### Subscription Not Billed

1. Check `subscription-billing.coordinator` is repeating in Bull Board
2. Verify worker is processing `subscription-billing.unit` jobs
3. Review subscription status and billing dates in database
4. Check `BILLING_SCHEDULER_INTERVAL` and batch size env vars

### Invoice PDF Missing

1. Verify worker and API share `invoice_pdf_data` volume in compose
2. Check `BILLING_INVOICE_PDF_STORAGE_PATH` (default `/data/invoices`)
3. Review worker logs during PDF generation jobs

### Multi-Tenant Data in Wrong Tenant

1. Confirm console sends correct **`X-Tenant`**
2. For API key auth, review **[DR-002](../security/accepted-risks.md#dr-002--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset)**
3. Verify user's `tenant_id` in database matches expected tenant

## Performance Debugging

### API Performance

- Monitor response times on heavy admin list endpoints
- Check database query plans for large tenant datasets
- Review rate limiting metrics if 429 responses appear

### Worker Performance

- Tune `QUEUE_WORKER_CONCURRENCY` for CPU and external API limits
- Scale horizontally with additional worker containers
- Watch Redis memory as job history accumulates (jobs are not auto-removed)

### Database Performance

- Index usage on `tenant_id` filtered queries
- Connection pool sizing under scheduler batch loads

## Related Documentation

- **[Common Issues](./common-issues.md)** - Common problems and solutions
- **[Background jobs](../deployment/background-jobs.md)** - Queue roles and job registry
- **[Environment configuration](../deployment/environment-configuration.md)** - Scheduler intervals

---

_For specific issues, see [Common Issues](./common-issues.md)._
