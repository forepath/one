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

Creates a new domain library (feature, data-access, ui, util, or provider) under a given domain and scope.

- **domain** (required) – Domain name
- **scope** (required) – `frontend`, `backend`, `keycloak`, or `shared`
- **type** (required) – `data-access`, `feature`, `ui`, `util`, or `provider`
- **name** (required) – Library name
- **generator** (required) – Base Nx generator: `js`, `node`, or `angular`

```bash
nx generate @forepath/code:lib --domain=payments --scope=frontend --type=feature --name=checkout --generator=angular
```

For extension provider libraries, prefer `@forepath/code:provider` (adds `forepath.extension.json` and extension stubs).

### provider

Scaffolds a Forepath extension provider library under `libs/domains/{domain}/backend/provider-{name}/` with `forepath.extension.json`, provider stub, and extension factory.

- **domain** (required) – `agenstra` or `decabill`
- **name** (required) – short provider name (e.g. `stripe`, `cursor`)
- **kind** (required) – extension kind constant for the domain plugin-host
- **description** (optional) – manifest description
- **version** (optional, default `0.0.0`) – manifest semver
- **generator** (optional, default `node`) – base Nx library generator (`js` or `node`)

```bash
nx generate @forepath/code:provider decabill stripe payment-processor
nx generate @forepath/code:provider agenstra cursor agent-provider --description="Cursor agent provider"
```

Generated libraries are tagged `domain:{domain},scope:backend,type:provider` and import domain contracts from `{domain}/backend/util-plugin-host`.

External npm extensions ship `forepath.extension.json` at the package root; internal monorepo providers use the generated manifest beside `src/index.ts`.

#### External npm extension packages

Third-party extensions are published as normal npm packages and loaded at **deploy time** (listed in the backend app `package.json`), then referenced via `npm:` env specifiers.

**Package layout (minimum):**

```
my-forepath-extension/
  package.json
  forepath.extension.json
  dist/index.js          # exports createMyExtension()
```

**`forepath.extension.json`:**

```json
{
  "id": "my-extension",
  "kind": "agent-provider",
  "name": "My Extension",
  "description": "Short description for admin UIs and logs.",
  "version": "1.0.0"
}
```

The `kind` must match the target domain plugin-host (`agent-provider`, `payment-processor`, etc.). The `id` must match the provider's `getType()` return value.

**`package.json` bridge (optional when manifest is at package root):**

```json
{
  "name": "@acme/agenstra-cursor-agent",
  "main": "dist/index.js",
  "forepath": {
    "extensionManifest": "./forepath.extension.json"
  }
}
```

**Deploy and configure:**

1. Add the package to the backend app `dependencies` and install in the deployment image.
2. Append an `npm:` specifier to the relevant env key, for example:
   `AGENSTRA_AGENT_PROVIDER_EXTENSIONS=@forepath/agenstra/backend/provider-cursor,npm:@acme/agenstra-cursor-agent`
3. Backend app webpack configs call `applyExtensionWebpackExternals` from `util-extension-core` so npm extensions are not bundled and resolve at runtime via Node `require`.

**Extension entrypoint:** Export `create{Name}Extension(): ForepathExtension<TContract>` from the package main (or set `entrypoint` in the manifest when non-default). See `@forepath/shared/backend/util-extension-core` and domain `util-plugin-host` modules.

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
