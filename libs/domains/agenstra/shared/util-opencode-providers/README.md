# agenstra-shared-util-opencode-providers

Shared types and pure helpers for OpenCode LLM provider catalogs.

The live catalog is stored in Postgres (`opencode_providers`) and exposed via
`GET /opencode-providers` on the agent controller. Refresh runs through BullMQ
(`opencode-providers.refresh`) from models.dev — there is no committed snapshot.

## Exports

- `OpencodeBuiltinProvider` — `{ id, name, env, models, npm?, api? }`
- `OpencodeBuiltinProviderModel` — `{ id, name }`
- `getBuiltinProvider(catalog, id)` / `unusedBuiltinProviders(catalog, existingKeys)`
- `formatProviderModelRef` / `parseProviderModelRef` / `filterBuiltinProvidersByAllowDeny` /
  `unusedBuiltinModelProviders` / `unusedBuiltinModelsForProvider` for Models-tab allow/deny pickers

## Building / tests

```bash
nx build agenstra-shared-util-opencode-providers
nx test agenstra-shared-util-opencode-providers
```
