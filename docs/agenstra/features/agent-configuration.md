# Agent configuration

Three-layer runtime configuration for Agenstra agents (underlying OpenCode V2 config documents).

## Layers

Precedence for **replace** semantics (later wins): environment (agent) → workspace (client) → admin (global).

| Layer          | UI                                                | API                                                    |
| -------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Admin (global) | Console **Agent configuration** (`/agent-config`) | `GET/PUT /admin/opencode/config`                       |
| Workspace      | Chat modal **Workspace agent configuration**      | `GET/PUT /clients/:id/opencode/config`                 |
| Environment    | Chat modal **Environment agent configuration**    | `GET/PUT /clients/:id/agents/:agentId/opencode/config` |

Frontend copy never uses the vendor name “OpenCode”; APIs and worker sync keep technical path names (`/opencode/config`).

## UI tabs ↔ config fields

| Section    | Tab                      | Config / secrets                                                                                                         |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Core       | General                  | `username`, `theme`, `model` (known provider/model picker), `share`, `keybinds`, `tui`, `server`                         |
| Core       | Models                   | UI allow/deny + known provider/model pickers → `enabled_providers` / `disabled_providers` / `model_allow` / `model_deny` |
| Core       | Providers                | `providers` + credential secrets; catalog models locked read-only for built-ins                                          |
| Extensions | MCP                      | `mcp_allow` / `mcp_deny` + `mcp.servers` + secrets/OAuth; registry catalog picker (built-in vs custom)                   |
| Extensions | Skills & instructions    | `skills`, `instructions`                                                                                                 |
| Extensions | Commands & plugins       | `commands`, `plugins`                                                                                                    |
| Extensions | Agents                   | `agents`                                                                                                                 |
| Extensions | References               | `references`                                                                                                             |
| Security   | Permissions & policies   | `permissions`, `experimental.policies`                                                                                   |
| Runtime    | Websearch & network      | `websearch`; Network → secrets `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`                            |
| Runtime    | Compaction               | `compaction`                                                                                                             |
| Runtime    | Formatters & attachments | `formatter`, `media` / attachment limits                                                                                 |
| Runtime    | Warming                  | `warming`                                                                                                                |
| Runtime    | Tool output              | `tool_output`                                                                                                            |
| Advanced   | Overrides                | Layer `overrides` JSON (merged over structured `config`; same heredity locks)                                            |

Modes: **Structured** (sectioned vertical tabs) and **Raw JSON**. Both enforce heredity.

Within a layer, the editable surface is `compose(config, overrides)` — structured tabs edit `config`; **Advanced → Overrides** edits `overrides`. **Configuration JSON** (raw mode) shows that composed overlay. Saving from raw absorbs the JSON into `config` and clears `overrides`.

## Heredity

- **Replace + lock:** `permissions`, provider allow/deny lists, model allow/deny lists, MCP allow/deny lists (`mcp_allow` / `mcp_deny`), `experimental.policies`, and similar security roots. Parent presence locks the path for children.
- **Explicit locks (Global / Workspace):** each layer may store a `locks` array of JSON Pointers (e.g. `/model`, `/skills`, `/tabs/mcp`). Locks apply to **this layer and** lower layers **even when the parent value is unset**. Tab locks use `/tabs/{id}` and expand to all fields owned by that tab. Environment cannot author locks.
- **Map merge:** `providers`, `mcp.servers`, `commands`, `agents`, `references`, `formatter` (object) — parent entry keys are inherited; children may add new keys and may set `disabled` / `hidden` on inherited keys (deep-merged), unless the map root is explicitly locked. Parent `formatter: false` fully locks formatters. When an inherited map entry is prohibited by allow/deny (this layer or a higher layer), the editor and **backend PUT** write a `{ disabled: true }` stub into the overlay (checkbox cannot override). Local prohibited entries are **deleted** from the overlay.
- **Array concat:** `skills`, `instructions`, `plugins` — parent items stack; children append (skills are converted to OpenCode `{ paths, urls }` on worker sync), unless the array root is explicitly locked.
- Responses expose `locks` (this layer), `lockedPaths` (from higher layers, presence + expanded explicit locks), and `inheritedAdditive`.
- Locked fields/lists/tabs stay **visible** and **read-only** on the locking layer and on children (same presentation as presence-locks when a parent set a value). Environment can still Authenticate MCP servers when MCP is locked. Applying an explicit lock first **resets** the path to the inherited/default value (clears this layer’s overlay), so the lock freezes the original rather than a pending edit.
- Section headings vanish only when no controls remain in that section for other reasons (not because of locks).
- Raw JSON mode and Advanced overrides validate overlays with the same rules (`validateOverlayAgainstHeredity`). Network secret keys honor `/secrets/{KEY}` locks.

