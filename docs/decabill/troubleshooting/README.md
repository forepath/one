# Troubleshooting Documentation

This section provides guides for troubleshooting common issues and debugging problems in Decabill.

## Overview

Troubleshooting guides help you:

- Identify and resolve common billing and deployment problems
- Debug API, WebSocket, queue, and payment issues effectively
- Understand error messages and log patterns
- Find solutions quickly

## Troubleshooting Guides

### [Common Issues](./common-issues.md)

Common problems and their solutions:

- Connection and CORS issues
- Authentication and multi-tenancy problems
- Stripe payment and webhook errors
- Background job and Redis failures
- Database and migration issues

### [Debugging Guide](./debugging-guide.md)

Debugging strategies and tools:

- Logging and log analysis
- Bull Board and queue inspection
- API and WebSocket testing
- Performance debugging

## Quick Troubleshooting

### Connection Issues

- Check billing API is running on port **3200**
- Verify billing console `API_URL` and `CSP_CONNECT_SRC_EXTRA`
- Confirm `CORS_ORIGIN` includes the console origin

### Authentication Problems

- Verify API key or Keycloak token
- Check **`X-Tenant`** header matches an allowed tenant
- Review **`STATIC_API_KEY_TENANT_ID`** if API key auth fails for some tenants

### Background Jobs

- Confirm Redis on port **6380** (compose default) is reachable
- Ensure API container is healthy before worker starts
- Open Bull Board at `http://localhost:3200/admin/queues`

## Getting Help

If you encounter issues:

1. Check **[Common Issues](./common-issues.md)**
2. Review **[Debugging Guide](./debugging-guide.md)**
3. Check application and worker logs
4. Consult **[Deployment](../deployment/README.md)** and **[Environment configuration](../deployment/environment-configuration.md)**

## Related Documentation

- **[Security accepted risks](../security/accepted-risks.md)** - Known documented behaviors (DR-001 through DR-005)
- **[Background jobs](../deployment/background-jobs.md)** - Queue roles and Bull Board

---

_For specific issues, see [Common Issues](./common-issues.md)._
