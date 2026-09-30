# System Overview

This document provides a high-level overview of the Agenstra system architecture, component relationships, and communication patterns.

## Three-Tier Architecture

Agenstra follows a three-tier distributed architecture:

```mermaid
graph TB
    subgraph "Frontend Tier"
        FE[Frontend Agent Console<br/>Angular + NgRx]
    end

    subgraph "Controller Tier"
        AC[Agent Controller<br/>NestJS Backend]
    end

    subgraph "Manager Tier"
        AM1[Agent Manager 1<br/>NestJS Backend]
        AM2[Agent Manager 2<br/>NestJS Backend]
        AM3[Agent Manager N<br/>NestJS Backend]
    end

    FE -->|HTTP REST API<br/>WebSocket| AC
    AC -->|HTTP REST API<br/>WebSocket| AM1
    AC -->|HTTP REST API<br/>WebSocket| AM2
    AC -->|HTTP REST API<br/>WebSocket| AM3
```

### Tier Responsibilities

#### Frontend Tier

- **User Interface** Web-based IDE with Monaco Editor
- **State Management** NgRx for application state
- **Real-time Communication** WebSocket client for chat and events
- **File Management** File system operations UI
- **Version Control** Git operations UI

#### Controller Tier

- **Client Management** CRUD operations for clients (remote agent-manager instances)
- **Event Forwarding** Forward WebSocket events between frontend and managers
- **Authentication** Keycloak or API key authentication
- **Credential Management** Store and manage agent credentials
- **Server Provisioning** Automated cloud server provisioning

#### Manager Tier

- **Agent Management** CRUD operations for agents
- **Container Management** Docker container lifecycle
- **WebSocket Gateway** Real-time communication with agents
- **File Operations** File system operations in containers
- **Version Control** Git operations in containers

## Component Relationships

```mermaid
graph LR
    subgraph "Frontend"
        UI[UI Components]
        State[NgRx State]
        WS[WebSocket Client]
    end

    subgraph "Agent Controller"
        CC[Clients Controller]
        CS[Clients Service]
        CG[Clients Gateway]
        PS[Provisioning Service]
    end

    subgraph "Agent Manager"
        AC[Agents Controller]
        AS[Agents Service]
        AG[Agents Gateway]
        DS[Docker Service]
    end

    UI --> State
    State --> WS
    WS --> CG
    CG --> CS
    CS --> CC
    CC --> AC
    CS --> AS
    AS --> AG
    AG --> DS
```

## Communication Patterns

### HTTP REST API Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant DB as Database

    F->>AC: HTTP Request (with auth)
    AC->>DB: Query/Update
    AC->>AM: Proxied HTTP Request
    AM->>DB: Query/Update
    AM-->>AC: Response
    AC-->>F: Response
```

In addition to the **`clients`** namespace used to proxy chat and tooling to each workspace’s agent-manager, the agent controller exposes a **`tickets`** Socket.IO namespace on the same port for ticket board and automation realtime. See [WebSocket Communication](../features/websocket-communication.md) and [Tickets and Workspaces](../features/tickets-and-workspaces.md).

### WebSocket Event Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant A as Agent Container

    F->>AC: WebSocket Connect
    AC->>F: Connected
    F->>AC: setClient (clientId)
    AC->>AM: WebSocket Connect
    AM->>AC: Connected
    F->>AC: forward (login event)
    AC->>AM: forward (login event)
    AM->>A: Authenticate
    A-->>AM: Authenticated
    AM-->>AC: chatMessage
    AC-->>F: chatMessage
    F->>AC: forward (chat event)
    AC->>AM: forward (chat event)
    AM->>A: Send message
    A-->>AM: Response
    AM-->>AC: chatMessage
    AC-->>F: chatMessage
```

## Data Flow

### Client Creation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant DB as Database

    U->>F: Create Client
    F->>AC: POST /api/clients
    AC->>DB: Save Client
    AC->>AM: GET /api/config (verify connection)
    AM-->>AC: Config Response
    AC-->>F: Client Created
    F-->>U: Client List Updated
```

### Agent Creation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant DB as Database
    participant D as Docker

    U->>F: Create Agent
    F->>AC: POST /api/clients/:id/agents
    AC->>AM: POST /api/agents (proxied)
    AM->>DB: Save Agent
    AM->>D: Create Container
    D-->>AM: Container Created
    AM-->>AC: Agent Created (with password)
    AC->>DB: Save Credentials
    AC-->>F: Agent Created
    F-->>U: Agent List Updated
```

## Authentication Flow

### HTTP Authentication

```mermaid
sequenceDiagram
    participant C as Client
    participant AC as Agent Controller
    participant K as Keycloak

    C->>AC: HTTP Request
    AC->>K: Validate Token
    K-->>AC: Valid/Invalid
    alt Valid Token
        AC-->>C: Response
    else Invalid Token
        AC-->>C: 401 Unauthorized
    end
```

### WebSocket Authentication (Agent)

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller
    participant AM as Agent Manager
    participant DB as Database

    F->>AC: WebSocket Connect
    AC->>F: Connected
    F->>AC: setClient (clientId)
    F->>AC: forward (login, agentId)
    AC->>DB: Load Credentials
    DB-->>AC: Credentials
    AC->>AM: forward (login, credentials)
    AM->>DB: Validate Credentials
    DB-->>AM: Valid
    AM-->>AC: loginSuccess
    AC-->>F: loginSuccess
```

## State Management

### Frontend State (NgRx)

```mermaid
graph TB
    subgraph "NgRx Store"
        Clients[clients state]
        Agents[agents state]
        ContainerSocket[containerSocket state]
        ChatTimeline[chatTimeline state]
        Terminals[terminals state]
        Files[files state]
        VCS[vcs state]
        Auth[authentication state]
    end

    subgraph "Components"
        Chat[Chat Component]
        Editor[Editor Component]
        List[Client/Agent List]
    end

    subgraph "Effects"
        Load[Load Effects]
        Socket[Socket Effects]
        File[File Effects]
    end

    Chat --> Clients
    Chat --> Agents
    Chat --> ContainerSocket
    Chat --> ChatTimeline
    Editor --> Files
    Editor --> Terminals
    Editor --> VCS
    List --> Clients
    List --> Agents
    Load --> Clients
    Load --> Agents
    Socket --> ContainerSocket
    File --> Files
```

## Reconnection Handling

### Frontend Reconnection

```mermaid
sequenceDiagram
    participant F as Frontend
    participant AC as Agent Controller

    F->>AC: WebSocket Disconnect
    F->>AC: Reconnect
    AC->>F: Connected
    F->>AC: setClient (clientId)
    AC->>F: Client Context Restored
    F->>AC: forward (login, agentId)
    AC->>F: Chat History Restored
```

### Controller-to-Manager Reconnection

```mermaid
sequenceDiagram
    participant AC as Agent Controller
    participant AM as Agent Manager

    AC->>AM: WebSocket Disconnect
    AC->>AM: Reconnect
    AM->>AC: Connected
    AC->>AM: Auto-login (all logged-in agents)
    AM-->>AC: Login Success
    AM-->>AC: Chat History (for each agent)
```

## Related documentation

- **[Components](./components.md)** Detailed component breakdown
- **[Data Flow](./data-flow.md)** Detailed data flow patterns

---

_For implementation details, see the [application documentation](../applications/backend-agent-controller.md) below._
