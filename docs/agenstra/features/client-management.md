# Client Management

Client management enables you to connect to and manage multiple remote agent-manager instances from a single console.

## Overview

A client represents a connection to a remote agent-manager service. You can either:

1. **Connect to an existing agent-manager** If you already have an agent-manager running
2. **Provision a new server** Automatically provision a cloud server with agent-manager deployment

When using keycloak or users authentication, Agenstra supports **per-client permissions** to enable multi-tenant scenarios. Each client has a creator and can have multiple associated users with different roles.

## Creating a Client

### Connect to Existing Agent-Manager

1. Navigate to the Clients section in the frontend
2. Click "Add Client"
3. Fill in the client details:
   - **Name**: A descriptive name for this client
   - **Endpoint**: The HTTP API endpoint of your agent-manager (e.g., `http://localhost:3000`)
   - **Authentication Type**: Choose `api_key` or `keycloak`
   - **API Key** (if using API key): The API key for authentication
   - **Keycloak Configuration** (if using Keycloak): Client ID, secret, realm, and auth server URL
   - **Agent WebSocket Port**: Port for agent WebSocket connections (default: `8080`)
4. Click "Create"

The system will:

- Create the client entity in the database
- Verify the connection to the remote agent-manager
- Fetch and store the client configuration (Git repository URL, available agent types)
- Return the client details including the API key (if API_KEY type)

### Provision a New Server

See the [Server Provisioning](./server-provisioning.md) documentation for details on automated server provisioning.

## Client Configuration

Each client includes a `config` field that is automatically fetched from the remote agent-manager:

- **`gitRepositoryUrl`** The Git repository URL configured on the agent-manager instance
- **`agentTypes`** Array of available agent provider types (e.g., `['opencode']`)

This configuration allows you to discover which agent types are available on each remote agent-manager instance.

## Managing Clients

### View Clients

- List all clients with their status and configuration
- View client details including endpoint and authentication type
- See available agent types for each client

### Update Client

1. Select a client from the list
2. Click "Update Client"
3. Modify the client details
4. Click "Save"

### Delete Client

1. Select a client from the list
2. Click "Delete Client"
3. Confirm deletion

**Note**: Deleting a client also deletes all stored agent credentials for that client.

## Per-Client Permissions

When using **keycloak** or **users** authentication, access to clients is controlled by per-client permissions. In **api-key** mode, users do not play a role and all permission checks are bypassed.

### Access Control Rules

Access to a client is granted if:

- The user is a **global admin** (role `admin` in the users table)
- The user is the **creator** of the client (`user_id` matches)
- The user is in the `client_users` relationship table for that client

### Client Roles

Each user-client relationship has a role:

- **`admin`** Can manage users (add/remove) and has full access to the client
- **`user`** Can access the client but cannot manage users

### Managing Client Users

Users are added to clients by their email address. This applies to keycloak and users authentication; in api-key mode, users do not play a role and these endpoints are not applicable.

**Permissions**:

- Global admins can add any role and remove anyone
- Client creators can add any role and remove anyone
- Client admins can only add users with `user` role and remove users (not other admins)
- Client users cannot add or remove anyone

## Authentication Types

### API Key Authentication

- **Type**: `api_key`
- **Configuration**: API key is auto-generated or provided
- **Usage**: API key is used for all HTTP requests to the agent-manager
- **Storage**: API key is stored securely in the database

### Keycloak Authentication

- **Type**: `keycloak`
- **Configuration**: Keycloak client ID, secret, realm, and auth server URL
- **Usage**: OAuth2 Client Credentials flow with token caching
- **Token Management**: Tokens are automatically cached and refreshed

## API Endpoints

### Client Management

- `GET /api/clients` - List all clients (filtered by user access in keycloak/users mode)
- `GET /api/clients/:id` - Get a single client by UUID
- `POST /api/clients` - Create a new client
- `POST /api/clients/:id` - Update an existing client
- `DELETE /api/clients/:id` - Delete a client

### Client User Management (keycloak/users authentication only)

- `GET /api/clients/:id/users` - List users associated with a client
- `POST /api/clients/:id/users` - Add a user to a client by email
- `DELETE /api/clients/:id/users/:relationshipId` - Remove a user from a client

In api-key mode, users do not play a role; these endpoints are not applicable.

For detailed API documentation, see the application and API reference docs linked below.

## Related documentation

- **[Server Provisioning](./server-provisioning.md)** Automated server provisioning
- **[Agent Management](./agent-management.md)** Managing agents for a client
- **[WebSocket Communication](./websocket-communication.md)** Real-time communication with clients
- **[Backend Agent Controller Application](../applications/backend-agent-controller.md)** Application details

---

_For detailed API specifications, see the application docs linked below._