Worker sync applies effective config via `PATCH /global/config` (durable OpenCode global config). Immediate on save for agent PUT; workspace/global cascade processes a first batch immediately; BullMQ retries pending/failed about every `OPENCODE_CONFIG_SYNC_INTERVAL_MS` (default 30s).

## V2-only config

Stored overlays and worker payloads use OpenCode **V2** field names only.

| Do not use (V1 / legacy)   | V2 replacement                |
| -------------------------- | ----------------------------- |
| `provider`                 | `providers`                   |
| `permission`               | `permissions` (ordered rules) |
| `agent` / top-level `mode` | `agents`                      |
| `plugin`                   | `plugins`                     |
| `command` (singular root)  | `commands`                    |
| `snapshot` / `attachment`  | `snapshots` / `media`         |
| `tools` boolean map        | express via `permissions`     |
| `autoshare`                | `share: "auto"`               |
| Flat `mcp.<name>`          | `mcp.servers.<name>`          |
| CamelCase MCP OAuth        | snake_case (`client_id`, …)   |

- **PUT** rejects forbidden V1 roots with a clear error listing keys to rename.
- **GET / sync** run `migrateConfigV1ToV2` so legacy rows still load; save persists V2.
- Model allow/deny UI lists materialize to `enabled_providers` / `disabled_providers` / `providers.*.whitelist` / `providers.*.blacklist` (denylist wins). Empty `providers.*.models` stubs become wire `whitelist` ids (OpenCode drops empty model objects). Local disallowed provider map entries are removed from the editable overlay; inherited ones are marked `disabled: true` (stub included in the submitted overlay; wire maps that to `disabled_providers`).
- MCP allow/deny UI lists (`mcp_allow` / `mcp_deny`) are **platform-only** (OpenCode has no native MCP whitelist/blacklist). On sync they filter `mcp.servers` (denylist wins; empty allow = unrestricted; token `custom` gates non-catalog servers) and are stripped from the wire payload. Catalog seeds store a UI-only `registry` name for classification; allow/deny identity requires `registry` whose `mcpServerConfigKey` equals the map key (key-only / `__` reversal is not trusted). On every controller PUT, overlays are re-sanitized (including stored rows on partial updates): `registry` is stripped unless the entry transport matches a catalog seed. Effective worker sync on the controller re-strips against the catalog before `prepareConfigForSync`. Local disallowed servers are removed from the editable overlay; inherited disallowed servers are marked `disabled: true` instead (stub persists in the submitted config).
- **Backend always re-applies** the same allow/deny rules on global / workspace / agent PUT via `enforceAllowDenyOnOverlay` (shared util), independent of the UI. That covers MCP servers, providers, model allow/deny list refs, and default `model` / `small_model`. Heredity, V1-key, and credential checks already run on the same path. The editor hydrates inherited disable stubs additively on load (does not wipe owning-layer entries until allow/deny edits or save).
- Worker sync (`prepareConfigForSync`) converts the stored V2 overlay into OpenCode Config wire: singular roots (`provider`, `agent`, `command`, `plugin`, `permission`, `snapshot`, `attachment`, `autoupdate`), skills `{paths,urls}`, flat `mcp`, MCP `disabled`→`enabled`, agent `system`/`disabled`→`prompt`/`disable`, command `subagent`→`subtask`, compaction `keep.tokens`/`buffer`→`preserve_recent_tokens`/`reserved`, and strips unsupported roots (`worktree`, `warming`, `websearch`, `mcp_allow`, `mcp_deny`, …). Agent-manager `/sync` always re-runs `prepareConfigForSync` and drops `registry` claims (no local catalog). Because OpenCode `PATCH /global/config` merges the `mcp` map (and rejects `null` deletes), sync GETs the current worker config and adds `{ enabled: false }` tombstones for MCP keys that are no longer in the desired wire so allow/deny removals take effect. Desired keys that were previously tombstoned are re-sent with `enabled: true` so PATCH merge resurrects them.

