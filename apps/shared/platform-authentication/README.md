# Platform Authentication (local identity provider)

Local, throw-away identity provider for developing and testing the `oidc` and `saml` authentication methods of the
backends and consoles. It runs [Keycloak](https://www.keycloak.org/) purely as a **standards-based OIDC and SAML 2.0
provider** — the applications contain no Keycloak specific code, any compliant provider (Entra ID, Okta, Auth0,
authentik, ADFS, …) can be used instead.

> Development only: fixed secrets, test users with trivial passwords, plain HTTP.

## Quick start

```bash
npx nx run shared-platform-authentication:up   # or: docker compose up -d
```

- Admin console: `http://localhost:8380/admin` (`admin` / `admin`)
- Realm `platform` is imported from [`realm/platform-realm.json`](./realm/platform-realm.json) on first start
  (delete the `postgres_data` volume to re-import after changing it).

The issuer must be identical for browsers and backends. By default Keycloak advertises
`http://host.docker.internal:8380`; when everything runs on the host instead, start it with
`KC_HOSTNAME=http://localhost:8380 docker compose up -d`.

## What the realm contains

| Client / user               | Type                                                                        | Used for                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `console`                   | OIDC public client, code flow + PKCE                                        | Frontend `authentication.config` `{ type: 'oidc', issuer, clientId: 'console' }`; adds `aud: platform-api` |
| `platform-api`              | OIDC confidential client                                                    | Backend `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` (token introspection) and `OIDC_AUDIENCE=platform-api`     |
| `agent-manager-client`      | OIDC confidential, service account                                          | Controller → agent-manager client credentials (`authenticationType: oidc`)                                 |
| `http://localhost:3100`     | SAML SP (signed response + assertion, persistent NameID, `email` attribute) | Agenstra controller `AUTHENTICATION_METHOD=saml`                                                           |
| `http://localhost:3200`     | SAML SP (same settings)                                                     | Decabill billing manager `AUTHENTICATION_METHOD=saml`                                                      |
| `admin` / `admin`           | user, verified email                                                        | `admin@example.com`                                                                                        |
| `user` / `user`             | user, verified email                                                        | `user@example.com`                                                                                         |
| `unverified` / `unverified` | user, **unverified** email                                                  | Verifies that unverified emails are never linked to existing local accounts                                |

## Backend settings

OIDC (`AUTHENTICATION_METHOD=oidc`):

```dotenv
OIDC_ISSUER=http://host.docker.internal:8380/realms/platform
OIDC_CLIENT_ID=platform-api
OIDC_CLIENT_SECRET=platform-api-secret
OIDC_AUDIENCE=platform-api
```

Agent-manager accepting only the controller's service account (`AUTHENTICATION_METHOD=oidc`; the manager
does not need the client secret):

```dotenv
OIDC_ISSUER=http://host.docker.internal:8380/realms/platform
OIDC_TOKEN_VALIDATION=OFFLINE
OIDC_AUTHORIZED_PARTIES=agent-manager-client
```

SAML (`AUTHENTICATION_METHOD=saml`, controller on port 3100):

```dotenv
SAML_IDP_SSO_URL=http://host.docker.internal:8380/realms/platform/protocol/saml
SAML_IDP_ISSUER=http://host.docker.internal:8380/realms/platform
# Realm signing certificate: Realm settings → Keys → RS256 → Certificate (or the <ds:X509Certificate> in the
# descriptor at /realms/platform/protocol/saml/descriptor)
SAML_IDP_CERT=<base64 certificate>
SAML_SP_ENTITY_ID=http://localhost:3100
SAML_SP_ACS_URL=http://localhost:3100/api/auth/saml/acs
SAML_FRONTEND_CALLBACK_URL=http://localhost:4100/login/saml/callback
# Keycloak controls user emails in this realm
SAML_TRUST_EMAIL=true
```

The certificate can be fetched with:

```bash
curl -s http://localhost:8380/realms/platform/protocol/saml/descriptor \
  | sed -n 's:.*<ds\:X509Certificate>\(.*\)</ds\:X509Certificate>.*:\1:p' | head -1
```

See the product authentication docs for all settings:
[Agenstra](../../../docs/agenstra/features/authentication.md) ·
[Decabill](../../../docs/decabill/features/authentication.md).
