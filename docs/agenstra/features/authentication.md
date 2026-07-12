# Authentication

Authentication system supporting multiple authentication methods with configurable user registration.

## Overview

Agenstra supports three authentication methods:

- **API Key Authentication** - Static API key for simple authentication
- **Keycloak Authentication** - OAuth2/OIDC via Keycloak
- **Users Authentication** - Built-in user registration with JWT

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
```

**Features**:

- User registration with email/password
- Email confirmation with 6-character alphanumeric codes
- Password reset functionality
- JWT-based authentication
- First registered user gets admin role
- Admin user management (CRUD operations)
- Optional signup disable for controlled onboarding

## Users Authentication Flow

### Registration

1. User registers with email and password
2. System checks if signup is enabled (`DISABLE_SIGNUP` environment variable)
3. If signup is disabled, registration returns 503 Service Unavailable
4. If enabled, user account is created:
   - First user: Auto-confirmed and assigned admin role
   - Subsequent users: Receive 6-character alphanumeric confirmation code via email

### Email Confirmation

1. User receives confirmation code via email (6-character alphanumeric: uppercase letters and numbers)
2. User enters email and code on confirmation page
3. System validates code and confirms email
4. User can now log in

### Login

1. User enters email and password
2. System validates credentials
3. System checks if email is confirmed
4. System checks if the account is locked (`locked_at` must be null)
5. If valid, JWT token is issued
6. Token is stored in localStorage and included in subsequent requests

### Password Reset

1. User requests password reset with email
2. System sends 6-character alphanumeric reset code via email
3. User enters email, code, and new password
4. System validates code and updates password
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

- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/register` - Register new user (returns 503 when `DISABLE_SIGNUP=true`)
- `POST /api/auth/confirm-email` - Confirm email with 6-character code
- `POST /api/auth/request-password-reset` - Request password reset
- `POST /api/auth/reset-password` - Reset password with code
- `POST /api/auth/change-password` - Change password (authenticated; returns new JWT)
- `POST /api/auth/logout` - Log out and invalidate all JWT sessions (users auth only)

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

## Related Documentation

- **[Environment Configuration](../deployment/environment-configuration.md)** - Environment variable reference
- **[Security - Accepted risks](../security/accepted-risks.md)** - **AR-003** (implicit authentication method resolution when `AUTHENTICATION_METHOD` is unset)
- **[Security — Operational hardening](../security/operational-hardening.md)** - Backend authentication resolution behavior
- **[Client Management](./client-management.md)** - Per-client permissions and user management
- **[Backend Agent Controller Application](../applications/backend-agent-controller.md)** - Backend authentication implementation
- **[Frontend Agent Console Application](../applications/frontend-agent-console.md)** - Frontend authentication UI

---

_For detailed API specifications, see the application and API reference docs linked below._
