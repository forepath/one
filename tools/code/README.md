# @forepath/code

Nx generators for scaffolding applications and libraries in the monorepo. Generators follow the workspace's scope and domain conventions (frontend, backend, keycloak-theme, shared) and produce projects that align with the framework guidelines.

## Generators

Run any generator with `nx generate @forepath/code:GENERATOR_NAME [options]`. All generators are interactive when options are omitted.

### backend

Creates a new NestJS backend application.

- **name** (required) – Application name
- **protected** (default: `true`) – Enable authenticated routes

```bash
nx generate @forepath/code:backend my-api
nx generate @forepath/code:backend my-api --protected=false
```

### frontend

Creates a new Angular frontend application.

- **name** (required) – Application name
- **prefix** (default: `app`) – Component/selector prefix
- **ui** (default: `bootstrap`) – UI stack: `bootstrap` or `none`
- **protected** (default: `true`) – Enable authenticated routes
- **localization** (default: `true`) – Enable i18n
- **ssr** (default: `true`) – Enable server-side rendering

```bash
nx generate @forepath/code:frontend portal --prefix=app --ui=bootstrap
nx generate @forepath/code:frontend portal --ui=none --no-ssr
```

### keycloak-theme

Creates a new Keycloakify-based Keycloak theme (Angular).

- **name** (required) – Theme/application name
- **prefix** (default: `app`) – Component prefix

```bash
nx generate @forepath/code:keycloak-theme my-theme
```

### domain

Creates a new domain with placeholder index files for backend, frontend, keycloak, and shared.

- **name** (required) – Domain name
- **prefix** (default: `@domain`) – Import/package prefix

```bash
nx generate @forepath/code:domain payments --prefix=@domain
```

### lib

Creates a new domain library (feature, data-access, ui, or util) under a given domain and scope.

- **domain** (required) – Domain name
- **scope** (required) – `frontend`, `backend`, `keycloak`, or `shared`
- **type** (required) – `data-access`, `feature`, `ui`, or `util`
- **name** (required) – Library name
- **generator** (required) – Base Nx generator: `js`, `node`, or `angular`

```bash
nx generate @forepath/code:lib --domain=payments --scope=frontend --type=feature --name=checkout --generator=angular
```

### mcp

Creates a new MCP (Model Context Protocol) server project.

- **name** (required) – Server/project name
- **protected** (default: `true`) – Enable authenticated routes

```bash
nx generate @forepath/code:mcp my-mcp-server
```

### init

Initializes the repository for use with AI agents (e.g. adds or configures agent-related structure). No options.

```bash
nx generate @forepath/code:init
```

## Building and testing

- `nx build code` – build the library
- `nx test code` – run unit tests

## Exports

This package exposes **Nx generators only**; there is no programmatic API. Use `nx generate @forepath/code:...` as shown above.
