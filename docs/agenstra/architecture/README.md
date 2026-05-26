# Architecture Documentation

This section covers the architectural principles, patterns, and structural decisions that guide the Agenstra system. Understanding these concepts is essential for effectively using and deploying the platform.

## Overview

Agenstra follows a **three-tier distributed architecture** that enables centralized management of multiple remote agent-manager instances. The architecture is built on:

- **Domain-Driven Design (DDD)** principles with clear separation of concerns
- **RESTful HTTP APIs** for synchronous operations
- **WebSocket (Socket.IO)** for real-time bidirectional communication
- **Container-based agent execution** using Docker
- **State management** with NgRx on the frontend

## Documentation Structure

### [System Overview](./system-overview.md)

High-level architecture and component relationships:

- Three-tier architecture (Frontend → Controller → Manager)
- Component interactions
- Communication patterns
- Visual architecture diagrams

### [Components](./components.md)

Detailed breakdown of all system components:

- Backend applications
- Frontend applications
- Library components
- Dependencies and relationships

### [Data Flow](./data-flow.md)

Communication patterns and data flow:

- HTTP REST API flows
- WebSocket event flows
- Authentication flows
- State management (NgRx)

## Key Architectural Concepts

### Three-Tier Architecture

Agenstra uses a three-tier architecture:

1. **Frontend Tier** - Angular application with NgRx state management
2. **Controller Tier** - Centralized control plane for managing multiple agent-manager instances
3. **Manager Tier** - Agent lifecycle management and container execution

### Communication Patterns

- **HTTP REST API** - Synchronous operations (CRUD, file operations, Git operations)
- **WebSocket (Socket.IO)** - Real-time bidirectional communication (chat, events, logs)
- **Event Forwarding** - Controller forwards events between frontend and manager

### Authentication & Authorization

- **HTTP Endpoints** - Keycloak OAuth2 or API key authentication
- **WebSocket** - Database-backed authentication (agents) or client context (controller)
- **Token Caching** - OAuth2 tokens are cached for efficiency

### State Management

- **Frontend** - NgRx (Actions, Reducers, Effects, Selectors, Facades)
- **Backend** - In-memory state for WebSocket sessions and token caching
- **Database** - PostgreSQL for persistent data (clients, agents, credentials)

## Related Documentation

### Getting Started

- **[Getting Started](../getting-started.md)** - Set up your environment

### Features

- **[Client Management](../features/client-management.md)** - Client architecture and operations
- **[Agent Management](../features/agent-management.md)** - Agent lifecycle and architecture
- **[WebSocket Communication](../features/websocket-communication.md)** - Real-time communication patterns

### Deployment

- **[Local Development](../deployment/local-development.md)** - Local architecture setup
- **[Docker Deployment](../deployment/docker-deployment.md)** - Containerized architecture
- **[Production Checklist](../deployment/production-checklist.md)** - Production architecture considerations

## Architecture Principles

### Scalability

- **Distributed Architecture** - Multiple agent-manager instances can be managed from a single controller
- **Horizontal Scaling** - Agent-managers can be scaled independently
- **Stateless Design** - Frontend and controller are stateless (state in database)

### Maintainability

- **Clear Separation** - Each tier has distinct responsibilities
- **Modular Design** - Libraries can be used independently
- **Consistent Patterns** - Same patterns across all components

### Security

- **Authentication** - Multiple authentication methods (Keycloak, API key)
- **Authorization** - Role-based access control
- **Secure Communication** - HTTPS and WSS in production
- **Credential Management** - Secure storage and encryption

See **[Security documentation](../security/README.md)** for the **[threat model](../security/threat-model.md)**, **[risk profile](../security/risk-profile.md)**, accepted-risk register, CRA- and BSI-oriented transparency notes, and operational controls.

### Reliability

- **Reconnection Handling** - Automatic reconnection with state restoration
- **Error Handling** - Comprehensive error handling and recovery
- **Health Monitoring** - Container health checks and monitoring

---

_For detailed implementation information, see the [application documentation](../applications/backend-agent-controller.md) and feature docs linked above._
