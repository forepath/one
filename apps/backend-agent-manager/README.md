# backend-agent-manager

NestJS backend application for managing and interacting with AI agents through HTTP REST API and WebSocket gateway.

## Purpose

This application provides a complete agent management system by integrating the `@forepath/framework-backend-feature-agent-manager` library. It enables the creation, management, and real-time interaction with AI agents through both synchronous HTTP requests and persistent WebSocket connections.

See the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#purpose) for detailed feature descriptions.

## Features

This application provides:

- **HTTP REST API** - Full CRUD operations for agent management
- **WebSocket Gateway** - Real-time bidirectional communication with agents
- **Container Integration** - Docker container management for agent execution
- **Secure Authentication** - Keycloak integration for HTTP endpoints and database-backed authentication for WebSocket
- **Database Support** - PostgreSQL with TypeORM for data persistence
- **Auto Migrations** - Automatic database schema migrations on startup

For complete feature details, see the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#features).

## Architecture

This application is built using:

- **NestJS** - Progressive Node.js framework
- **TypeORM** - Object-Relational Mapping for database operations
- **Keycloak** - Identity and access management
- **Socket.IO** - WebSocket communication
- **Docker** - Container management for agent execution

The application integrates the `@forepath/framework-backend-feature-agent-manager` library, which provides the core agent management functionality. See the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#architecture) for detailed architecture information.

## Usage

### Prerequisites

- Node.js 24.14.1 or higher
- PostgreSQL database
- Keycloak server (for HTTP authentication)
- Docker (for agent container management)

### Installation

```bash
# Install dependencies
npm install

# Build the application
nx build backend-agent-manager

# Run the application
nx serve backend-agent-manager
```

### Database Migrations

The application automatically runs pending migrations on startup when `synchronize` is disabled in the TypeORM configuration. To use migrations:

1. Set `synchronize: false` in `typeorm.config.ts`
2. Create migration files in `src/migrations/`
3. Migrations will run automatically on application startup

## API Endpoints

All HTTP endpoints are prefixed with `/api` and protected by Keycloak authentication.

For complete API endpoint documentation, request/response schemas, and authentication requirements, see the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#api-endpoints).

## WebSocket Gateway

The Socket.IO WebSocket gateway is available at `http://localhost:8080/agents` (or configured `WEBSOCKET_PORT`).

For complete WebSocket event specifications, authentication flow, and usage examples, see the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#websocket-gateway).

## Authentication

### HTTP Endpoints

All HTTP endpoints are protected by Keycloak authentication.

⚠️ **Note**: When using Keycloak authentication, the JWT token must include the `agent_management` role to access agent-manager endpoints.

For detailed authentication requirements, see the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#authentication).

### WebSocket Gateway

The WebSocket gateway uses database-backed authentication. See the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#authentication) for authentication details.

## Database Setup

The application uses TypeORM and requires a database connection to be configured. See the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#database-setup) for database setup requirements and entity schema.

## Testing

Run unit tests:

```bash
nx test backend-agent-manager
```

For library testing information, see the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#testing).

## Security Considerations

For security best practices and considerations, see the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#security-considerations). CRA-oriented **[threat model](../../docs/agenstra/security/threat-model.md#backend-agent-manager)** and **[risk profile](../../docs/agenstra/security/risk-profile.md#backend-agent-manager)** for this service are in the docs site.

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

See the [library documentation](../../libs/domains/framework/backend/feature-agent-manager/README.md#environment-variables) for complete environment variable documentation.

**Application-specific:**

- `PORT` - HTTP API port (default: `3000`)
- `WEBSOCKET_PORT` - WebSocket gateway port (default: `8080`)
- `NODE_ENV` - Environment mode (`development` or `production`)

**CORS Configuration:**

- `CORS_ORIGIN` - Allowed CORS origins (comma-separated list)
  - Production: **Required** - Set to allow specific origins (CORS disabled if not set)
  - Development: Optional - Defaults to `*` (all origins allowed)

**Rate Limiting:**

- `RATE_LIMIT_ENABLED` - Enable/disable rate limiting (default: `true` in production, `false` in development)
- `RATE_LIMIT_TTL` - Time window in seconds (default: `60`)
- `RATE_LIMIT_LIMIT` - Maximum requests per window (default: `100`)

## Docker Deployment

The application includes Dockerfiles for containerized deployment:

```bash
# Build API container
nx docker:api backend-agent-manager

# Build worker container
nx docker:worker backend-agent-manager
```

### Running the Container

When running the API container, you must mount the Docker socket to enable Docker-in-Docker functionality for agent container management:

```bash
# Run with docker-compose (recommended)
cd apps/backend-agent-manager
docker compose up -d

# Or run directly with Docker socket mount
docker run -v /var/run/docker.sock:/var/run/docker.sock \
  -p 3000:3000 \
  -p 8080:8080 \
  -e CORS_ORIGIN="https://agenstra.com" \
  -e RATE_LIMIT_ENABLED=true \
  -e RATE_LIMIT_LIMIT=100 \
  backend-agent-manager:api
```

**Important**: The `/var/run/docker.sock` mount is required for the application to manage agent containers. Without this mount, the Docker CLI installed in the container will not be able to communicate with the host Docker daemon.

The API container runs as **`agenstra`** (UID/GID 10001), not root. At startup the entrypoint syncs the in-container `docker` group to the socket’s GID, then starts Node. If Docker commands fail with permission errors, rebuild with `--build-arg DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)`.

Worker, VNC, and SSH images use the same non-root user; private Git credentials are written under the worker’s `$HOME` (typically `/home/agenstra`). See **[Operational hardening](../../docs/agenstra/security/operational-hardening.md#container-images-docker)** in the docs site.

### Production Deployment Checklist

Before deploying to production, ensure:

- ✅ `NODE_ENV=production` is set
- ✅ `CORS_ORIGIN` is configured with your production domain(s)
- ✅ `RATE_LIMIT_ENABLED=true` (or leave unset, defaults to `true` in production)
- ✅ `RATE_LIMIT_LIMIT` is set to an appropriate value for your use case
- ✅ `STATIC_API_KEY` or Keycloak credentials are configured
- ✅ Database credentials are secure
- ✅ Docker socket is properly mounted for container management
- ✅ API, worker, VNC, and SSH image tags match the same release

## License

This application is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

**Note**: This component is sublicensed under AGPL-3.0, while the rest of the project remains under the MIT License. This means that any modifications or derivative works of this application must also be licensed under AGPL-3.0 and made available to users, including when accessed over a network.
