# Production Deployment Checklist

Comprehensive checklist for deploying Decabill to production.

## Pre-Deployment Checklist

### Environment Configuration

- [ ] `NODE_ENV=production` on all applications
- [ ] `CORS_ORIGIN` configured with production billing console and API origins
- [ ] `RATE_LIMIT_ENABLED=true` (or leave unset; defaults to `true` in production)
- [ ] `RATE_LIMIT_LIMIT` appropriate for expected traffic
- [ ] `STATIC_API_KEY` or Keycloak/users credentials configured securely
- [ ] `ENCRYPTION_KEY` set to a strong random value (required for encrypted subscription data)
- [ ] Database credentials are not defaults
- [ ] `TENANTS` lists only intended tenant ids
- [ ] `TENANTS_ALLOW_DEFAULT=false` when the `default` tenant must not be reachable (multi-tenant-only deployments)
- [ ] `STATIC_API_KEY_TENANT_ID` set if API key must not span tenants (see **[DR-002](../security/accepted-risks.md#dr-002--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset)**)
- [ ] `BILLING_FRONTEND_URL` and `TENANT_FRONTEND_URLS` match live console URLs
- [ ] Stripe keys and webhook secret configured for production mode
- [ ] `STRIPE_CHECKOUT_SUCCESS_URL` and `STRIPE_CHECKOUT_CANCEL_URL` use HTTPS console URLs

### Redis and Background Jobs

- [ ] Redis reachable from API, worker, and scheduler with correct `REDIS_KEY_PREFIX`
- [ ] `QUEUE_ROLE=api` on API container only; separate worker and scheduler containers
- [ ] API container healthy before workers start (migrations applied)
- [ ] `QUEUE_BULL_BOARD_PASSWORD` set to a strong value if Bull Board is enabled
- [ ] Bull Board disabled or network-restricted in production if not needed

### Frontend (Billing Console and Docs)

- [ ] `CSP_ENFORCE=true` only after verifying console and docs work under enforced CSP
- [ ] `CSP_CONNECT_SRC_EXTRA` includes production billing API origin (HTTPS)
- [ ] `CONFIG_ALLOWED_HOSTS` set when using runtime `CONFIG`
- [ ] HTTPS termination configured at load balancer or ingress

### Security

- [ ] All default passwords changed (database, Redis if password-protected, Bull Board)
- [ ] API keys are strong and stored in a secrets manager
- [ ] HTTPS/WSS enabled for all browser and API traffic
- [ ] CORS restricted to specific origins
- [ ] Rate limiting enabled
- [ ] Database connections use SSL/TLS where supported
- [ ] Invoice PDF volume backed up and access-controlled
- [ ] DATEV export configured when used (`BILLING_DATEV_CONSULTANT_NUMBER`, `BILLING_DATEV_CLIENT_NUMBER`)
- [ ] `BILLING_DATEV_EXPORT_STORAGE_PATH` volume mounted on api, worker, and scheduler
- [ ] `BILLING_DATEV_EXPORT_ENABLED=false` verified if DATEV export is not required (UI hidden via capabilities)
- [ ] Unified DATEV export allowlist reviewed (`BILLING_DATEV_UNIFIED_EXPORT_ALLOWED_TENANTS`)
- [ ] Sample DATEV export validated with DatevFormatPruefProgramm before accountant handoff
- [ ] Provisioning SSH and cloud API tokens restricted (see **[DR-001](../security/accepted-risks.md#dr-001--provisioning-ssh-cloud-init-templates)**)

### Database

- [ ] PostgreSQL configured with production credentials
- [ ] Automated backups configured and restore tested
- [ ] Connection pooling tuned for workload
- [ ] Migrations tested on staging

### Infrastructure

- [ ] Container images from trusted registry tags (not `latest` in production unless policy allows)
- [ ] Resource limits set on API, worker, scheduler, and Redis (see **[System Requirements](./system-requirements.md)**)
- [ ] Centralized logging configured
- [ ] Health checks and uptime monitoring on `/api/health`
- [ ] Mailhog replaced with production SMTP

## Security Considerations

### Authentication

- Use Keycloak or users mode for interactive multi-tenant console access in production
- Set **`AUTHENTICATION_METHOD`** explicitly if policy requires unambiguous mode selection (see **[DR-004](../security/accepted-risks.md#dr-004--backend-authentication-method-resolution)**)
- Rotate `STATIC_API_KEY` on a defined schedule if used for automation
- Never expose API keys in frontend bundles or public `CONFIG` JSON

### Multi-Tenancy

- Review **`TENANTS`** and **`X-Tenant`** handling before go-live
- Set **`TENANTS_ALLOW_DEFAULT=false`** when the implicit `default` tenant must not be reachable
- Prefer per-tenant console URLs via `TENANT_FRONTEND_URLS` for branded tenants
- Understand shared API key scope documented in **[DR-002](../security/accepted-risks.md#dr-002--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset)**

### Network Security

- Restrict ingress to required ports (console, API, WebSocket)
- Firewall Bull Board path (`/admin/queues`) to operations networks only
- Enable WAF or rate limiting at edge where appropriate

### Data Protection

- Encrypt sensitive fields via `ENCRYPTION_KEY`
- Protect invoice PDF storage path
- Restrict database and Redis network access to application subnets
- Restrict DATEV export ZIP storage to admin download path only (no raw path exposure in API)

## Performance Optimization

### Database

- Index frequently queried billing tables (subscriptions, invoices, users by `tenant_id`)
- Monitor slow queries on scheduler-driven batch operations
- Size Postgres for peak invoice generation windows

### Application

- Run workers with `QUEUE_WORKER_CONCURRENCY` tuned to CPU and external API rate limits
- Scale worker replicas horizontally (multiple worker containers, same Redis)
- Keep scheduler as a single logical coordinator per deployment (one scheduler container)

### Redis

- Persist Redis with AOF or RDB per your recovery requirements
- Monitor memory usage for BullMQ job history (jobs are not auto-removed)

## Monitoring Setup

### Application Monitoring

- Track API latency on billing and admin endpoints
- Monitor WebSocket connection count on billing dashboard namespace
- Alert on job failure rates in Bull Board or exported queue metrics
- Track Stripe webhook processing errors

### Infrastructure Monitoring

- Container CPU and memory for API, worker, scheduler
- Postgres connections and disk usage
- Redis memory and persistence health
- Invoice PDF volume disk usage
- DATEV export volume disk usage (`BILLING_DATEV_EXPORT_STORAGE_PATH`)

### Logging

- Centralize structured logs from all queue roles
- Correlate logs with `X-Correlation-Id` / `X-Request-Id`
- Do not log Stripe secrets, API keys, or full PII

## Backup Strategies

### Database Backups

- Automated Postgres backups with point-in-time recovery if required
- Test restore before production cutover
- Include tenant-scoped data verification after restore

### Invoice PDF Backups

- Backup `BILLING_INVOICE_PDF_STORAGE_PATH` volume or object storage mirror
- Align retention with legal and tax requirements

### DATEV Export Backups

- Backup `BILLING_DATEV_EXPORT_STORAGE_PATH` volume alongside invoice PDFs
- Retain exports per statutory accounting retention periods
- Document whether per-tenant or unified exports are used in production

### Configuration Backups

- Version control deployment manifests and non-secret config
- Store secrets in vault; document rotation procedures

## Deployment Process

1. **Pre-deployment**
   - Run full test suite and security scans
   - Review **[Accepted risks](../security/accepted-risks.md)** for operator obligations
   - Validate environment on staging with production-like `TENANTS` and Stripe test mode

2. **Deployment**
   - Deploy Postgres and Redis
   - Deploy API; wait for healthy `/api/health`
   - Deploy scheduler and worker
   - Deploy frontends
   - Register Stripe webhook endpoint for production URL

3. **Post-deployment**
   - Verify health endpoints
   - Create test subscription and invoice in staging tenant
   - Confirm coordinator jobs appear in Bull Board
   - Monitor logs for migration or Redis connection errors

## Rollback Plan

- Keep previous image tags available in registry
- Document database migration rollback constraints (billing migrations may be forward-only)
- Practice rollback on staging with volume snapshots

## Related Documentation

- **[Operator Runbook](./operator-runbook.md)** - Capacity, install verification, day-2, and disclosure checklists
- **[System Requirements](./system-requirements.md)** - CPU, memory, and disk baselines
- **[Docker Deployment](./docker-deployment.md)** - Containerized deployment
- **[Environment Configuration](./environment-configuration.md)** - Environment variables
- **[Background Jobs](./background-jobs.md)** - Queue startup order
- **[Troubleshooting](../troubleshooting/README.md)** - Problem-solving guides

---

_For detailed deployment steps, see [Docker Deployment](./docker-deployment.md)._
