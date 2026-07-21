# agenstra-backend-agent-controller

NestJS backend application for managing clients and proxying agent operations to remote agent-manager services.

## Purpose

This application provides a centralized control plane for managing multiple distributed agent-manager instances. It enables the creation, management, and real-time interaction with agents across multiple remote agent-manager services through both synchronous HTTP requests and persistent WebSocket connections.

See the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#purpose) for detailed feature descriptions.

## Features

This application provides:

- **HTTP REST API** - Full CRUD operations for client management and proxied agent operations
- **WebSocket Gateway** - Real-time bidirectional event forwarding to remote agent-manager services
- **Server Provisioning** - Automated cloud server provisioning (Hetzner Cloud, DigitalOcean) with Docker and agent-manager deployment
- **Per-Client Permissions** - Fine-grained access control with user roles per client (admin/user)
- **Secure Authentication** - Keycloak integration for HTTP endpoints and API key fallback
- **Database Support** - PostgreSQL with TypeORM for data persistence
- **Auto Migrations** - Automatic database schema migrations on startup

For complete feature details, see the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#features).

## Architecture

This application is built using:

- **NestJS** - Progressive Node.js framework
- **TypeORM** - Object-Relational Mapping for database operations
- **Keycloak** - Identity and access management
- **Socket.IO** - WebSocket communication

The application integrates the `@forepath/agenstra/backend/feature-agent-controller` library, which provides the core client management functionality. See the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#architecture) for detailed architecture information.

## Usage

### Prerequisites

- Node.js 24.14.1 or higher
- PostgreSQL database
- Keycloak server (for HTTP authentication, optional if using API key authentication)
- Docker (for server provisioning)

### Installation

```bash
# Install dependencies
npm install

# Build the application
nx build agenstra-backend-agent-controller

# Run the application
nx serve agenstra-backend-agent-controller
```

### Database Migrations

The application automatically runs pending migrations on startup when `synchronize` is disabled in the TypeORM configuration. To use migrations:

1. Set `synchronize: false` in `typeorm.config.ts`
2. Create migration files in `src/migrations/`
3. Migrations will run automatically on application startup

## API Endpoints

All HTTP endpoints are prefixed with `/api` and protected by Keycloak authentication (or API key authentication if `STATIC_API_KEY` is set).

For complete API endpoint documentation, request/response schemas, and authentication requirements, see the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#api-endpoints).

## WebSocket Gateway

The Socket.IO WebSocket gateway is available at `http://localhost:8081/clients` (or configured `WEBSOCKET_PORT`).

For complete WebSocket event specifications, authentication flow, and usage examples, see the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#websocket-gateway).

## Authentication

Authentication is configured via `AUTHENTICATION_METHOD`:

- **`api-key`**: Static API key (requires `STATIC_API_KEY`). Use `Authorization: Bearer <key>`.
- **`keycloak`**: Keycloak OAuth2 (requires Keycloak env vars). Users are synced to the users table.
- **`users`**: Built-in user registration with JWT (requires `JWT_SECRET`). Register, confirm email, login.

For detailed authentication requirements and users auth endpoints, see the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#authentication).

### WebSocket Gateway

The WebSocket gateway uses client context management. See the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#authentication) for authentication details.

## Database Setup

The application uses TypeORM and requires a database connection to be configured. See the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#database-setup) for database setup requirements and entity schema.

## Testing

Run unit tests:

```bash
nx test agenstra-backend-agent-controller
```

For library testing information, see the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#testing).

## Security Considerations

For security best practices and considerations, see the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#security-considerations).

## Rate Limiting

The application implements configurable rate limiting on all API endpoints to prevent abuse and protect against DoS attacks.

### Configuration

Rate limiting is configured via environment variables:

- **`RATE_LIMIT_ENABLED`** - Enable/disable rate limiting
  - Default: `true` in production, `false` in development
  - Set to `false` to disable rate limiting
  - Set to `true` to explicitly enable in development

