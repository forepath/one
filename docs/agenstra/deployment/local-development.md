# Local Development

Setting up Agenstra for local development and testing.

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 24.14.1 or higher
- **PostgreSQL** database (running locally or in Docker)
- **Docker** and **Docker Compose** (for agent containers)
- **Keycloak** server (optional, can use API key authentication)
- **Git** repository (optional, for agent workspace)

## Installation

### Clone Repository

```bash
git clone https://github.com/forepath/one.git
cd one
```

### Install Dependencies

```bash
npm install
```

## Database Setup

### Using Docker (Recommended)

```bash
# Start PostgreSQL
docker run -d \
  --name postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=agenstra \
  -p 5432:5432 \
  postgres:15
```

### Using Local PostgreSQL

1. Install PostgreSQL
2. Create databases:
   ```sql
   CREATE DATABASE agent_controller;
   CREATE DATABASE agent_manager;
   ```

## Configuration

### Backend Agent Controller

Create `.env` file in `apps/agenstra/backend-agent-controller`:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=agent_controller

# Authentication (choose one)
STATIC_API_KEY=dev-api-key-123
# OR Keycloak
# KEYCLOAK_AUTH_SERVER_URL=http://localhost:8380
# KEYCLOAK_REALM=agenstra
# KEYCLOAK_CLIENT_ID=agent-controller
# KEYCLOAK_CLIENT_SECRET=your-client-secret
# Optional: KEYCLOAK_SERVER_URL if different from auth server URL
# Optional: KEYCLOAK_TOKEN_VALIDATION=ONLINE (default) or OFFLINE

# Ports
PORT=3100
WEBSOCKET_PORT=8081

# CORS (for development)
CORS_ORIGIN=*

# Rate Limiting (disabled for development)
RATE_LIMIT_ENABLED=false
```

### Backend Agent Manager

Create `.env` file in `apps/agenstra/backend-agent-manager`:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=agent_manager

# Authentication
STATIC_API_KEY=dev-api-key-123

# Ports
PORT=3000
WEBSOCKET_PORT=8080

# CORS
CORS_ORIGIN=*

# Rate Limiting (disabled for development)
RATE_LIMIT_ENABLED=false

# Git Repository (optional)
GIT_REPOSITORY_URL=https://github.com/user/repo.git
GIT_USERNAME=your-username
GIT_TOKEN=your-git-token

# Cursor Agent
CURSOR_API_KEY=your-cursor-api-key
```

### Frontend Agent Console

Create `.env` file in `apps/agenstra/frontend-agent-console`:

```bash
API_URL=http://localhost:3100
WEBSOCKET_URL=http://localhost:8081
KEYCLOAK_AUTH_SERVER_URL=http://localhost:8380
KEYCLOAK_REALM=agenstra
KEYCLOAK_CLIENT_ID=agent-manager
```

## Running Applications

### Start Backend Services

```bash
# Terminal 1: Agent Controller
cd apps/agenstra/backend-agent-controller
nx serve agenstra-backend-agent-controller

# Terminal 2: Agent Manager
cd apps/agenstra/backend-agent-manager
nx serve agenstra-backend-agent-manager
```

### Start Frontend

```bash
# Terminal 3: Frontend
cd apps/agenstra/frontend-agent-console
nx serve agenstra-frontend-agent-console
```

## Development Workflow

### Making Changes

1. Make code changes
2. Applications auto-reload (hot reload)
3. Test changes in browser
4. Run tests: `nx test <project-name>`

### Running Tests

```bash
# Run all tests
nx run-many -t test

# Run tests for specific project
nx test backend-agent-controller
nx test backend-agent-manager
nx test frontend-agent-console

# Run tests with coverage
nx test backend-agent-controller --coverage
```

### Building

```bash
# Build all projects
nx run-many -t build

# Build specific project
nx build agenstra-backend-agent-controller
nx build agenstra-backend-agent-manager
nx build agenstra-frontend-agent-console
```

## Docker for Agent Containers

The agent-manager requires Docker for managing agent containers. Ensure Docker is running:

```bash
# Check Docker status
docker ps

# Start Docker (if not running)
# macOS: Open Docker Desktop
# Linux: sudo systemctl start docker
```

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running: `docker ps` or `pg_isready`
- Check database credentials in `.env` files
- Ensure databases exist

### Port Conflicts

- Change ports in `.env` files if conflicts occur
- Check what's using ports: `lsof -i :3100` (macOS/Linux)

### Docker Issues

- Ensure Docker daemon is running
- Check Docker socket permissions: `ls -l /var/run/docker.sock`
- Verify Docker-in-Docker setup for agent-manager

## Related Documentation

- **[Docker Deployment](./docker-deployment.md)** - Containerized deployment
- **[Production Checklist](./production-checklist.md)** - Production deployment
- **[Environment Configuration](./environment-configuration.md)** - Environment variables

---

_For production deployment, see the [Production Checklist](./production-checklist.md)._
