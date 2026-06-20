# @forepath/shared/backend/util-dynamic-provider-registry

Shared utilities for loading and registering dynamic NestJS provider plugins from comma-separated `DYNAMIC_*` environment variables.

## Dual-source loading

Provider packages resolve in this order:

1. **Baked-in** — `createRequire(<app-root>/package.json).resolve(specifier)` (image build / prune graph)
2. **Plugin path** — lookup under `DYNAMIC_PROVIDER_PLUGIN_PATH` by `package.json` `name`
3. **Fail** — log and skip (or abort when critical + `DYNAMIC_PROVIDERS_FAIL_FAST=true`)

Baked-in resolution wins when both sources exist. Post-build loading is additive; it does not replace baking plugins into the deploy graph.

### Baked-in providers

A package listed in a `DYNAMIC_*` env var can be a runtime dependency of the consuming backend application. Add it to the app deploy graph and run `nx run <backend-app>:prune` so it appears in `dist/apps/<domain>/<app>/package.json` or `workspace_modules/`.

### Post-build providers (mounted / startup install)

Without rebuilding the app image, operators can:

1. Set `DYNAMIC_PROVIDER_PLUGIN_PATH` to an absolute path inside the container (recommended with compose: `/var/lib/forepath/provider-plugins` when the `./provider-plugins` volume is mounted)
2. Mount plugin folders or tarballs into that path, and/or set `DYNAMIC_PROVIDER_PLUGIN_INSTALL` for startup `npm install`
3. Reference packages by **name** in existing `DYNAMIC_*` env vars (e.g. `custom=@forepath/agenstra/backend/provisioning-custom`)
4. Restart the container

At container startup, `install-provider-plugins.js` runs before `main.js` when `DYNAMIC_PROVIDER_PLUGIN_PATH` is set.

Plugin packages should declare Nest/host dependencies as **peerDependencies** so they resolve from `/app/node_modules`.

## Environment variables

| Variable                            | Criticality | Purpose                                                       |
| ----------------------------------- | ----------- | ------------------------------------------------------------- |
| `DYNAMIC_PROVISIONING_PROVIDERS`    | critical    | Extra provisioning providers                                  |
| `DYNAMIC_CONTEXT_IMPORT_PROVIDERS`  | optional    | Extra context import providers                                |
| `DYNAMIC_AGENT_PROVIDERS`           | optional    | Extra agent backends                                          |
| `DYNAMIC_PIPELINE_PROVIDERS`        | optional    | Extra CI/CD providers                                         |
| `DYNAMIC_CHAT_FILTERS`              | optional    | Extra chat filters                                            |
| `DYNAMIC_PAYMENT_PROCESSORS`        | critical    | Extra payment processors                                      |
| `DYNAMIC_BILLING_PROVIDER_METADATA` | optional    | Extra billing UI provider metadata                            |
| `DYNAMIC_PROVIDERS_FAIL_FAST`       | —           | When `true`, critical registries abort startup on load errors |
| `DYNAMIC_PROVIDER_PLUGIN_PATH`      | —           | Absolute plugin root for post-build loading                   |
| `DYNAMIC_PROVIDER_PLUGIN_INSTALL`   | —           | Comma-separated `npm install` targets at startup              |

### Provider config format

```bash
# alias=@package/specifier (baked-in or plugin-path by package name)
DYNAMIC_PROVISIONING_PROVIDERS=custom=@forepath/agenstra/backend/provisioning-custom

# PascalCase alias selects a named class export
DYNAMIC_PROVISIONING_PROVIDERS=CustomProvider=@forepath/agenstra/backend/provisioning-custom

# bare specifier
DYNAMIC_AGENT_PROVIDERS=@forepath/agenstra/backend/agent-custom

# file: entry (always relative to DYNAMIC_PROVIDER_PLUGIN_PATH)
DYNAMIC_PROVISIONING_PROVIDERS=custom=file:provisioning-custom
```

Allowed specifier prefixes: `@forepath/`, `@agenstra/`. Do not combine `file:` with `@forepath/` on the same entry.

### Startup install format

