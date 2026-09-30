# Data Flow

This document describes the communication patterns and data flow throughout the Agenstra system.

## HTTP REST API Flow

### Client Management Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant DB as Database

    F->>AC: POST /api/clients
    AC->>AC: Validate Request
    AC->>DB: Save Client Entity
    DB-->>AC: Client Saved
    AC->>AC: Generate API Key (if API_KEY type)
    AC-->>F: Client Response (with API key)
    F->>F: Update State (NgRx)
```

### Proxied Agent Creation Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant DB as Database
    participant D as Docker

    F->>AC: POST /api/clients/:id/agents
    AC->>AC: Load Client
    AC->>AC: Get Auth Token (Keycloak/API Key)
    AC->>AM: POST /api/agents (proxied with auth)
    AM->>AM: Validate Request
    AM->>DB: Save Agent Entity
    AM->>AM: Generate Password
    AM->>D: Create Container
    D-->>AM: Container Created
    AM->>DB: Update Agent (containerId)
    AM-->>AC: Agent Response (with password)
    AC->>DB: Save Credentials (encrypted)
    AC-->>F: Agent Response
    F->>F: Update State (NgRx)
```

### File Operation Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant C as Container

    F->>AC: GET /api/clients/:id/agents/:agentId/files/:path
    AC->>AC: Load Client & Credentials
    AC->>AM: GET /api/agents/:agentId/files/:path (proxied)
    AM->>AM: Validate Agent
    AM->>C: Read File
    C-->>AM: File Content
    AM-->>AC: File Response
    AC-->>F: File Response
    F->>F: Update State (NgRx)
```

## WebSocket Event Flow

### Connection and Authentication Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant DB as Database

    F->>AC: WebSocket Connect
    AC->>F: Connected
    F->>AC: setClient (clientId)
    AC->>AC: Store Client Context
    AC->>AM: WebSocket Connect
    AM->>AC: Connected
    F->>AC: forward (login, agentId)
    AC->>DB: Load Credentials
    DB-->>AC: Credentials
    AC->>AM: forward (login, credentials)
    AM->>DB: Validate Credentials
    DB-->>AM: Valid
    AM->>AM: Load Chat History
    AM-->>AC: loginSuccess
    AM-->>AC: chatMessageBatch (history)
    AC-->>F: loginSuccess
    AC-->>F: chatMessageBatch (history)
    F->>F: Update State (NgRx)
```

### Chat Message Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant A as Agent Container

    F->>AC: forward (chat, message)
    AC->>AC: Validate Client Context
    AC->>AM: forward (chat, message)
    AM->>AM: Validate Agent Login
    AM->>A: Send Message (stdin)
    AM->>AM: Save User Message
    A-->>AM: Agent Response
    AM->>AM: Save Agent Response
    AM-->>AC: chatMessage (user)
    AM-->>AC: chatMessage (agent)
    AC-->>F: chatMessage (user)
    AC-->>F: chatMessage (agent)
    F->>F: Update State (NgRx)
```

### Reconnection Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant DB as Database

    Note over F,AM: Disconnection occurs
    F->>AC: Reconnect
    AC->>F: Connected
    F->>AC: setClient (clientId)
    AC->>AC: Restore Client Context
    AC->>AM: Reconnect
    AM->>AC: Connected
    AC->>DB: Load Logged-in Agents
    DB-->>AC: Agent IDs
    loop For each logged-in agent
        AC->>DB: Load Credentials
        DB-->>AC: Credentials
        AC->>AM: forward (login, credentials)
        AM->>AM: Load Chat History
        AM-->>AC: loginSuccess
        AM-->>AC: chatMessageBatch (history)
    end
    AC-->>F: Client Context Restored
    AC-->>F: Chat History Restored
    F->>F: Clear Timeline (prevent duplicates)
    F->>F: Update State (NgRx)
```

## State Management Flow (NgRx)

### Action → Effect → Service → Reducer Flow