- **`RATE_LIMIT_TTL`** - Time window in seconds
  - Default: `60` (1 minute)
  - Defines the time window for rate limit tracking

- **`RATE_LIMIT_LIMIT`** - Maximum number of requests per window
  - Default: `100` requests per window
  - When rate limiting is disabled, this is set to `10000` (effectively unlimited)

### Behavior

- **Production**: Rate limiting is **enabled by default** (100 requests per 60 seconds)
- **Development**: Rate limiting is **disabled by default** (allows up to 10,000 requests per window)

### Error Response

When rate limit is exceeded, the API returns:

- **Status Code**: `429 Too Many Requests`
- **Message**: `"Too many requests, please try again later."`

### Example Configuration

```bash
# Production: Enable rate limiting with custom limits
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL=60
RATE_LIMIT_LIMIT=100

# Development: Disable rate limiting
RATE_LIMIT_ENABLED=false
```

## CORS Configuration

The application implements production-safe CORS defaults to prevent unauthorized cross-origin requests.

### Configuration

CORS is configured via the `CORS_ORIGIN` environment variable:

- **`CORS_ORIGIN`** - Comma-separated list of allowed origins
  - Example: `"https://agenstra.com,https://app.agenstra.com"`
  - If not set, behavior depends on environment:
    - **Production**: CORS is **disabled** (no origins allowed) - most secure default
    - **Development**: CORS allows **all origins** (`*`) - convenient for local development

### Behavior

- **Production**: CORS is **disabled by default** (empty origins array)
  - ⚠️ **Warning**: If `CORS_ORIGIN` is not set in production, the application will log a warning and CORS will be disabled
  - **Required**: Set `CORS_ORIGIN` to allow specific origins in production

- **Development**: CORS allows **all origins** (`*`) by default
  - Can be restricted by setting `CORS_ORIGIN` to specific origins

### Security Headers

The CORS configuration includes:

- **Allowed Methods**: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- **Allowed Headers**: `Content-Type, Authorization`
- **Exposed Headers**: `Content-Range, X-Content-Range`
- **Credentials**: Enabled when specific origins are configured (not with `*`)

### Example Configuration

```bash
# Production: Allow specific origins
CORS_ORIGIN="https://agenstra.com,https://app.agenstra.com"

# Development: Allow all origins (default, no configuration needed)
# Or restrict to specific origins:
CORS_ORIGIN="http://localhost:4200,http://localhost:3000"
```

## Environment Variables