```bash
# Registry package (requires .npmrc / auth in image or mounted secret)
DYNAMIC_PROVIDER_PLUGIN_INSTALL=@forepath/agenstra-provisioning-custom@1.2.0

# Local tarball or directory under plugin path
DYNAMIC_PROVIDER_PLUGIN_INSTALL=file:/var/lib/forepath/provider-plugins/my-plugin.tgz,file:my-plugin-dir

# Mixed
DYNAMIC_PROVIDER_PLUGIN_INSTALL=file:foo.tgz,@forepath/bar@2.0.0
```

`file:` install paths must resolve under `DYNAMIC_PROVIDER_PLUGIN_PATH`. Compose mounts `./provider-plugins` read-write by default so startup install can write; add `:ro` only when plugins are pre-copied and `DYNAMIC_PROVIDER_PLUGIN_INSTALL` is unset.

## Plugin package export contract

External plugin packages must export one of:

1. **`createProvider`** (preferred) — `(moduleRef: ModuleRef) => T | Promise<T>`
2. **Named PascalCase class** — via entry alias (`ClassName=@forepath/pkg`) or `package.json`:

```json
{
  "forepath": {
    "providerExport": "CustomProvisioningProvider"
  }
}
```

Optional: **`providerMetadata`** — `{ id, displayName, configSchema? }` for billing registry.

Generic `provider` / `Provider` exports are **not** accepted for plugin packages (test fixtures only).

### Example plugin `index.ts`

```typescript
import type { ModuleRef } from '@nestjs/core';

export async function createProvider(moduleRef: ModuleRef) {
  return moduleRef.create(CustomProvisioningProvider);
}

export { CustomProvisioningProvider } from './custom-provisioning.provider';
export { CUSTOM_PROVIDER_METADATA as providerMetadata } from './metadata';
```

## Startup error policy

| Criticality | `DYNAMIC_PROVIDERS_FAIL_FAST` | On error           |
| ----------- | ----------------------------- | ------------------ |
| optional    | any                           | Log and skip entry |
| critical    | unset / `false`               | Log and skip entry |
| critical    | `true`                        | Abort startup      |

**Production recommendation:** set `DYNAMIC_PROVIDERS_FAIL_FAST=true` when `DYNAMIC_PROVISIONING_PROVIDERS` or `DYNAMIC_PAYMENT_PROCESSORS` is non-empty.

## Usage in NestJS modules

Static registrations remain unchanged. Append dynamic registration after static entries:

```typescript
import {
  DynamicProviderLoaderService,
  registerDynamicProviders,
} from '@forepath/shared/backend/util-dynamic-provider-registry';

{
  provide: 'PROVISIONING_PROVIDERS',
  useFactory: async (factory, hetzner, digitalOcean, dynamicLoader) => {
    factory.registerProvider(hetzner);
    factory.registerProvider(digitalOcean);

    await registerDynamicProviders({
      envKey: 'DYNAMIC_PROVISIONING_PROVIDERS',
      criticality: 'critical',
      register: (provider) => factory.registerProvider(provider),
      dynamicLoader,
    });

    return factory;
  },
  inject: [ProvisioningProviderFactory, HetznerProvider, DigitalOceanProvider, DynamicProviderLoaderService],
}
```

## Public API

- `parseProviderPackageSpec(raw)` — parse env string
- `parseProviderPluginInstallSpec(raw)` — parse startup install string
- `assertRuntimeDependency(specifier, options)` — baked-in runtime dependency gate
- `assertPathUnderPluginRoot(candidatePath, pluginRoot)` — path traversal guard
- `buildPluginPathIndex(pluginPath)` — index mounted packages by `package.json` name
- `resolveProviderLoadTarget(entry, options)` — baked-in first, plugin-path fallback
- `loadProviderModule(entry, options)` — load from baked-in or plugin path
- `resolveProviderExport(module, options)` — plugin export contract resolution
- `installProviderPluginsFromEnv(env?)` — startup `npm install` into plugin path
- `registerDynamicProviders(options)` — register instances from env
- `registerDynamicProviderMetadata(options)` — register billing metadata from env
- `DynamicProviderLoaderService` — Nest injectable loader
