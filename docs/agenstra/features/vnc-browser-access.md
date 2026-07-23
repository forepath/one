# VNC Browser Access

VNC (Virtual Network Computing) browser access enables you to interact with a Chromium browser running in a virtual workspace container associated with an agent. The full XFCE4 desktop is available through a web-based noVNC client when **Create Virtual Workspace (VNC)** is enabled.

For **browser-only** control without exposing the full desktop, see **[Browser Preview](./browser-preview.md)**. Preview can be enabled without publishing noVNC; enabling full VNC always enables Preview as well.

## Overview

When an agent is created with VNC support, the system automatically:

- Creates a VNC container with XFCE4 desktop environment
- Installs and configures Chromium browser
- Sets up TigerVNC server for remote desktop access
- Configures websockify to bridge VNC to WebSocket for noVNC
- Creates a Docker network connecting the VNC container and agent container
- Generates a secure, encrypted VNC password

The VNC container provides:

- **XFCE4 Desktop Environment** - Lightweight, full-featured desktop
- **Chromium Browser** - Pre-configured and auto-started on session login
- **Secure VNC Access** - Password-protected VNC authentication
- **HTTPS noVNC Client** - Web-based VNC client accessible via browser
- **Network Isolation** - Dedicated Docker network for VNC and agent containers

## Architecture

The VNC feature uses a multi-container architecture:

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Container                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Cursor Agent Process                             │  │
│  │  - Chat Interface                                 │  │
│  │  - File Operations                                │  │
│  │  - Git Operations                                 │  │
│  └───────────────────────────────────────────────────┘  │
│  Volume: /opt/agents/{uuid} → /app (cursor/opencode)     │
│  RO: /opt/agents → /opt/workspace                        │
└──────────────────────┬──────────────────────────────────┘
                        │
                        │ Docker Network
                        │ (Shared Network)
                        │
┌───────────────────────▼──────────────────────────────────┐
│                  VNC Container                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │  TigerVNC Server (:1)                             │  │
│  │  Port: 5901 (internal)                            │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  websockify                                       │  │
│  │  Port: 6080 (exposed)                            │  │
│  │  - Bridges VNC to WebSocket                      │  │
│  │  - Serves noVNC client                           │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  XFCE4 Desktop Environment                       │  │
│  │  - Chromium Browser (auto-started)               │  │
│  │  - File Manager                                  │  │
│  │  - Terminal                                      │  │
│  └───────────────────────────────────────────────────┘  │
│  Volume: /opt/agents/{uuid} → /home/agenstra/environment     │
│  RO: /opt/agents → /opt/workspace                        │
└──────────────────────────────────────────────────────────┘
```

## VNC Container Lifecycle

### Creation

When an agent is created with VNC support:

1. **VNC Container Creation**
   - Docker image: `ghcr.io/forepath/agenstra-manager-vnc:latest`
   - Container name: `{agent-name}-virtual-workspace`
   - Environment variables: VNC password, agent name, Git credentials
   - Port mapping: Random host port → Container port 6080
   - Volume mount: Shared agent data at **`/home/agenstra/environment`** (same host path as the worker’s `/app` mount); read-only **`/opt/agents` → `/opt/workspace`**
   - Runtime **`VNC_PASSWORD`** required (no default in the image); container runs as **`agenstra`** (UID **10001**)

2. **Network Setup**
   - Creates a dedicated Docker network
   - Connects both agent container and VNC container
   - Enables communication between containers

3. **Password Generation**
   - Generates a secure random password
   - Encrypts password using AES-256-GCM
   - Stores encrypted password in database

4. **Database Storage**
   - Stores VNC container ID
   - Stores VNC host port
   - Stores VNC network ID
   - Stores encrypted VNC password

### Access

To access the VNC session:

1. **Get Agent Details**
   - Retrieve agent information including VNC host port
   - Decrypt VNC password (handled automatically by the system)

2. **Connect via noVNC**
   - Navigate to `https://{agent-manager-host}:{vnc-host-port}/vnc.html`
   - Enter VNC password when prompted
   - Access the XFCE4 desktop with Chromium browser

3. **Browser Interaction**
   - Chromium browser is automatically started on session login
   - Browser is configured as the default web browser
   - Browser runs with `--no-sandbox` and `--disable-dev-shm-usage` flags

### Deletion

When an agent is deleted:

1. **Network Cleanup**
   - Disconnects all containers from the VNC network
   - Removes the Docker network

2. **Container Cleanup**
   - Stops and removes the VNC container
   - Stops and removes the agent container

3. **Database Cleanup**
   - Removes agent entity (including VNC-related fields)
   - Encrypted VNC password is automatically deleted

## Configuration

### Environment Variables

The VNC feature is controlled by the following environment variables:

**Agent Manager Configuration:**

- `VNC_SERVER_PUBLIC_PORTS` - Port range for VNC host port allocation (e.g., `"6080-6180"`)
- `VNC_SERVER_DOCKER_IMAGE` - Docker image for VNC containers (default: `ghcr.io/forepath/agenstra-manager-vnc:latest`)

**VNC Container Configuration:**

