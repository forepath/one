# Authentication

Authentication system supporting multiple authentication methods with configurable user registration.

## Overview

Agenstra supports three authentication methods:

- **API Key Authentication** Static API key for simple authentication
- **Keycloak Authentication** OAuth2/OIDC via Keycloak
- **Users Authentication** Built-in user registration with JWT

Each method has different use cases and can be configured via environment variables.

## Authentication Methods

### API Key Authentication

Simple authentication using a static API key. Suitable for development and single-user deployments.

**Configuration**:

```bash
AUTHENTICATION_METHOD=api-key
STATIC_API_KEY=your-secure-api-key-here
```

**Features**:

- All requests require `Authorization: Bearer <key>` or `Authorization: ApiKey <key>` header
- API key authentication always grants admin rights
- No user management required
- Simple setup for development environments

### Keycloak Authentication

Enterprise-grade authentication using Keycloak OAuth2/OIDC. Suitable for organizations with existing identity management.

**Configuration**:

```bash
AUTHENTICATION_METHOD=keycloak
KEYCLOAK_AUTH_SERVER_URL=http://localhost:8380
KEYCLOAK_REALM=agenstra
KEYCLOAK_CLIENT_ID=agent-controller
KEYCLOAK_CLIENT_SECRET=your-client-secret
```

**Features**:

- OAuth2/OIDC authentication flow
- Users are synced to the users table
- First synced user gets admin role, subsequent users get user role
- Integration with existing identity providers
- Support for SSO and multi-factor authentication (via Keycloak)

### Users Authentication

Built-in user registration and authentication with JWT tokens. Suitable for standalone deployments without external identity providers.

**Configuration**:

```bash
AUTHENTICATION_METHOD=users
JWT_SECRET=your-jwt-secret-key
DISABLE_SIGNUP=false  # Set to true to disable self-registration
DISABLE_FORCE_LOGIN_2FA=false  # Default: force email OTP (or TOTP if enrolled) on every login
PRODUCT_NAME=Agenstra  # Issuer label on TOTP QR / authenticator entries (default: Forepath)
```

**Features**:

- User registration with email/password
- Email confirmation with 6-character alphanumeric codes (consumed atomically; single-use under concurrency)
- Password reset functionality (reset codes consumed atomically; single-use under concurrency)
- JWT-based authentication
- **Login 2FA** (forced by default): email OTP on every login unless an authenticator is enrolled; set `DISABLE_FORCE_LOGIN_2FA=true` to make 2FA opt-in only. Email OTP codes are consumed atomically (single-use under concurrency).
- Self-service authenticator (TOTP) and optional email 2FA under Security settings
- Self-service password change under Security settings (current password, new password, confirmation; own account only)
- TOTP QR / authenticator account name uses `PRODUCT_NAME` (falls back to `Forepath`) plus the user email
- Admin can remove a user's authenticator (falls back to email OTP when force is on)
- First registered user gets admin role
- Admin user management (CRUD operations)
- Optional signup disable for controlled onboarding
- **Personal access tokens (PATs)** for machine/API automation (see below)

### Personal access tokens (users and keycloak modes)

User-bound tokens for scripts and CI. They are **not** a console login password. **Not available** when `AUTHENTICATION_METHOD=api-key`.