```mermaid
graph TB
    A[Component Action] --> B[Effect]
    B --> C[HTTP Service / WebSocket]
    C --> D[Success Action]
    C --> E[Error Action]
    D --> F[Reducer]
    E --> F
    F --> G[Store State]
    G --> H[Selector]
    H --> I[Component]
```

### Example: Loading Clients

```mermaid
sequenceDiagram
    participant C as Component
    participant F as Facade
    participant E as Effect
    participant S as Service
    participant API as API
    participant R as Reducer
    participant Store as Store

    C->>F: loadClients()
    F->>Store: Dispatch loadClients Action
    Store->>E: loadClients$ Effect
    E->>S: getClients()
    S->>API: GET /api/clients
    API-->>S: Clients Response
    S-->>E: Success Action
    E->>Store: Dispatch loadClientsSuccess
    Store->>R: Reducer
    R->>Store: Update State
    Store-->>C: Selector (clients$)
    C->>C: Render Clients
```

## File System Operations Flow

### Reading a File

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant C as Container

    U->>F: Click File
    F->>F: Dispatch readFile Action
    F->>AC: GET /api/clients/:id/agents/:agentId/files/:path
    AC->>AM: GET /api/agents/:agentId/files/:path
    AM->>C: Read File
    C-->>AM: File Content
    AM-->>AC: File Response
    AC-->>F: File Response
    F->>F: Update State (files)
    F->>F: Open in Editor
    U->>U: View File
```

### Writing a File

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant C as Container

    U->>F: Edit File & Save
    F->>F: Dispatch writeFile Action
    F->>AC: PUT /api/clients/:id/agents/:agentId/files/:path
    AC->>AM: PUT /api/agents/:agentId/files/:path
    AM->>C: Write File
    C-->>AM: Success
    AM->>AM: Notify Other Clients (fileUpdate event)
    AM-->>AC: File Response
    AC-->>F: File Response
    F->>F: Update State (files)
    F->>F: Show Success
    U->>U: File Saved
```

## Version Control Operations Flow

### Git Status Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant C as Container

    U->>F: View Git Status
    F->>F: Dispatch loadGitStatus Action
    F->>AC: GET /api/clients/:id/agents/:agentId/vcs/status
    AC->>AM: GET /api/agents/:agentId/vcs/status
    AM->>C: git status
    C-->>AM: Status Output
    AM->>AM: Parse Status
    AM-->>AC: Status Response
    AC-->>F: Status Response
    F->>F: Update State (vcs)
    F->>F: Display Status
    U->>U: View Status
```

### Commit Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant C as Container

    U->>F: Commit Changes
    F->>F: Dispatch commit Action
    F->>AC: POST /api/clients/:id/agents/:agentId/vcs/commit
    AC->>AM: POST /api/agents/:agentId/vcs/commit
    AM->>C: git commit -m "message"
    C-->>AM: Commit Output
    AM->>AM: Parse Commit
    AM-->>AC: Commit Response
    AC-->>F: Commit Response
    F->>F: Update State (vcs)
    F->>F: Refresh Status
    U->>U: Changes Committed
```

## Server Provisioning Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant AC as Agent Controller
    participant P as Cloud Provider
    participant S as Server
    participant AM as Agent Manager

    U->>F: Provision Server
    F->>AC: POST /api/clients/provisioning/provision
    AC->>P: Create Server
    P->>S: Provision Server
    S->>S: Install Docker (cloud-init)
    S->>S: Start PostgreSQL Container
    S->>S: Start Agent-Manager Container
    S-->>P: Server Ready
    P-->>AC: Server Info
    AC->>AC: Create Client Entity
    AC->>AC: Create Provisioning Reference
    AC-->>F: Client Created
    F->>F: Update State (clients)
    U->>U: Server Provisioned
```

## Related documentation

- **[System Overview](./system-overview.md)** High-level architecture
- **[Components](./components.md)** Component breakdown
- **[WebSocket Communication](../features/websocket-communication.md)** Real-time communication details
- **[Client Management](../features/client-management.md)** Client operations
- **[Agent Management](../features/agent-management.md)** Agent operations

---

_For implementation details, see the application and feature docs linked in this section._