## Network

Proxy/CA settings are **not** JSON config. The Network panel writes reserved keys into the layer **secrets** map
(`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`). Global network secrets are merged into worker
sync when workspace/agent layers omit them.

On sync, the agent manager applies these via Docker container `Env` (recreating the container when values change).
Inline PEM for `NODE_EXTRA_CA_CERTS` is written to a file inside the container; the env var points at that path.
Provider API keys remain on live OpenCode `auth.set` and do not require a recreate.

## Provider credentials

Provider API keys are also layer **secrets**, not OpenCode config. Built-in providers seed `providers.<id>.env` with catalog env names; the UI shows a password field per env name (same pattern as Network). Values are stored under those env names in the secrets map. Worker sync applies them as:

- OpenCode `auth.set(providerId)` — env names matching `*_API_KEY` / `*_TOKEN` / … become ApiAuth `key`; other env values become ApiAuth `metadata` (e.g. `AZURE_RESOURCE_NAME` → `resourceName`)
- Docker container `Env` for every configured provider `env` name (OpenCode also reads e.g. `AZURE_RESOURCE_NAME` from process env; changing these recreates the container)
- Resolution accepts both UI `providers` and wire `provider` roots

Network keys are skipped for auth.set (proxy/CA stay Env-only). PUT secrets are merged as a patch: empty string clears a key; omitted keys are left unchanged.

## MCP servers and credentials

