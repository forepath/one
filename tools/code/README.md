# @forepath/code

Nx generators for scaffolding applications and libraries in the monorepo. Generators follow the workspace domain conventions and place applications under `apps/<domain>/` with Nx project names such as `agenstra-backend-agent-manager` or `forepath-frontend-landingpage`.

## Generators

Run any generator with `nx generate @forepath/code:GENERATOR_NAME [options]`. All generators are interactive when options are omitted.

Application generators accept a **domain** option (for example `agenstra`, `forepath`, or `shared`). The domain selects the folder under `apps/` and the Nx project name prefix. Create new domains first with the `domain` generator when needed.

### backend

Creates a new NestJS backend application at `apps/<domain>/backend-<name>`.

- **name** (required) – Application name without the `backend-` prefix
- **domain** (default: `agenstra`) – Product domain folder and Nx project prefix
- **protected** (default: `true`) – Enable authenticated routes

```bash
nx generate @forepath/code:backend agent-manager --domain=agenstra
nx generate @forepath/code:backend billing-api --domain=forepath --protected=false
```

### frontend

Creates a new Angular frontend application at `apps/<domain>/frontend-<name>`.

- **name** (required) – Application name without the `frontend-` prefix
- **domain** (default: `agenstra`) – Product domain folder and Nx project prefix
- **prefix** (default: `app`) – Component/selector prefix
- **ui** (default: `bootstrap`) – UI stack: `bootstrap` or `none`
- **protected** (default: `true`) – Enable authenticated routes
- **localization** (default: `true`) – Enable i18n
- **ssr** (default: `true`) – Enable server-side rendering

```bash
nx generate @forepath/code:frontend landingpage --domain=forepath --prefix=app --ui=bootstrap
nx generate @forepath/code:frontend portal --domain=agenstra --ui=none --no-ssr
```

### native

Creates a new Electron desktop application at `apps/<domain>/native-<name>` that bundles an existing domain frontend SSR server.

- **name** (required) – Application name without the `native-` prefix
- **domain** (default: `agenstra`) – Product domain folder and Nx project prefix
- **frontendProject** (optional) – Frontend Nx project to bundle (defaults to `<domain>-frontend-<name>`)
- **title** (optional) – Desktop window title

```bash
nx generate @forepath/code:native agent-console --domain=agenstra
nx generate @forepath/code:native agent-console --domain=agenstra --frontendProject=agenstra-frontend-agent-console
```

### keycloak-theme

Creates a new Keycloakify-based Keycloak theme (Angular) at `apps/<domain>/keycloak-theme-<name>`.

- **name** (required) – Theme/application name
- **domain** (default: `shared`) – Product domain folder and Nx project prefix
- **prefix** (default: `app`) – Component prefix

```bash
nx generate @forepath/code:keycloak-theme platform --domain=shared
```

### domain

Creates a new domain with placeholder index files for backend, frontend, keycloak, and shared.

- **name** (required) – Domain name
- **prefix** (default: `@domain`) – Import/package prefix

```bash
nx generate @forepath/code:domain payments --prefix=@forepath
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

Creates a new MCP (Model Context Protocol) server project at `apps/<domain>/mcp-<name>`.

- **name** (required) – Server/project name
- **domain** (default: `shared`) – Product domain folder and Nx project prefix
- **protected** (default: `true`) – Enable authenticated routes

```bash
nx generate @forepath/code:mcp devkit --domain=shared
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