| Concern                  | Behavior                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Create / update / revoke | Console **Personal Access Tokens** page (`/settings/tokens`); interactive console session only (password JWT or Keycloak OIDC) |
| Exchange                 | `POST /auth/token` with `{ "token": "fp_pat_…" }` only (no email) → JWT with `amr: ["pat"]` and `scopes`                       |
| Console                  | Login rejects `fp_pat_` secrets; SPA rejects JWTs whose `amr` includes `pat`; WebSockets reject PAT JWTs                       |
| Keycloak                 | Local `users` row is synced on first authenticated request (`keycloakSub`); PAT CRUD and exchange require `JWT_SECRET`         |
| Scopes                   | `AGENSTRA_PAT_SCOPES` (see [Scope model](#scope-model)); each enforced via `@RequireScopes`                                    |

Compared to `STATIC_API_KEY`, PATs are per-user, scoped, rotatable, and do not grant cross-tenant admin by default.

Updating a token changes **name** and **scopes** only; the secret is never rotated by update. Exchanged PAT JWTs embed `patId`; each request re-checks the PAT row so **revoke**, **expiry**, and **scope updates** take effect immediately. **Role demotion** also takes effect immediately: request roles come from the live DB user (not the JWT claim), admin-only scopes are stripped from the effective grant set, and changing a user’s role bumps `tokenVersion` so outstanding JWTs are rejected.

#### Scope model

Scopes follow `<resource>:<level>` with three hierarchical levels per resource (similar to GitHub token permissions):

| Level   | Grants                                                                           | Implies            |
| ------- | -------------------------------------------------------------------------------- | ------------------ |
| `read`  | Read operations in non-admin scope                                               | —                  |
| `write` | All other non-admin operations on the resource                                   | `read`             |
| `admin` | Operations reserved to admins and their console / API (admin role also required) | `write` and `read` |

`:admin` scopes are only grantable to admins and are stripped from the effective grant set when the user is not an admin. Routes without `@RequireScopes` reject PATs (fail-closed). Each operation's required scope is listed in the OpenAPI spec as the role name on its `bearerAuth` security requirement.

| Resource            | Levels               | Covers                                                                                                                                                                                              |
| ------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients`           | read / write / admin | Workspaces, members, provisioning, isolation, egress, configuration overrides, workspace + agent OpenCode config, provider/MCP catalogs; admin: instance OpenCode config (`/admin/opencode/config`) |
| `agents`            | read / write         | Agent CRUD, models, permission/question replies, autonomy, start/stop/restart                                                                                                                       |
| `agent_files`       | read / write         | Agent workspace files and workspace search (write: edit files, reindex)                                                                                                                             |
| `agent_environment` | read / write         | Agent environment variables                                                                                                                                                                         |
| `agent_chats`       | read / write         | Chat sessions and messages, chat plans, scheduled agent tasks                                                                                                                                       |
| `agent_vcs`         | read / write         | Git status/branches/diff; write: stage, commit, push, pull, rebase, branches, automation command checks                                                                                             |
| `agent_deployments` | read / write         | CI/CD configuration, repositories, workflows, runs and logs; write: configure, trigger, cancel                                                                                                      |
| `agent_vnc`         | write                | Remote desktop session tickets                                                                                                                                                                      |
| `tickets`           | read / write         | Tickets, comments, activity, ticket automation                                                                                                                                                      |
| `knowledge`         | read / write         | Knowledge tree, pages, relations                                                                                                                                                                    |
| `attachments`       | read / write         | Ticket, knowledge and chat attachments                                                                                                                                                              |
| `statistics`        | read                 | Workspace and aggregate statistics                                                                                                                                                                  |
| `imports`           | admin                | Atlassian context import                                                                                                                                                                            |
| `users`             | admin                | User management                                                                                                                                                                                     |
| `webhooks`          | admin                | Webhook endpoints                                                                                                                                                                                   |
| `updates`           | admin                | Application update checks                                                                                                                                                                           |

Stored tokens were migrated to this model (`RefactorPersonalAccessTokenScopes1793600000000`); legacy scopes that could only be mapped by granting additional writes were dropped, so affected tokens must be re-issued.

### Apps (third-party authorization; users and keycloak modes)

Admins can register **apps**: external applications that act on behalf of users after the user authorizes them (similar to GitHub OAuth apps). Apps reuse the [PAT scope catalog](#scope-model). **Not available** when `AUTHENTICATION_METHOD=api-key`.

| Concern        | Behavior                                                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Management     | Console **Apps** page (`/apps`, admin, interactive session only): name, description, return URL, scopes. The app id is the row UUID; the app secret (`fp_aps_…`) is shown once and stored as a bcrypt hash only |
| Return URL     | Absolute `https` URL (`http` only for `localhost` / `127.0.0.1`), no credentials, no fragment. Redirects only ever go to the registered URL (no caller-supplied redirect URI)                                   |
| Grant page     | `/authorize?app_id=<uuid>&state=<opaque>[&code_challenge=<S256>&code_challenge_method=S256]`; shows the login mask first when needed, then app name, description and scopes                                     |
| Scope cap      | A user only grants the requested scopes their own role may grant (`:admin` scopes only for admins); the rest is shown as "not granted". The cap is re-applied on every request                                  |
| Second factor  | Approving a new (or changed) authorization requires the user's 2FA: authenticator code, or an emailed code when email 2FA is enabled or forced. Keycloak accounts rely on Keycloak MFA                          |
| Skip consent   | An existing, up-to-date authorization redirects back immediately with a new code (no consent, no 2FA)                                                                                                           |
| Redirect       | Approved: `status=approved&app_id&code&state`. Denied: `status=denied&error=access_denied&error_description&state`. No grantable scope: `status=error&error=invalid_scope`                                      |
| Token exchange | `POST /auth/apps/token` (public, rate-limited, server-to-server) with `app_id`, `app_secret` and either the `code` (+ `code_verifier`) or a `refresh_token`; returns an access JWT (1 h) and a refresh token    |
| Lifetime       | Authorizations never expire. Codes are single-use (10 min); refresh tokens rotate on every use. Replaying a code or an old refresh token revokes the affected session                                           |
| Access tokens  | JWT with `amr: ["pat", "app"]`, `scopes`, `appId`, `appSessionId`. Treated exactly like PAT JWTs: fail-closed `@RequireScopes`, no interactive-only routes (token/app management, 2FA, password), no WebSockets |
| Live checks    | Every request re-checks session, authorization, app, user (locked, unconfirmed, tenant, token version) and the effective scopes; any drift rejects the token so the app refreshes                               |
| Re-auth        | When the app gains a scope (or the user can now grant more), tokens keep the previously consented scopes and the token response sets `reauthorization_required: true`; the grant page asks again                |
| Revocation     | Admins revoke one or all authorizations of an app; users revoke their own under **Authorized apps** (`/settings/apps`). Revoking ends all sessions and forces the full consent flow next time                   |

Effective scopes of an app token = consented scopes ∩ current app scopes ∩ scopes the user's current role may grant. Removing a scope from the app or demoting the user takes effect immediately; adding a scope requires re-authorization.

Example token exchange:

```bash
curl -X POST https://<host>/api/auth/apps/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"authorization_code","app_id":"<app id>","app_secret":"fp_aps_…","code":"fp_apc_…"}'
# → { "access_token": "…", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "fp_apr_…",
#     "scope": "tickets:read", "scopes": ["tickets:read"], "reauthorization_required": false, "user": { … } }
```

## Users Authentication Flow

### Registration

1. User registers with email and password
2. System checks if signup is enabled (`DISABLE_SIGNUP` environment variable)
3. If signup is disabled, registration returns 503 Service Unavailable
4. If enabled, user account is created:
   - First user: Auto-confirmed and assigned admin role
   - Subsequent users: Receive 6-character alphanumeric confirmation code via email (queued; see [Email notifications](./email-notifications.md))

### Email Confirmation

1. User receives confirmation code via email (6-character alphanumeric: uppercase letters and numbers)
2. User enters email and code on confirmation page
3. System validates the code and consumes it atomically (only one concurrent confirmation can succeed)
4. User can now log in

If the confirmation page was closed before the code was entered, the confirmation email explains how to continue: sign in again with the same email address (the app returns to the confirmation page), or open `/confirm-email` and enter the email address with the code manually.

### Login

1. User enters email and password
2. System validates credentials
3. System checks if email is confirmed
4. System checks if the account is locked (`locked_at` must be null)
5. If valid, JWT token is issued
6. Token is stored in localStorage and included in subsequent requests

When credentials are valid but the email is not confirmed yet, login returns `401` with code `EMAIL_NOT_CONFIRMED` and the frontend redirects to `/confirm-email` with the email pre-filled.

### Password Reset

1. User requests password reset with email
2. System sends 6-character alphanumeric reset code via email
3. User enters email, code, and new password
4. System validates the code and consumes it atomically while updating the password (only one concurrent reset can succeed)
5. User can log in with new password

## Disabling Signup

When `DISABLE_SIGNUP=true` is set:

### Backend Behavior

- `POST /api/auth/register` endpoint returns `503 Service Unavailable` with message "Signup is disabled"
- Self-registration is completely disabled
- Admin user creation via `POST /api/users` remains available for onboarding

### Frontend Behavior

- "Create an account" link is hidden on the login page
- Direct navigation to `/register` redirects to `/login`
- Users must be created by administrators

### Configuration

**Backend**:

```bash
DISABLE_SIGNUP=true
```

**Frontend** (via CONFIG JSON):

```json
{
  "authentication": {
    "type": "users",
    "disableSignup": true
  }
}
```

The frontend configuration should match the backend `DISABLE_SIGNUP` setting to ensure consistent behavior.

## User Roles

### Admin Role

- Full access to all features
- User management (create, read, update, delete users)
- Can lock and unlock user accounts
- Can create users via `POST /api/users`
- First user in the system automatically gets admin role

### User Role

- Standard user access
- Cannot manage other users
- Can change own password
- Can update own profile

## Admin User Management

Admins can manage users via the user management interface or API:

### Create User

- Admin creates user via `POST /api/users`
- Non-first users receive confirmation email
- User must confirm email before logging in

### Update User

- Admin can update user details
- Email changes require confirmation
- Password changes take effect immediately

### Delete User

- Admin can delete users
- Deletion removes all user data

### Lock / Unlock User

- Admin can lock users via `POST /api/users/:id/lock`
- Admin can unlock users via `POST /api/users/:id/unlock`
- Locked users cannot log in while `locked_at` has a timestamp value
- Existing JWTs stop working on the next API call once a user is locked (or deleted): the server reloads the user row and rejects locked or missing accounts
- In **keycloak** mode, the same `users` row is consulted after a valid Keycloak token is accepted: HTTP requests fail with 401 if the synced user is locked, and WebSocket auth denies connections when the Keycloak-linked row is locked
- Admins cannot lock or unlock themselves

## Security Features

### Password Security

- Passwords are hashed using bcrypt
- Minimum password length enforced
- Password confirmation required on registration

### Token Security

- JWT tokens expire after 7 days
- Tokens are stored securely in localStorage
- Tokens include user ID, email, role, and a token version (`tv`) claim
- Each authenticated request in **users** mode verifies the user still exists, is not locked (`locked_at` null), and that the JWT token version matches the user's `token_version` in the database
- **Logout** (`POST /api/auth/logout`) revokes the current JWT session by default; optional `invalidateAllSessions: true` bumps `token_version` and ends every session
- **Password change** increments `token_version` and returns a new JWT for the current browser; all other sessions are invalidated on their next request
- **Password reset** and **admin password updates** increment `token_version`; affected users must log in again
- In **keycloak** mode, session lifecycle is managed by Keycloak (the app backend does not issue JWTs)
- Each authenticated request in **keycloak** mode applies the same lock check against the local user row
- The SPA registers an HTTP interceptor (`getUsersSessionInvalidationInterceptor`) that, in **users** or **keycloak** mode, dispatches logout on 401 with session-ending messages (locked account, invalid/expired token, etc.). In users mode it also clears the stored JWT; in keycloak mode existing logout effects end the Keycloak session and return the UI to the login flow

### Email Confirmation

- 6-character alphanumeric confirmation codes
- Codes expire after use
- Prevents unauthorized account creation

### Rate Limiting

- All endpoints are rate-limited
- Prevents brute force attacks
- Configurable limits per endpoint

## API Endpoints

### Authentication Endpoints (Public)

- `POST /api/auth/login` - Login with email/password (console; PATs rejected)
- `POST /api/auth/token` - Exchange personal access token for machine JWT (`amr: pat`)
- `POST /api/auth/register` - Register new user (returns 503 when `DISABLE_SIGNUP=true`)
- `POST /api/auth/confirm-email` - Confirm email with 6-character code
- `POST /api/auth/request-password-reset` - Request password reset
- `POST /api/auth/reset-password` - Reset password with code
- `POST /api/auth/change-password` - Change password (authenticated; returns new JWT)
- `POST /api/auth/logout` - Log out and invalidate all JWT sessions (users auth only)

### Personal Access Token Endpoints (Password session)

- `GET /api/auth/token-scopes` - Grantable scopes for the current user
- `GET /api/auth/tokens` - List own tokens
- `POST /api/auth/tokens` - Create token (plaintext returned once)
- `PATCH /api/auth/tokens/:id` - Update own token name and scopes (secret unchanged)
- `DELETE /api/auth/tokens/:id` - Revoke own token
- `GET /api/users/:userId/tokens` - List tokens for a user (admin)
- `DELETE /api/users/:userId/tokens/:tokenId` - Revoke a user's token (admin)

### App Endpoints

| Method   | Path                         | Auth                        | Purpose                                        |
| -------- | ---------------------------- | --------------------------- | ---------------------------------------------- |
| `POST`   | `/auth/apps/token`           | Public (app id + secret)    | Exchange code / refresh token for access token |
| `GET`    | `/auth/apps/authorize`       | Interactive session         | Grant page data                                |
| `POST`   | `/auth/apps/authorize`       | Interactive session (+ 2FA) | Approve or deny; returns redirect to the app   |
| `GET`    | `/auth/apps/grants`          | Interactive session         | Own authorized apps                            |
| `DELETE` | `/auth/apps/grants/:grantId` | Interactive session         | Revoke own authorization                       |
| `GET`    | `/apps`                      | Admin, interactive session  | List apps                                      |
| `POST`   | `/apps`                      | Admin, interactive session  | Create app (secret returned once)              |
| `PATCH`  | `/apps/:id`                  | Admin, interactive session  | Update app                                     |
| `DELETE` | `/apps/:id`                  | Admin, interactive session  | Delete app with all authorizations             |
| `POST`   | `/apps/:id/secret`           | Admin, interactive session  | Regenerate secret (returned once)              |
| `GET`    | `/apps/:id/grants`           | Admin, interactive session  | List user authorizations                       |
| `DELETE` | `/apps/:id/grants`           | Admin, interactive session  | Revoke all authorizations                      |
| `DELETE` | `/apps/:id/grants/:grantId`  | Admin, interactive session  | Revoke one authorization                       |

### User Management Endpoints (Admin Only)

- `GET /api/users` - List users
- `POST /api/users` - Create user
- `GET /api/users/:id` - Get user
- `POST /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user
- `POST /api/users/:id/lock` - Lock user account
- `POST /api/users/:id/unlock` - Unlock user account

## Authentication Flow Diagram

```mermaid
flowchart TB
    subgraph AUTH["Authentication Methods"]
        direction TB
        AUTH_METHOD["AUTHENTICATION_METHOD env"]
        AUTH_METHOD --> API_KEY["api-key"]
        AUTH_METHOD --> KEYCLOAK["keycloak"]
        AUTH_METHOD --> USERS["users"]
    end

    subgraph API_KEY_FLOW["API Key Flow"]
        API_KEY --> AK1["STATIC_API_KEY required"]
        AK1 --> AK2["Authorization: Bearer &lt;key&gt; or ApiKey &lt;key&gt;"]
        AK2 --> AK3["Always admin rights"]
    end

    subgraph KEYCLOAK_FLOW["Keycloak Flow"]
        KEYCLOAK --> KC1["Keycloak OAuth2 / OIDC"]
        KC1 --> KC2["User synced to users table"]
        KC2 --> KC3["First user = admin, rest = user"]
    end

    subgraph USERS_FLOW["Users Flow (Built-in)"]
        USERS --> UF1["JWT-based auth"]
        UF1 --> UF2["Register / Login / Confirm Email"]
        UF2 --> UF2a["DISABLE_SIGNUP: register returns 503"]
        UF2 --> UF3["Password reset support (6-char alphanumeric code via email)"]
        UF3 --> UF4["First user = admin, rest = user"]
        UF4 --> UF5["Admin CRUD for users"]
        UF5 --> UF6["Admin create/email change: confirmation email sent"]
        UF5 --> UF7["Admin lock/unlock user accounts"]
        UF2 --> UF8["Login denied when account is locked (locked_at not null)"]
    end
```

## Registration Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant Email

    alt Signup Enabled
        User->>Frontend: Register (email, password)
        Frontend->>Backend: POST /api/auth/register
        Backend->>Backend: Check DISABLE_SIGNUP
        Backend->>Backend: Create user account
        alt First User
            Backend->>Backend: Auto-confirm, assign admin role
            Backend-->>Frontend: 201 {user, message: "Account created"}
        else Subsequent User
            Backend->>Backend: Generate 6-char code
            Backend->>Email: Send confirmation code
            Backend-->>Frontend: 201 {user, message: "Check email"}
        end
    else Signup Disabled
        User->>Frontend: Register (email, password)
        Frontend->>Backend: POST /api/auth/register
        Backend->>Backend: Check DISABLE_SIGNUP=true
        Backend-->>Frontend: 503 Service Unavailable
        Frontend->>User: Show error: "Signup is disabled"
    end
```

## Per-Client Permissions

When using **keycloak** or **users** authentication, access to clients is controlled by per-client permissions. Users can be assigned to clients with roles (admin/user). In **api-key** mode, users do not play a role and all permission checks are bypassed.

See **[Client Management](./client-management.md#per-client-permissions)** for details on access control rules and managing client users.

## Related documentation

- **[Environment Configuration](../deployment/environment-configuration.md)** Environment variable reference
- **[Security (Accepted risks)](../security/accepted-risks.md)** **AR-003** (implicit authentication method resolution when `AUTHENTICATION_METHOD` is unset)
- **[Security (Operational hardening)](../security/operational-hardening.md)** Backend authentication resolution behavior
- **[Client Management](./client-management.md)** Per-client permissions and user management
- **[Backend Agent Controller Application](../applications/backend-agent-controller.md)** Backend authentication implementation
- **[Frontend Agent Console Application](../applications/frontend-agent-console.md)** Frontend authentication UI

---

_For detailed API specifications, see the application and API reference docs linked below._