MCP servers live under `mcp.servers`. Built-in entries can be seeded from the official
[MCP Registry](https://registry.modelcontextprotocol.io/docs) catalog (`GET /opencode/mcp-servers`).
Catalog seed writes `command` / `url`, non-secret `environment` / `headers`, `secretEnv` /
`secretHeaders` **name lists**, and a UI-only `registry` name (stripped on wire). Secret **values**
(env, headers, OAuth `client_secret`) live in the layer secrets map — never in config JSON
(credential-like keys are rejected there).

Platform lists `mcp_allow` / `mcp_deny` (registry names and/or literal `custom`) gate which market
servers appear in typeaheads and whether Custom MCP is offered. Empty allowlist = unrestricted;
empty denylist = unrestricted; denylist wins on overlap. On worker sync, disallowed servers are
removed from the effective MCP map before OpenCode receives it.

Worker sync:

- Merges secret values into wire `mcp.<name>.environment` / `headers` / `oauth.clientSecret` before `PATCH /global/config`
- Remaps UI snake_case OAuth (`client_id`, …) to OpenCode camelCase and allowlists MCP fields
  (`additionalProperties: false` on OpenCode `McpLocalConfig` / `McpRemoteConfig`)
- Applies `secretEnv` names as Docker container `Env` (local MCP children inherit them)
- OAuth client secrets use namespaced keys `mcp.<serverKey>.oauth.client_secret`

### Interactive MCP auth (Environment only)

OpenCode exposes live MCP connection state via `GET /mcp` (`connected` | `disabled` | `failed` |
`needs_auth` | `needs_client_registration`). Environment (agent) config can start interactive OAuth:

| Controller                                                                                        | Manager                    | OpenCode                                                |
| ------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------- |
| `GET …/agents/:agentId/opencode/mcp`                                                              | `GET …/opencode/mcp`       | `GET /mcp`                                              |
| `POST …/opencode/mcp/:name/auth`                                                                  | same (+ `{ redirectUri }`) | patch `oauth.redirectUri`, then `POST /mcp/{name}/auth` |
| `POST …/opencode/mcp/:name/auth/callback`                                                         | same                       | `POST /mcp/{name}/auth/callback` `{ code }`             |
| `DELETE …/opencode/mcp/:name/auth`                                                                | same                       | `DELETE /mcp/{name}/auth`                               |
| **Public** `GET /clients/:clientId/agents/:agentId/opencode/mcp/:name/oauth/callback` (no `/api`) | —                          | verifies HMAC, proxies `code` to worker `auth/callback` |

On Authenticate, the controller builds a signed redirect URL (`exp` + HMAC `sig` via
`MCP_OAUTH_CALLBACK_SECRET`), sets that as the worker `oauth.redirectUri`, then opens the
IdP. The IdP returns to the public callback (not OpenCode’s default `127.0.0.1:19876`). Env:

- `MCP_OAUTH_CALLBACK_SECRET` — required HMAC secret
- `MCP_OAUTH_PUBLIC_BASE_URL` — controller public origin with a **non-privileged** port
  (OpenCode binds it inside the agent). Example: `http://localhost:3100`.
  Decabill-provisioned controllers set `http://{fqdn}:3100` and a random callback secret.

The Environment editor shows runtime status as a line-item badge and an Authenticate button in the
expanded row (disabled when connected).

The `opencode-mcp-servers.refresh` job walks **all** upstream cursor pages of
`GET /v0.1/servers?version=latest`, then upserts and deletes stale rows. Bootstrap enqueues when the
table is empty.

## Provider models

The `opencode-providers.refresh` job stores each provider’s models.dev model id/name list on `opencode_providers.models`. Built-in providers with a non-empty catalog list show a locked Models panel in the Providers tab. Custom providers (and catalog entries without models) keep the free-text “one model id per line” editor writing `providers.<id>.models`. On startup, if the catalog table is empty **or** all rows have empty `models`, a one-shot bootstrap refresh is enqueued.

## Sync

- `GET`/`PUT` responses include `config` and `overrides` (per-layer editable fields) plus `effective`: the full three-layer merge after each layer is `compose(config, overrides)` (agent → workspace → global).
- Agent GET/PUT also includes `sync`: durable per-agent sync target status (`pending` | `synced` | `failed`), revisions, and last error.
- Config/secrets PUTs mark affected agents’ sync targets `pending` (desired revision hash of effective config + secrets), then attempt an immediate apply for running agents.
- BullMQ `opencode-config-sync.coordinator` / `.unit` retry `pending` and `failed` targets (e.g. container stopped or OpenCode `/config` blip).
- Manager `POST …/opencode/config/sync` returns `{ ok, defer?, error? }` — never silent success when apply did not happen. Missing container keeps the target `pending` (`defer: true`).
- Workspace/global PUT cascade marks all affected agents pending (paged; no hard agent cap) and processes a first batch immediately.
- Agent create/start/restart mark config + layer-file targets pending, emit layer VFS files, and run the full three-layer merge + secrets sync (controller-owned; manager no longer pushes agent-only platform defaults).
- Layer-file emit failures are stored as `failed` and retried by `opencode-layer-files-sync` (pending + failed).

## Chat slash typeahead

Typing `/` in chat opens a typeahead fed by the worker’s OpenCode command registry (`GET /command`), proxied as:

- Manager: `GET /agents/:id/opencode/config/commands`
- Controller: `GET /clients/:id/agents/:agentId/opencode/config/commands`

That registry merges (OpenCode priority):

1. Built-ins: `init`, `review`
2. Config / markdown commands (`commands` in our overlay; OpenCode JSON `command`)
3. MCP prompts (registered as slash commands)
4. Skills (lowest priority; skipped on name collision)

Not in the slash registry (separate input syntax): `@` file mentions and `` !`bash` `` template shell substitution. TUI chrome like `/undo` / `/help` is also not part of `GET /command`.

When the worker list is empty or unreachable, the console falls back to effective/overlay `commands` keys plus the two builtins.

## Path lists and layer files

Skills, instructions, references (local path), and plugin packages use structured `fpc-list` rows:

- Inherited additive entries are read-only (no edit/remove/open).
- Local overlay rows can be added/edited/removed.
- URLs open in a new browser tab.
- Local paths owned by the **current** layer open as entered (no `.agenstra/layer/...` rewrite) — files or directories.

### Layer virtual filesystem

| Layer       | Editor                                | Storage                                                       | Emit                                                                                                                                                                 |
| ----------- | ------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global      | Admin layer IDE modal (tree + Monaco) | `opencode_layer_files` (scope=global, AES-256-GCM content)    | All agents; absolute (`/…`) paths installed via root Docker exec, left root-owned and mode `u=rwX,go=rX` (readable, not writable by OpenCode); relative under `/app` |
| Workspace   | Chat layer IDE modal                  | `opencode_layer_files` (scope=workspace, AES-256-GCM content) | All agents in that client; same absolute vs relative rules                                                                                                           |
| Environment | Studio `/editor?file=`                | Agent `/app` files API                                        | That agent only                                                                                                                                                      |

APIs:

- `GET /admin/opencode/config/files?path=` — list children
- `POST /admin/opencode/config/files` — create file or directory
- `GET/PUT/DELETE /admin/opencode/config/files/*path`
- Same under `/clients/:id/opencode/config/files` for workspace

Saving a layer **file** fans out via the agent file proxy (`context=app`); parents are created with `mkdir -p` on write. Directory markers emit via `createFileOrDirectory` (`mkdir -p`). Opening / ensuring a config path calls `POST .../files/ensure` (mkdir -p ancestors + leaf), then **resets that path on agent containers**: if no other VFS occupies the path/subpaths, the folder is deleted and recreated from VFS; if another VFS defines paths underneath, those are preserved and only orphans are removed. Applicable layer entries under the path are then re-emitted. Agent create/start/restart also pulls applicable layer entries and pushes the full merged OpenCode config (global → workspace → agent). Global and workspace config PUTs cascade that same effective config to all affected agents.

The legacy provider config file tree (`/clients/…/config`, `context=config`) has been removed.

## Implementation

- Shared editor: `@forepath/agenstra/frontend/feature-agent-config` (`agenstra-agent-config-editor`)
- Structured lists/forms for providers, MCP, commands, plugins, agents, references, permissions/policies, formatters, compaction, warming, media, websearch; raw JSON remains a full-overlay mode
- Shared merge/heredity util: `@forepath/agenstra/shared/util-opencode-config`
- Built-in LLM provider catalog: Postgres table `opencode_providers`, served by authenticated
  `GET /opencode/providers` (`clients:read`, optional `search` / `limit` / `offset`) and
  `GET /opencode/providers/{id}`. Refreshed from [models.dev](https://models.dev/) via BullMQ job
  `opencode-providers.refresh` (`OPENCODE_PROVIDERS_REFRESH_INTERVAL_MS`, default 24h). On startup,
  if the table is empty, a one-shot bootstrap job is enqueued. The Providers tab typeahead searches
  the catalog; ids referenced in the layer are loaded with `GET …/{id}`. Models allow/deny pickers
  use the same on-demand cache; custom provider ids remain free-text.
- Built-in MCP Registry catalog: Postgres table `opencode_mcp_servers`, served by authenticated
  `GET /opencode/mcp-servers` (`clients:read`, optional `search` / `limit` / `offset`) and
  `GET /opencode/mcp-servers/{name}`. Refreshed from the
  [official MCP Registry](https://registry.modelcontextprotocol.io/docs) via BullMQ job
  `opencode-mcp-servers.refresh` (full `nextCursor` walk). On startup, if the table is empty, a
  one-shot bootstrap job is enqueued. The MCP tab typeahead searches the registry; configured servers
  are hydrated by registry name on load.
- Environment interactive MCP auth: `GET/POST/DELETE …/agents/:agentId/opencode/mcp…` proxies
  OpenCode `/mcp` status and OAuth start/callback/remove (agent-config editor, Environment layer only).

## References

- [OpenCode V2 config](https://opencode.ai/v2/docs/config/)
- [OpenCode Providers](https://opencode.ai/docs/providers/)
- [MCP Registry](https://registry.modelcontextprotocol.io/docs)
- Shared util: `libs/domains/agenstra/shared/util-opencode-config`
- Provider catalog: `libs/domains/agenstra/shared/util-opencode-providers` (types/helpers only)
- MCP catalog: `libs/domains/agenstra/shared/util-opencode-mcp-servers` (types/helpers / seed)
- Backend catalogs: `OpencodeProvidersCatalogService` + `opencode_providers`;
  `OpencodeMcpServersCatalogService` + `opencode_mcp_servers`
