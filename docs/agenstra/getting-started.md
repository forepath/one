# Getting Started with Agenstra

This guide will help you set up Agenstra and create your first client and agent.

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 24.14.1 or higher
- **PostgreSQL** database (for backend applications)
- **Docker** and **Docker Compose** (for containerized deployment)
- **Keycloak** server (optional, for authentication - can use API key authentication instead)
- **Git** repository (optional, for agent workspace)

## Installation

### Option 1: Docker Compose (Recommended)

The easiest way to get started is using Docker Compose:

```bash
# Clone the repository (if not already done)
git clone https://github.com/forepath/one.git
cd one

# Start all services
cd apps/agenstra/backend-agent-controller
docker compose up -d

# In another terminal, start agent-manager
cd apps/agenstra/backend-agent-manager
docker compose up -d

# In another terminal, start frontend
cd apps/agenstra/frontend-agent-console
docker compose up -d
```

### Option 2: Local Development

For local development:

```bash
# Install dependencies
npm install

# Start agent-controller
nx serve agenstra-backend-agent-controller

# In another terminal, start agent-manager
nx serve agenstra-backend-agent-manager

# In another terminal, start frontend
nx serve agenstra-frontend-agent-console
```

## Configuration

### Backend Agent Controller

Configure the agent-controller by setting environment variables:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=agent_controller

# Authentication (choose one)
AUTHENTICATION_METHOD=users

# Option 1: API Key authentication
STATIC_API_KEY=your-secure-api-key-here

# Option 2: Keycloak authentication
KEYCLOAK_AUTH_SERVER_URL=http://localhost:8380
KEYCLOAK_REALM=agenstra
KEYCLOAK_CLIENT_ID=agent-controller
KEYCLOAK_CLIENT_SECRET=your-client-secret
# Optional: KEYCLOAK_SERVER_URL if different from auth server URL
# Optional: KEYCLOAK_TOKEN_VALIDATION=ONLINE (default) or OFFLINE

# Option 3: Users authentication
JWT_SECRET=your-jwt-secret-key
DISABLE_SIGNUP=false  # Set to true to disable self-registration

# Ports
PORT=3100
WEBSOCKET_PORT=8081

# CORS (for production)
CORS_ORIGIN=https://your-frontend-domain.com

# Rate Limiting (optional)
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL=60
RATE_LIMIT_LIMIT=100
```

### Backend Agent Manager

Configure the agent-manager:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=agent_manager

# Authentication
STATIC_API_KEY=your-secure-api-key-here
# OR Keycloak configuration (same as above)

# Ports
PORT=3000
WEBSOCKET_PORT=8080

# Git Repository (for agent workspace)
GIT_REPOSITORY_URL=https://github.com/user/repo.git
GIT_USERNAME=your-username
GIT_TOKEN=your-git-token

# Cursor Agent
CURSOR_API_KEY=your-cursor-api-key
CURSOR_AGENT_DOCKER_IMAGE=ghcr.io/forepath/agenstra-manager-worker:latest

# CORS
CORS_ORIGIN=http://localhost:4200
```

### Frontend Agent Console

Configure the frontend:

```bash
# API Endpoint
API_URL=http://localhost:3100

# WebSocket Endpoint
WEBSOCKET_URL=http://localhost:8081
```

## Creating Your First Client

A client represents a connection to a remote agent-manager service. You can either:

1. **Connect to an existing agent-manager** - If you already have an agent-manager running
2. **Provision a new server** - Automatically provision a cloud server with agent-manager

### Connect to Existing Agent-Manager

1. Open the frontend console at `http://localhost:4200`
2. Log in (if using Keycloak) or use API key authentication
3. Navigate to the Clients section
4. Click "Add Client"
5. Fill in the client details:
   - **Name**: A descriptive name for this client
   - **Endpoint**: The HTTP API endpoint of your agent-manager (e.g., `http://localhost:3000`)
   - **Authentication Type**: Choose `api_key` or `keycloak`
   - **API Key** (if using API key): The API key for authentication
   - **Keycloak Configuration** (if using Keycloak): Client ID, secret, realm, and auth server URL