- `VNC_PASSWORD` - VNC authentication password (auto-generated if not set)
- `VNC_DISPLAY` - VNC display number (default: `:1`)
- `VNC_RESOLUTION` - Desktop resolution (default: `1920x1080`)
- `VNC_DEPTH` - Color depth (default: `24`)
- `CHROMIUM_FLAGS` - Chromium browser flags (default: `--no-sandbox --disable-dev-shm-usage`)

### Port Allocation

VNC host ports are automatically allocated from the configured port range. The system:

- Generates a random port from the specified range
- Ensures port availability before allocation
- Maps the host port to container port 6080 (noVNC/websockify)

### Security

**VNC Authentication:**

- VNC passwords are generated using cryptographically secure random number generation
- Passwords are encrypted at rest using AES-256-GCM encryption
- Passwords are transmitted securely via HTTPS when accessing noVNC

**Network Isolation:**

- VNC and agent containers are isolated in a dedicated Docker network
- Containers can communicate with each other but are isolated from other containers
- Network is automatically cleaned up when the agent is deleted

**HTTPS Access:**

- noVNC client is served over HTTPS using self-signed certificates
- Certificates are generated during container build
- For production, consider using proper SSL certificates

## Usage

### Creating an Agent with VNC

When creating an agent, VNC support is automatically enabled if:

- `VNC_SERVER_DOCKER_IMAGE` environment variable is set
- The Docker image is available and accessible

The agent creation process will:

1. Create the agent container
2. Create the VNC container
3. Create the Docker network
4. Connect both containers to the network
5. Return agent details including VNC host port

**Example API Request:**

```http
POST /api/agents
Content-Type: application/json

{
  "name": "my-agent",
  "description": "Agent with VNC support",
  "agentType": "cursor"
}
```

**Example Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "my-agent",
  "description": "Agent with VNC support",
  "agentType": "cursor",
  "containerId": "abc123...",
  "vncContainerId": "def456...",
  "vncHostPort": 6123,
  "vncNetworkId": "ghi789...",
  "password": "agent-websocket-password",
  "createdAt": "2025-01-15T10:30:00Z"
}
```

### Accessing the VNC Session

1. **Get the VNC Host Port**

   Retrieve the agent details to get the VNC host port:

   ```http
   GET /api/agents/{agentId}
   ```

2. **Access noVNC Client**

   Navigate to the noVNC client:

   ```
   https://{agent-manager-host}:{vnc-host-port}/vnc.html
   ```

   For example:

   ```
   https://agent-manager.example.com:6123/vnc.html
   ```

3. **Enter VNC Password**

   When prompted, enter the VNC password. The password can be retrieved from the agent details (decrypted automatically by the API).

### Browser Features

The Chromium browser in the VNC container:

- **Auto-start**: Automatically launches when the VNC session is established
- **Default Browser**: Configured as the default web browser in XFCE4
- **Sandbox Disabled**: Runs with `--no-sandbox` flag for container compatibility
- **Shared Workspace**: Has access to the same workspace volume as the agent container

## Troubleshooting

### VNC Container Not Starting

**Symptoms:**

- Agent is created but VNC container is not accessible
- VNC host port is not assigned

**Solutions:**

1. **Check Docker Image Availability**
   - Ensure `VNC_SERVER_DOCKER_IMAGE` is set correctly
   - Verify the Docker image is available and accessible
   - Check Docker image pull permissions

2. **Check Port Range**
   - Verify `VNC_SERVER_PUBLIC_PORTS` is set correctly
   - Ensure the port range is available on the host
   - Check for port conflicts

3. **Check Container Logs**
   - Inspect VNC container logs: `docker logs {vnc-container-id}`
   - Look for startup errors or configuration issues

### Cannot Connect to VNC

**Symptoms:**

- noVNC client loads but cannot connect
- Connection timeout or authentication failure

**Solutions:**

1. **Verify Host Port**
   - Check that the VNC host port is correctly mapped
   - Verify the port is accessible from your network
   - Check firewall rules

2. **Verify VNC Password**
   - Ensure you're using the correct VNC password
   - Check that password decryption is working
   - Verify the password hasn't been changed

3. **Check Container Status**
   - Verify the VNC container is running: `docker ps | grep vnc`
   - Check container health and resource usage
   - Inspect container logs for errors

### Chromium Not Starting

**Symptoms:**

- VNC session connects but Chromium doesn't appear
- Desktop is visible but browser is missing

**Solutions:**

1. **Check XFCE4 Session**
   - Verify XFCE4 desktop environment is running
   - Check XFCE4 logs for errors
   - Ensure autostart entries are configured

2. **Check Chromium Configuration**
   - Verify Chromium desktop entry exists
   - Check autostart configuration
   - Inspect Chromium startup logs

3. **Check Display Configuration**
   - Verify `CHROMIUM_DISPLAY` matches `VNC_DISPLAY`
   - Check X11 display configuration
   - Ensure display server is running

## Related Documentation

- **[Agent Management](./agent-management.md)** - Agent lifecycle and management
- **[Backend Agent Manager Application](../applications/backend-agent-manager.md)** - Application details

---

_For detailed technical specifications, see the application and feature docs linked below._