See the [library documentation](../../libs/domains/agenstra/backend/feature-agent-controller/README.md#environment-variables) for complete environment variable documentation.

**Application-specific:**

- `PORT` - HTTP API port (default: `3100`)
- `WEBSOCKET_PORT` - WebSocket gateway port (default: `8081`)
- `NODE_ENV` - Environment mode (`development` or `production`)

**CORS Configuration:**

- `CORS_ORIGIN` - Allowed CORS origins (comma-separated list)
  - Production: **Required** - Set to allow specific origins (CORS disabled if not set)
  - Development: Optional - Defaults to `*` (all origins allowed)

**Rate Limiting:**

- `RATE_LIMIT_ENABLED` - Enable/disable rate limiting (default: `true` in production, `false` in development)
- `RATE_LIMIT_TTL` - Time window in seconds (default: `60`)
- `RATE_LIMIT_LIMIT` - Maximum requests per window (default: `100`)

**Authentication:**

- `AUTHENTICATION_METHOD` - `api-key`, `keycloak`, or `users` (default: api-key when STATIC_API_KEY set, else keycloak)
- `STATIC_API_KEY` - Static API key (required when AUTHENTICATION_METHOD=api-key)
- `JWT_SECRET` - JWT signing secret (required when `AUTHENTICATION_METHOD=users` or `keycloak`; used for users sessions and PAT exchange)
- `KEYCLOAK_SERVER_URL` - Keycloak server URL (optional, used for server URL if different from auth server URL)
- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak authentication server URL (required for Keycloak auth)
- `KEYCLOAK_REALM` - Keycloak realm name (required for Keycloak auth)
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID (required for Keycloak auth)
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret (required for Keycloak auth)
- `KEYCLOAK_TOKEN_VALIDATION` - Token validation method: `ONLINE` or `OFFLINE` (optional, default: `ONLINE`)

**Database:**

- `DB_HOST` - Database host (default: `localhost`)
- `DB_PORT` - Database port (default: `5432`)
- `DB_USERNAME` - Database username (default: `postgres`)
- `DB_PASSWORD` - Database password (default: `postgres`)
- `DB_DATABASE` - Database name (default: `postgres`)

**Server Provisioning:**

- `HETZNER_API_TOKEN` - Hetzner Cloud API token (for server provisioning)
- `DIGITALOCEAN_API_TOKEN` - DigitalOcean API token (for server provisioning)
- `ENCRYPTION_KEY` - Encryption key for sensitive data

**Dynamic provider plugins (optional):**

- `DYNAMIC_PROVISIONING_PROVIDERS` - Comma-separated extra provisioning packages (`alias=@forepath/pkg` or `alias=file:dir`)
- `DYNAMIC_CONTEXT_IMPORT_PROVIDERS` - Comma-separated extra context import provider packages
- `DYNAMIC_PROVIDERS_FAIL_FAST` - When `true`, abort startup if critical dynamic providers fail to load (recommended in production when `DYNAMIC_PROVISIONING_PROVIDERS` is set)
- `DYNAMIC_PROVIDER_PLUGIN_PATH` - Absolute plugin root for post-build loading (unset by default; set to `/var/lib/forepath/provider-plugins` when using the compose volume)
- `DYNAMIC_PROVIDER_PLUGIN_INSTALL` - Comma-separated packages/tarballs to `npm install` into the plugin path at container startup

See `@forepath/shared/backend/util-dynamic-provider-registry` README for plugin export contract, baked-in vs mounted loading, and the post-build operator workflow.

### Post-build plugins (no image rebuild)

1. Build the plugin package (`nx build <plugin-lib>`) to produce compiled JS and `package.json`
2. Copy the plugin into `./provider-plugins/` on the host (mounted read-only in compose) and/or set `DYNAMIC_PROVIDER_PLUGIN_INSTALL`
3. Set `DYNAMIC_PROVISIONING_PROVIDERS` (or other `DYNAMIC_*` vars) to reference the package name
4. Restart the container

## Docker Deployment

The application includes Dockerfiles for containerized deployment:

```bash
# Build API container
nx docker:api agenstra-backend-agent-controller
```

### Running the Container

```bash
# Run with docker-compose (recommended)
cd apps/agenstra-backend-agent-controller
docker compose up -d

# Or run directly
docker run \
  -p 3100:3100 \
  -p 8081:8081 \
  -e CORS_ORIGIN="https://agenstra.com" \
  -e RATE_LIMIT_ENABLED=true \
  -e RATE_LIMIT_LIMIT=100 \
  agenstra-backend-agent-controller:api
```

### Production Deployment Checklist

Before deploying to production, ensure:

- ✅ `NODE_ENV=production` is set
- ✅ `CORS_ORIGIN` is configured with your production domain(s)
- ✅ `RATE_LIMIT_ENABLED=true` (or leave unset, defaults to `true` in production)
- ✅ `RATE_LIMIT_LIMIT` is set to an appropriate value for your use case
- ✅ `STATIC_API_KEY` or Keycloak credentials are configured
- ✅ Database credentials are secure
- ✅ `ENCRYPTION_KEY` is set for sensitive data encryption

## License

This application is licensed under the **Business Source License 1.1 (BUSL-1.1)**.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

This program is licensed under the Business Source License 1.1, which permits non-production use and limited production use (subject to the Additional Use Grant terms). The license will convert to AGPL-3.0 after the Change Date (three years from release date).

See the [LICENSE](./LICENSE) file for the full license text.

**Note**: This component is sublicensed under BUSL-1.1, while the rest of the project remains under the MIT License. This means that production use is subject to the terms of the Business Source License.
