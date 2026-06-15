# Identity Backend Util Auth

Backend authentication utilities for Keycloak integration in NestJS applications.

## Overview

This library provides Keycloak authentication configuration and guards for NestJS backend applications. It supports both API key authentication and Keycloak-based authentication with automatic fallback.

## Features

- **Keycloak Integration** - Configure Keycloak authentication for NestJS applications
- **Hybrid Authentication** - Support for both API key and Keycloak authentication
- **Token Validation** - Configurable token validation (ONLINE/OFFLINE)
- **Guards** - Authentication and authorization guards for route protection

## Keycloak Configuration

The `KeycloakService` implements `KeycloakConnectOptionsFactory` to provide Keycloak configuration from environment variables.

### Environment Variables

- `KEYCLOAK_SERVER_URL` - Keycloak server URL (optional, used for server URL if different from auth server URL)
- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak authentication server URL (required)
- `KEYCLOAK_REALM` - Keycloak realm name (required)
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID (required)
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret (required)
- `KEYCLOAK_TOKEN_VALIDATION` - Token validation method: `ONLINE` or `OFFLINE` (optional, default: `ONLINE`)

### Usage

Import `KeycloakModule` in your application module:

```typescript
import { KeycloakModule } from '@forepath/identity/backend';

@Module({
  imports: [
    KeycloakModule,
    KeycloakConnectModule.registerAsync({
      useExisting: KeycloakService,
    }),
  ],
})
export class AppModule {}
```

## Guards

### HybridAuthGuard

A guard that supports both API key and Keycloak authentication:

- If `STATIC_API_KEY` is set, only API key authentication is used
- If `STATIC_API_KEY` is not set, Keycloak guards handle authentication

### Keycloak Guards

Standard Keycloak guards from `nest-keycloak-connect`:

- `AuthGuard` - Validates authentication
- `ResourceGuard` - Validates resource access
- `RoleGuard` - Validates role-based access

## Token Validation

Token validation can be configured via `KEYCLOAK_TOKEN_VALIDATION`:

- `ONLINE` (default) - Validates tokens online against Keycloak server
- `OFFLINE` - Validates tokens offline using public keys (faster, but requires key refresh)

## Development Notes

When using `localhost` or `host.docker.internal` in `KEYCLOAK_AUTH_SERVER_URL`, ensure that:

- The URL matches the issuer in tokens issued by Keycloak
- If tokens are issued with `localhost` (from frontend), backend should also use `localhost` for issuer validation
- Docker containers accessing Keycloak via `host.docker.internal` may need issuer normalization

## Related Documentation

- **[Environment Configuration](../../../../../docs/agenstra/deployment/environment-configuration.md)** - Complete environment variable reference
- **[Backend Agent Controller README](../../../../../apps/agenstra/backend-agent-controller/README.md)** - Application-specific usage
- **[Backend Agent Manager README](../../../../../apps/agenstra/backend-agent-manager/README.md)** - Application-specific usage
