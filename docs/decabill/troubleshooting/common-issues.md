# Common Issues

Common problems and their solutions in Decabill.

## Connection Issues

### Billing Console Cannot Reach API

**Symptoms**: Network errors in browser console; failed `fetch` to billing API

**Solutions**:

- Verify billing manager is running: `nx serve decabill-backend-billing-manager` or `docker compose ps`
- Check API URL in console configuration: `http://localhost:3200`
- In Docker, set `CSP_CONNECT_SRC_EXTRA` to the API origin (compose default: `http://host.docker.internal:3200`)
- Verify `CORS_ORIGIN` on the API includes the console origin (or `*` in development)

### WebSocket Connection Fails

**Symptoms**: Dashboard status does not update; WebSocket errors in browser console

**Solutions**:

- Verify WebSocket URL: `http://localhost:8082` (namespace `billing`)
- Check `WEBSOCKET_CORS_ORIGIN` includes the console origin
- Confirm you are using interactive auth (Keycloak/users); API key clients do not receive dashboard streams
- Ensure **`X-Tenant`** is sent on the handshake when using multi-tenant setups

## Authentication Problems

### "Unauthorized" Errors (401)

**Symptoms**: API requests return 401 Unauthorized

**Solutions**:

- Verify `Authorization` header or Keycloak token is valid
- Check `STATIC_API_KEY` matches server configuration
- Review `AUTHENTICATION_METHOD` and implicit resolution (see **[DR-004](../security/accepted-risks.md#dr-004--backend-authentication-method-resolution)**)

### "Forbidden" or Tenant Errors (400/403)

**Symptoms**: Requests fail with tenant-related errors

**Solutions**:

- Send **`X-Tenant`** header matching an id in **`TENANTS`**
- When **`TENANTS_ALLOW_DEFAULT=false`**, `default` is not allowed; missing, blank, or `default` **`X-Tenant`** values return 400
- For user auth, ensure user's `tenant_id` matches **`X-Tenant`**
- With API key auth, set **`STATIC_API_KEY_TENANT_ID`** if the key is bound to one tenant (see **[DR-002](../security/accepted-risks.md#dr-002--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset)**)

### Keycloak Authentication Fails

**Symptoms**: Login redirect loops or token errors

**Solutions**:

- Verify Keycloak server URL, realm, client id, and secret
- Check Keycloak client redirect URIs include the billing console URL
- Review Keycloak server logs

## Stripe and Payment Issues

### Checkout Session Fails

**Symptoms**: Stripe checkout does not start or returns errors

**Solutions**:

- Verify `STRIPE_SECRET_KEY` is set and matches Stripe dashboard mode (test vs live)
- Check `STRIPE_CHECKOUT_SUCCESS_URL` and `STRIPE_CHECKOUT_CANCEL_URL` point to valid console URLs
- Review billing API logs for Stripe API errors

### Webhook Events Not Processed

**Symptoms**: Payments succeed in Stripe but invoice status does not update

**Solutions**:

- Confirm webhook endpoint URL is reachable from Stripe
- Verify `STRIPE_WEBHOOK_SECRET` matches the endpoint signing secret in Stripe dashboard
- Check worker container is running (`QUEUE_ROLE=worker`)
- Inspect failed jobs in Bull Board at `/admin/queues`

## Background Jobs and Redis

### Jobs Not Running

**Symptoms**: Subscriptions not billed; reminders not sent; overdue invoices not updated

**Solutions**:

- Confirm Redis is running (compose: port **6380** on host)
- Verify `REDIS_HOST`, `REDIS_PORT`, and `REDIS_KEY_PREFIX=decabill-billing`
- Ensure scheduler container is running with `QUEUE_ROLE=scheduler`
- Ensure worker container is running with `QUEUE_ROLE=worker`
- API must be healthy first (migrations applied)

### Bull Board Not Accessible

**Symptoms**: 401 on `/admin/queues` or connection refused

**Solutions**:

- Use URL `http://localhost:3200/admin/queues` (not `/api/admin/queues`)
- Set `QUEUE_BULL_BOARD_ENABLED=true` on API container
- Provide `QUEUE_BULL_BOARD_USERNAME` and `QUEUE_BULL_BOARD_PASSWORD`
- In production, password is required when board is enabled

### Redis Connection Errors in Worker Logs

**Symptoms**: Worker or scheduler cannot connect to Redis

**Solutions**:

- From host dev: `REDIS_PORT=6380` when using compose Redis mapping
- Inside compose network: `REDIS_HOST=redis`, `REDIS_PORT=6379`
- Check Redis health: `docker compose exec redis redis-cli ping`

## Database Issues

### Database Connection Fails

**Symptoms**: API fails to start; migration errors

**Solutions**:

- Verify PostgreSQL is running
- Check `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
- Ensure only API or `all` role runs migrations on startup

### Migration Errors

**Symptoms**: Schema errors after upgrade

**Solutions**:

- Start API container alone and wait for healthy status before workers
- Review migration logs from `QUEUE_ROLE=api` container
- Restore from backup if partial migration occurred in production

### Encryption Key Errors

**Symptoms**: Errors reading encrypted subscription item fields

**Solutions**:

- Set `ENCRYPTION_KEY` consistently across API, worker, and scheduler
- Do not change `ENCRYPTION_KEY` without a data migration plan for encrypted columns

## CORS and CSP Issues

### CORS Errors in Browser

**Symptoms**: CORS errors in browser console on API calls

**Solutions**:

- Set `CORS_ORIGIN` to the billing console origin (comma-separated for multiple)
- In production, unset `CORS_ORIGIN` disables CORS entirely

### CSP Blocks API Calls

**Symptoms**: CSP violations in console; blocked `connect-src`

**Solutions**:

- Add API origin to `CSP_CONNECT_SRC_EXTRA`
- In production, HTTPS API URLs must be listed explicitly (scheme keywords alone are insufficient for plain HTTP)
- Test with `CSP_ENFORCE=false` temporarily to confirm CSP is the cause

## Provisioning Issues

### Server Provisioning Fails

**Symptoms**: Subscription items stuck in provisioning or backorder states

**Solutions**:

- Verify `HETZNER_API_TOKEN` or `DIGITALOCEAN_API_TOKEN` is valid
- Check worker logs for cloud API errors
- Inspect `backorder-retry` jobs in Bull Board
- Review **[DR-001](../security/accepted-risks.md#dr-001--provisioning-ssh-cloud-init-templates)** for SSH posture on new instances

## Rate Limiting Issues

### 429 Too Many Requests

**Symptoms**: API returns 429

**Solutions**:

- Increase `RATE_LIMIT_LIMIT` or `RATE_LIMIT_TTL`
- Disable in development: `RATE_LIMIT_ENABLED=false`

## Related Documentation

- **[Debugging Guide](./debugging-guide.md)** - Debugging strategies
- **[Background jobs](../deployment/background-jobs.md)** - Queue architecture
- **[Environment configuration](../deployment/environment-configuration.md)** - Variable reference

---

_For more detailed debugging, see the [Debugging Guide](./debugging-guide.md)._