6. Click "Create"

### Provision a New Server

1. Navigate to the Clients section
2. Click "Provision Server"
3. Select a provider (Hetzner Cloud or DigitalOcean)
4. Configure server settings:
   - **Server Type**: Choose a server size
   - **Location**: Select a datacenter location
   - **Name**: Server name (auto-generated if not provided)
   - **Authentication**: Configure authentication for the agent-manager
   - **Git Repository**: Optional Git repository URL for agent workspace
   - **Cursor API Key**: Your Cursor API key for agent configuration
5. Click "Provision"

The system will:

- Create a cloud server instance
- Install Docker automatically
- Deploy PostgreSQL and agent-manager containers
- Create a client entity in the database
- Return server information and client details

## Creating Your First Agent

Once you have a client, you can create agents:

1. Select a client from the clients list
2. Click "Add Agent"
3. Fill in agent details:
   - **Name**: A descriptive name for the agent
   - **Description**: Optional description
   - **Agent Type**: Choose an agent type (e.g., `cursor`)
4. Click "Create"

The system will:

- Create the agent in the remote agent-manager
- Generate a secure password
- Store credentials for automatic login
- Return the agent details including the password

**Important**: Save the password! You'll need it to authenticate with the agent via WebSocket.

## Connecting to an Agent

To interact with an agent:

1. Select a client from the clients list
2. Select an agent from the agents list
3. The system will automatically:
   - Connect to the agent-controller WebSocket
   - Set the client context
   - Log in to the agent using stored credentials
   - Restore chat history (if any)

You're now ready to:

- **Chat with the agent** - Send messages and receive responses
- **Edit files** - Use the integrated Monaco Editor to edit files in the agent container
- **Manage Git** - View status, branches, commit, push, and pull
- **View logs** - Monitor container logs in real-time

## Quick Tour of Features

### Chat Interface

- Send messages to the agent
- View chat history
- See agent responses in real-time
- Chat history is automatically restored on reconnection

### File Editor

- Browse the file system in the agent container
- Read and edit files with Monaco Editor
- Create, delete, and move files and directories
- Syntax highlighting and code completion

### Version Control

- View git status and current branch
- List all branches (local and remote)
- Stage and unstage files
- Commit changes with messages
- Push and pull from remote
- Rebase and switch branches
- Resolve merge conflicts

### Container Management

- View container statistics (CPU, memory, network)
- Monitor container logs
- See container health status

### Tickets and usage statistics

- Open **Tickets** from the navigation (`/tickets`) after selecting a workspace to manage tickets, automation, and migration between clients ([Tickets and Workspaces](./features/tickets-and-workspaces.md))
- Use workspace-level **usage statistics** in the console where exposed to review chat volume and filter metrics ([Usage Statistics](./features/usage-statistics.md)); these differ from live **container** stats in the chat view
- **Global administrators** can open **Filters** (`/filters`) for message filter rules and **Import** (`/imports/atlassian`) for Atlassian site connections and Jira/Confluence import configurations ([Atlassian import](./features/atlassian-import.md))

## Next Steps

Now that you have Agenstra set up:

1. **[Architecture Overview](./architecture/system-overview.md)** - Understand how the system works
2. **[Client Management](./features/client-management.md)** - Learn about managing clients
3. **[Agent Management](./features/agent-management.md)** - Deep dive into agent lifecycle
4. **[WebSocket Communication](./features/websocket-communication.md)** - Understand real-time communication
5. **[Tickets and Workspaces](./features/tickets-and-workspaces.md)** - Ticket board and automation
6. **[Deployment Guide](./deployment/production-checklist.md)** - Prepare for production

## Troubleshooting

If you encounter issues:

1. Check the [Common Issues](./troubleshooting/common-issues.md) guide
2. Review the [Debugging Guide](./troubleshooting/debugging-guide.md)
3. Verify your environment configuration matches the [Environment Configuration](./deployment/environment-configuration.md) reference

## Additional Resources

- **[API Reference](./api-reference/README.md)** - Complete OpenAPI and AsyncAPI specifications

---

_For detailed information about specific features, see the [Features Documentation](./features/README.md)._
