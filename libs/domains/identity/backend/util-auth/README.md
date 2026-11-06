# Identity Backend Util Auth

Backend authentication utilities for NestJS applications: authentication method resolution, static API key guard, provider-agnostic OIDC access token validation, and shared auth entities.

## Overview

`AUTHENTICATION_METHOD` selects one of `api-key`, `users`, `oidc` or `saml` (see `getAuthenticationMethod`). When unset, `api-key` is used if `STATIC_API_KEY` is set, otherwise `oidc`. Any other value (including the removed `keycloak`) throws at boot.

This library contains the parts that do not need the users table:

- **`HybridAuthGuard` / `getHybridAuthGuards()`** - static API key guard; adds `OidcAuthGuard` in `oidc` mode (used directly by the agent-manager)
- **`OidcModule`** - global module providing `OidcTokenVerifier` and `OidcAuthGuard`
- **`OidcTokenVerifier`** - verifies OIDC access tokens for any compliant provider
- **`OidcAuthGuard`** - `Authorization: Bearer <access token>` guard; sets `request.user` / `request.oidcClaims`
- Entities, migrations and helpers shared by the identity feature library (users, PATs, identity apps, external sign-in state)

SAML sign-in, OIDC user mapping (`ExternalIdentityAuthGuard`), PATs and the users API live in the identity **feature-auth** library (`OidcAuthModule`, `SamlAuthModule`, `UsersAuthModule`, `getIdentityAuthGuards()`).

## OIDC token validation

Each token is verified locally:

- Signature against the provider JWKS (discovered from `<OIDC_ISSUER>/.well-known/openid-configuration`; unknown `kid`s trigger a rate-limited refetch). Only asymmetric algorithms (RS/PS/ES); `HS*` and `none` are rejected, so app-signed JWTs can never pass as OIDC tokens.
- Exact `iss`, `exp` / `nbf`, required `sub`; tokens with a `typ` claim other than `Bearer` (ID / refresh tokens) are rejected.
- Optional `aud` (`OIDC_AUDIENCE`) and `azp` (`OIDC_AUTHORIZED_PARTIES`) allowlists.
- With `OIDC_TOKEN_VALIDATION=ONLINE` (default) the token must also be `active` at the RFC 7662 introspection endpoint (revoked sessions stop working immediately).

OIDC token scopes are not enforced; route capabilities come from local roles and PAT scopes.

### Environment Variables

- `OIDC_ISSUER` - Issuer (required)
- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` - API client used for introspection (required for `ONLINE`)
- `OIDC_TOKEN_VALIDATION` - `ONLINE` (default) or `OFFLINE`
- `OIDC_AUDIENCE` - Optional comma-separated audiences
- `OIDC_AUTHORIZED_PARTIES` - Optional comma-separated `azp` allowlist
- `OIDC_DISCOVERY_URL` - Optional discovery URL override (issuer must still match)
- `OIDC_ALLOWED_ALGORITHMS` - Optional subset of the asymmetric algorithms
- `OIDC_EMAIL_CLAIM` - Claim used as account email (default `email`)
- `OIDC_CLOCK_TOLERANCE_SECONDS` - Allowed clock skew (default `0`, max 300)
- `OIDC_ALLOW_INSECURE_HTTP` - Allow http provider URLs in production (default `false`)
- `OIDC_ALLOW_UNRESTRICTED_AUDIENCE` - Allow production without `OIDC_AUDIENCE` / `OIDC_AUTHORIZED_PARTIES` (default `false`)

Configuration is read lazily and validated on first use; missing / unsafe settings throw.

### Usage

Service without a users table (token validation only):

```typescript
import { getHybridAuthGuards, OidcModule } from '@forepath/identity/backend';

@Module({
  imports: [OidcModule],
  providers: [...getHybridAuthGuards()],
})
export class AppModule {}
```

Apps with a users table use `OidcAuthModule` + `PatAuthModule.register(...)` and `getIdentityAuthGuards()` from the feature library.

## Guards

### HybridAuthGuard

- `api-key` mode: validates `Authorization: Bearer <key>` / `ApiKey <key>` against `STATIC_API_KEY` (no fallback, no anonymous access)
- other modes: passes through to the method's guards
- health, Bull Board and OTEL metrics paths and `@Public()` routes are skipped

### OidcAuthGuard

Runs only in `oidc` mode. Skips public / ops routes and requests already authenticated by an app-signed PAT (`patAuthenticated`) or API key.

## Development Notes

Use the [platform authentication](../../../../../apps/shared/platform-authentication/README.md) stack for a local OIDC / SAML identity provider. The token `iss` must equal `OIDC_ISSUER` exactly; when containers reach the IdP under another hostname (for example `host.docker.internal`), keep `OIDC_ISSUER` at the public issuer and set `OIDC_DISCOVERY_URL` to the reachable URL only if the discovery document still reports the same issuer.

## Related documentation

- **[Environment Configuration](../../../../../docs/agenstra/deployment/environment-configuration.md)** - Complete environment variable reference
- **[Backend Agent Controller README](../../../../../apps/agenstra/backend-agent-controller/README.md)** - Application-specific usage
- **[Backend Agent Manager README](../../../../../apps/agenstra/backend-agent-manager/README.md)** - Application-specific usage
