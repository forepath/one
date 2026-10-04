import type { JsonObject } from './types';
import { migrateConfigV1ToV2 } from './migrate-v1-to-v2';
import { wireMcpOauthForOpenCode } from './mcp-wire';
import { isMcpServerAllowed, resolveMcpAllowDenyIdentity } from '@forepath/agenstra/shared/util-opencode-mcp-servers';

/** Platform / UI-only roots that OpenCode Config rejects or silently drops. */
const UNSUPPORTED_WIRE_ROOTS = [
  'theme',
  'keybinds',
  'tui',
  'worktree',
  'warming',
  'websearch',
  'model_allow',
  'model_deny',
  'mcp_allow',
  'mcp_deny',
] as const;

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseModelRef(ref: string): { provider: string; model: string } | null {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf('/');

  if (slash <= 0 || slash === trimmed.length - 1) {
    return null;
  }

  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function renameRootKey(config: JsonObject, from: string, to: string): void {
  if (!(from in config)) {
    return;
  }

  const incoming = config[from];
  delete config[from];

  if (!(to in config)) {
    config[to] = incoming;
    return;
  }

  const existing = config[to];

  if (isPlainObject(existing) && isPlainObject(incoming)) {
    config[to] = { ...incoming, ...existing };
    return;
  }

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    config[to] = [...incoming, ...existing];
  }
}

function ensureStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function ensureProviderEntry(providers: JsonObject, providerId: string): JsonObject {
  if (!isPlainObject(providers[providerId])) {
    providers[providerId] = {};
  }

  return providers[providerId] as JsonObject;
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) {
    list.push(value);
  }
}

/**
 * Convert textarea-style `KEY=value` arrays into string records.
 * Already-object maps are cloned; empty input yields undefined.
 */
function coerceStringRecord(value: unknown): JsonObject | undefined {
  if (isPlainObject(value)) {
    const next: JsonObject = {};

    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') {
        next[key] = entry;
      } else if (entry == null) {
        next[key] = '';
      } else {
        next[key] = String(entry);
      }
    }

    return Object.keys(next).length ? next : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const next: JsonObject = {};

  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      continue;
    }

    const split = item.indexOf('=');
    const key = (split >= 0 ? item.slice(0, split) : item).trim();
    const entry = split >= 0 ? item.slice(split + 1) : '';

    if (key) {
      next[key] = entry;
    }
  }

  return Object.keys(next).length ? next : undefined;
}

/**
 * Convert UI permissions rule arrays into OpenCode `permission` object maps.
 * `shell` is aliased to OpenCode's `bash` action.
 */
export function permissionsRulesToWire(rules: unknown): JsonObject | undefined {
  if (isPlainObject(rules)) {
    return structuredClone(rules);
  }

  if (!Array.isArray(rules)) {
    return undefined;
  }

  const byAction = new Map<string, Record<string, string>>();

  for (const rule of rules) {
    if (!isPlainObject(rule)) {
      continue;
    }

    const rawAction = rule['action'];
    const effect = rule['effect'];

    if (typeof rawAction !== 'string' || !rawAction.trim()) {
      continue;
    }

    if (effect !== 'ask' && effect !== 'allow' && effect !== 'deny') {
      continue;
    }

    const action = rawAction.trim() === 'shell' ? 'bash' : rawAction.trim();
    const resource = typeof rule['resource'] === 'string' && rule['resource'].trim() ? rule['resource'].trim() : '*';

    const resources = byAction.get(action) ?? {};
    resources[resource] = effect;
    byAction.set(action, resources);
  }

  if (byAction.size === 0) {
    return undefined;
  }

  const permission: JsonObject = {};

  for (const [action, resources] of byAction.entries()) {
    const keys = Object.keys(resources);

    if (keys.length === 1 && keys[0] === '*') {
      permission[action] = resources['*'];
    } else {
      permission[action] = resources;
    }
  }

  return permission;
}

function mapAutoupdate(value: unknown): boolean | 'notify' | undefined {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  if (value === 'notify') {
    return 'notify';
  }

  return undefined;
}

function wireAgentEntry(agent: JsonObject): JsonObject {
  const next: JsonObject = { ...agent };

  if ('system' in next && !('prompt' in next)) {
    next['prompt'] = next['system'];
  }

  delete next['system'];

  if ('disabled' in next && !('disable' in next)) {
    next['disable'] = next['disabled'] === true;
  }

  delete next['disabled'];

  if ('permissions' in next && !('permission' in next)) {
    const permission = permissionsRulesToWire(next['permissions']);

    if (permission) {
      next['permission'] = permission;
    }
  }

  delete next['permissions'];

  return next;
}

function wireCommandEntry(command: JsonObject): JsonObject {
  const next: JsonObject = { ...command };

  if ('subagent' in next && !('subtask' in next)) {
    next['subtask'] = next['subagent'] === true;
  }

  delete next['subagent'];

  return next;
}

function isEmptyModelStub(value: JsonObject): boolean {
  return Object.keys(value).length === 0;
}

function wireProviderEntry(provider: JsonObject, disabledProviders: string[], providerId: string): JsonObject {
  const next: JsonObject = { ...provider };

  if (next['disabled'] === true) {
    pushUnique(disabledProviders, providerId);
  }

  delete next['disabled'];

  const models = next['models'];
  const whitelist = ensureStringList(next['whitelist']);
  const blacklist = ensureStringList(next['blacklist']);

  if (Array.isArray(models)) {
    // UI / raw string lists are availability allowlists — OpenCode drops empty model stubs.
    for (const item of models) {
      if (typeof item === 'string' && item.trim()) {
        pushUnique(whitelist, item.trim());
      }
    }

    delete next['models'];
  } else if (isPlainObject(models)) {
    const objectModels: JsonObject = {};

    for (const [modelId, modelValue] of Object.entries(models)) {
      if (!isPlainObject(modelValue)) {
        pushUnique(whitelist, modelId);
        continue;
      }

      const model: JsonObject = { ...modelValue };
      const wasDisabled = model['disabled'] === true;

      if (wasDisabled) {
        pushUnique(blacklist, modelId);
        delete model['disabled'];
      }

      if (isEmptyModelStub(model)) {
        // Empty stubs are not persisted by OpenCode; express them as whitelist ids.
        // Disabled-only stubs become blacklist entries only.
        if (!wasDisabled) {
          pushUnique(whitelist, modelId);
        }

        continue;
      }

      objectModels[modelId] = model;
    }

    if (Object.keys(objectModels).length) {
      next['models'] = objectModels;
    } else {
      delete next['models'];
    }
  }

  if (whitelist.length) {
    next['whitelist'] = whitelist;
  }

  if (blacklist.length) {
    next['blacklist'] = blacklist;
  }

  return next;
}

function wireMcpServer(server: JsonObject): JsonObject {
  const next: JsonObject = { ...server };

  if ('disabled' in next && !('enabled' in next)) {
    next['enabled'] = next['disabled'] !== true;
  }

  delete next['disabled'];

  const environment = coerceStringRecord(next['environment'] ?? next['env']);

  if (environment) {
    next['environment'] = environment;
  } else {
    delete next['environment'];
  }

  delete next['env'];

  const headers = coerceStringRecord(next['headers']);

  if (headers) {
    next['headers'] = headers;
  } else {
    delete next['headers'];
  }

  // Preserve secretEnv / secretHeaders name lists for sync-time injection; stripped in injectMcpSecretsIntoWire.
  // Drop UI-only registry name used for allow/deny classification.
  delete next['registry'];

  const secretEnv = ensureStringList(next['secretEnv']);

  if (secretEnv.length) {
    next['secretEnv'] = secretEnv;
  } else {
    delete next['secretEnv'];
  }

  const secretHeaders = ensureStringList(next['secretHeaders']);

  if (secretHeaders.length) {
    next['secretHeaders'] = secretHeaders;
  } else {
    delete next['secretHeaders'];
  }

  // OpenCode McpOAuthConfig is camelCase + additionalProperties:false. UI stores snake_case.
  // Never emit client_secret / clientSecret here — those come from layer secrets after assert.
  if (next['oauth'] === false) {
    // keep explicit disable
  } else if (isPlainObject(next['oauth'])) {
    const oauth = wireMcpOauthForOpenCode(next['oauth'] as JsonObject, { includeClientSecret: false });

    if (oauth && Object.keys(oauth).length > 0) {
      next['oauth'] = oauth;
    } else {
      delete next['oauth'];
    }
  } else {
    delete next['oauth'];
  }

  const serverTimeout = next['timeout'];

  if (isPlainObject(serverTimeout)) {
    const request = serverTimeout['request'];
    const startup = serverTimeout['startup'];

    if (typeof request === 'number' && Number.isFinite(request)) {
      next['timeout'] = request;
    } else if (typeof startup === 'number' && Number.isFinite(startup)) {
      next['timeout'] = startup;
    } else {
      delete next['timeout'];
    }
  }

  return next;
}

function wireFormatter(formatter: unknown): unknown {
  if (formatter === false || formatter === true) {
    return formatter;
  }

  if (!isPlainObject(formatter)) {
    return formatter;
  }

  const next: JsonObject = {};

  for (const [name, value] of Object.entries(formatter)) {
    if (!isPlainObject(value)) {
      next[name] = value;
      continue;
    }

    const entry: JsonObject = { ...value };
    const environment = coerceStringRecord(entry['environment'] ?? entry['env']);

    if (environment) {
      entry['environment'] = environment;
    } else {
      delete entry['environment'];
    }

    delete entry['env'];
    next[name] = entry;
  }

  return next;
}

function wireCompaction(compaction: JsonObject): JsonObject {
  const next: JsonObject = { ...compaction };
  const keep = isPlainObject(next['keep']) ? (next['keep'] as JsonObject) : null;

  if (keep && typeof keep['tokens'] === 'number' && next['preserve_recent_tokens'] === undefined) {
    next['preserve_recent_tokens'] = keep['tokens'];
  }

  delete next['keep'];

  if (typeof next['buffer'] === 'number' && next['reserved'] === undefined) {
    next['reserved'] = next['buffer'];
  }

  delete next['buffer'];

  return next;
}

function wireSkills(skills: unknown): JsonObject | undefined {
  if (isPlainObject(skills)) {
    const paths = ensureStringList(skills['paths']);
    const urls = ensureStringList(skills['urls']);
    const next: JsonObject = {};

    if (paths.length) {
      next['paths'] = paths;
    }

    if (urls.length) {
      next['urls'] = urls;
    }

    return Object.keys(next).length ? next : undefined;
  }

  if (!Array.isArray(skills)) {
    return undefined;
  }

  const paths: string[] = [];
  const urls: string[] = [];

  for (const item of skills) {
    if (typeof item !== 'string' || !item.trim()) {
      continue;
    }

    if (isHttpUrl(item)) {
      urls.push(item.trim());
    } else {
      paths.push(item.trim());
    }
  }

  const next: JsonObject = {};

  if (paths.length) {
    next['paths'] = paths;
  }

  if (urls.length) {
    next['urls'] = urls;
  }

  return Object.keys(next).length ? next : undefined;
}

function wireMcp(config: JsonObject): void {
  const mcp = config['mcp'];

  if (!isPlainObject(mcp)) {
    return;
  }

  const nextMcp: JsonObject = {};
  const servers = isPlainObject(mcp['servers']) ? (mcp['servers'] as JsonObject) : null;
  let mcpTimeoutMs: number | undefined;

  const timeoutRoot = mcp['timeout'];

  if (isPlainObject(timeoutRoot)) {
    const request = timeoutRoot['request'];
    const startup = timeoutRoot['startup'];

    if (typeof request === 'number' && Number.isFinite(request)) {
      mcpTimeoutMs = request;
    } else if (typeof startup === 'number' && Number.isFinite(startup)) {
      mcpTimeoutMs = startup;
    }
  } else if (typeof timeoutRoot === 'number' && Number.isFinite(timeoutRoot)) {
    mcpTimeoutMs = timeoutRoot;
  }

  const serverEntries =
    servers ?? Object.fromEntries(Object.entries(mcp).filter(([key]) => key !== 'timeout' && key !== 'servers'));

  for (const [name, value] of Object.entries(serverEntries)) {
    if (name === 'timeout' || name === 'servers' || !isPlainObject(value)) {
      continue;
    }

    nextMcp[name] = wireMcpServer(value);
  }

  if (Object.keys(nextMcp).length > 0) {
    config['mcp'] = nextMcp;
  } else {
    delete config['mcp'];
  }

  if (mcpTimeoutMs !== undefined) {
    const experimental = isPlainObject(config['experimental']) ? { ...(config['experimental'] as JsonObject) } : {};

    if (experimental['mcp_timeout'] === undefined) {
      experimental['mcp_timeout'] = mcpTimeoutMs;
      config['experimental'] = experimental;
    }
  }
}

/**
 * Applies UI allow/deny model lists onto native OpenCode provider fields.
 * - Provider denylist wins over allowlist when both list the same provider.
 * - Model denylist → `provider.<p>.blacklist`; allowlist → `provider.<p>.whitelist`.
 * - Strips platform-only keys (`model_allow`, `model_deny`).
 */
export function materializeModelAllowDeny(input: JsonObject): JsonObject {
  const config = migrateConfigV1ToV2(input);
  const allow = Array.isArray(config['model_allow'])
    ? (config['model_allow'] as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
  const deny = Array.isArray(config['model_deny'])
    ? (config['model_deny'] as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];

  delete config['model_allow'];
  delete config['model_deny'];

  let enabledProviders = Array.isArray(config['enabled_providers'])
    ? [...(config['enabled_providers'] as string[])]
    : [];
  let disabledProviders = Array.isArray(config['disabled_providers'])
    ? [...(config['disabled_providers'] as string[])]
    : [];

  const allowProviders = new Set(
    allow
      .map(parseModelRef)
      .filter((ref): ref is NonNullable<typeof ref> => !!ref)
      .map((ref) => ref.provider),
  );

  if (allowProviders.size > 0 && enabledProviders.length === 0) {
    enabledProviders = [...allowProviders];
  }

  disabledProviders = [...new Set(disabledProviders)];
  enabledProviders = enabledProviders.filter((provider) => !disabledProviders.includes(provider));

  if (enabledProviders.length > 0) {
    config['enabled_providers'] = enabledProviders;
  } else {
    delete config['enabled_providers'];
  }

  if (disabledProviders.length > 0) {
    config['disabled_providers'] = disabledProviders;
  } else {
    delete config['disabled_providers'];
  }

  if (!isPlainObject(config['providers'])) {
    config['providers'] = {};
  }

  const providers = config['providers'] as JsonObject;
  const whitelistByProvider = new Map<string, string[]>();
  const blacklistByProvider = new Map<string, string[]>();

  for (const ref of deny) {
    const parsed = parseModelRef(ref);

    if (!parsed) {
      continue;
    }

    const list = blacklistByProvider.get(parsed.provider) ?? [];
    pushUnique(list, parsed.model);
    blacklistByProvider.set(parsed.provider, list);
  }

  for (const ref of allow) {
    const parsed = parseModelRef(ref);

    if (!parsed) {
      continue;
    }

    // Deny wins over allow for the same model.
    if (deny.includes(ref)) {
      continue;
    }

    const list = whitelistByProvider.get(parsed.provider) ?? [];
    pushUnique(list, parsed.model);
    whitelistByProvider.set(parsed.provider, list);
  }

  for (const [providerId, models] of blacklistByProvider.entries()) {
    const provider = ensureProviderEntry(providers, providerId);
    const existing = ensureStringList(provider['blacklist']);

    for (const model of models) {
      pushUnique(existing, model);
    }

    provider['blacklist'] = existing;
  }

  for (const [providerId, models] of whitelistByProvider.entries()) {
    const provider = ensureProviderEntry(providers, providerId);
    const existing = ensureStringList(provider['whitelist']);

    for (const model of models) {
      pushUnique(existing, model);
    }

    provider['whitelist'] = existing;
  }

  if (Object.keys(providers).length === 0) {
    delete config['providers'];
  }

  return config;
}

function ensureStringListFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function filterMcpServerMap(servers: JsonObject, allow: readonly string[], deny: readonly string[]): JsonObject {
  const next: JsonObject = {};

  for (const [key, value] of Object.entries(servers)) {
    if (key === 'timeout' || key === 'servers') {
      continue;
    }

    const entry = isPlainObject(value) ? value : null;
    const identity = resolveMcpAllowDenyIdentity(key, entry, allow, deny);

    if (!isMcpServerAllowed(identity, allow, deny)) {
      continue;
    }

    next[key] = value;
  }

  return next;
}

/**
 * Applies UI MCP allow/deny lists onto configured servers, then strips platform keys.
 * Empty allowlist → no allow restriction; empty denylist → no deny restriction; deny wins.
 * OpenCode has no native MCP allow/deny fields — disallowed servers are removed from the overlay.
 */
export function materializeMcpAllowDeny(input: JsonObject): JsonObject {
  const config = migrateConfigV1ToV2(input);
  const allow = ensureStringListFromUnknown(config['mcp_allow']);
  const deny = ensureStringListFromUnknown(config['mcp_deny']);

  delete config['mcp_allow'];
  delete config['mcp_deny'];

  if (allow.length === 0 && deny.length === 0) {
    return config;
  }

  if (!isPlainObject(config['mcp'])) {
    return config;
  }

  const mcp = { ...(config['mcp'] as JsonObject) };
  const nestedServers = isPlainObject(mcp['servers']) ? (mcp['servers'] as JsonObject) : null;

  if (nestedServers) {
    const filtered = filterMcpServerMap(nestedServers, allow, deny);

    if (Object.keys(filtered).length > 0) {
      mcp['servers'] = filtered;
    } else {
      delete mcp['servers'];
    }
  } else {
    // Flat / legacy shape under mcp (non-timeout keys are servers).
    const timeout = mcp['timeout'];
    const filtered = filterMcpServerMap(mcp, allow, deny);
    const rebuilt: JsonObject = { ...filtered };

    if (timeout !== undefined) {
      rebuilt['timeout'] = timeout;
    }

    Object.keys(mcp).forEach((key) => {
      delete mcp[key];
    });

    Object.assign(mcp, rebuilt);
  }

  if (Object.keys(mcp).length > 0) {
    config['mcp'] = mcp;
  } else {
    delete config['mcp'];
  }

  return config;
}

/**
 * Convert Agenstra V2 overlay shape into OpenCode HTTP Config wire format.
 *
 * OpenCode's Config schema uses singular roots (`provider`, `agent`, `command`, …)
 * and different nested field names than our UI V2 documents. Plural / UI aliases are
 * accepted by PATCH but often silently dropped — this transform emits canonical wire.
 */
export function toOpencodeWireConfig(input: JsonObject): JsonObject {
  const config: JsonObject = structuredClone(input);

  // Skills: string[] → { paths, urls }
  const skills = wireSkills(config['skills']);

  if (skills) {
    config['skills'] = skills;
  } else {
    delete config['skills'];
  }

  // MCP: flatten servers, disabled→enabled, env/headers objects, timeout number
  wireMcp(config);

  // Agents map
  if (isPlainObject(config['agents'])) {
    const agents: JsonObject = {};

    for (const [name, value] of Object.entries(config['agents'] as JsonObject)) {
      if (isPlainObject(value)) {
        agents[name] = wireAgentEntry(value);
      }
    }

    config['agents'] = agents;
  }

  // Commands map
  if (isPlainObject(config['commands'])) {
    const commands: JsonObject = {};

    for (const [name, value] of Object.entries(config['commands'] as JsonObject)) {
      if (isPlainObject(value)) {
        commands[name] = wireCommandEntry(value);
      }
    }

    config['commands'] = commands;
  }

  // Providers map (+ disabled → disabled_providers, models array → object)
  const disabledProviders = ensureStringList(config['disabled_providers']);

  if (isPlainObject(config['providers'])) {
    const providers: JsonObject = {};

    for (const [name, value] of Object.entries(config['providers'] as JsonObject)) {
      if (isPlainObject(value)) {
        providers[name] = wireProviderEntry(value, disabledProviders, name);
      }
    }

    config['providers'] = providers;
  }

  if (disabledProviders.length) {
    config['disabled_providers'] = [...new Set(disabledProviders)];
  }

  // Permissions rules → permission object
  if ('permissions' in config) {
    const permission = permissionsRulesToWire(config['permissions']);
    delete config['permissions'];

    if (permission) {
      config['permission'] = permission;
    }
  }

  // Compaction UI keys → OpenCode keys
  if (isPlainObject(config['compaction'])) {
    config['compaction'] = wireCompaction(config['compaction'] as JsonObject);
  }

  // Formatter environment coercion
  if ('formatter' in config) {
    config['formatter'] = wireFormatter(config['formatter']);
  }

  // Root aliases → canonical OpenCode keys
  renameRootKey(config, 'providers', 'provider');
  renameRootKey(config, 'agents', 'agent');
  renameRootKey(config, 'commands', 'command');
  renameRootKey(config, 'plugins', 'plugin');
  renameRootKey(config, 'snapshots', 'snapshot');
  renameRootKey(config, 'media', 'attachment');

  if ('update' in config) {
    const autoupdate = mapAutoupdate(config['update']);
    delete config['update'];

    if (autoupdate !== undefined && config['autoupdate'] === undefined) {
      config['autoupdate'] = autoupdate;
    }
  }

  for (const key of UNSUPPORTED_WIRE_ROOTS) {
    delete config[key];
  }

  return config;
}

/**
 * Prepare a config document for the OpenCode worker:
 * V2 migrate → model materialization → MCP allow/deny filter → OpenCode Config wire shape.
 */
export function prepareConfigForSync(input: JsonObject | null | undefined): JsonObject {
  return toOpencodeWireConfig(materializeMcpAllowDeny(materializeModelAllowDeny(migrateConfigV1ToV2(input ?? {}))));
}

/**
 * OpenCode `PATCH /global/config` merges the `mcp` map and rejects `null` deletions.
 * For keys present in the worker but absent from the desired wire payload, emit
 * `{ enabled: false }` tombstones (supported by OpenCode's MCP schema) so allow/deny
 * removals and overlay deletes actually take effect on the running worker.
 * Desired keys that were previously tombstoned must send `enabled: true` (unless the
 * desired entry is already explicitly disabled) so PATCH merge resurrects them.
 */
export function applyMcpRemovalTombstones(
  wireConfig: JsonObject | null | undefined,
  currentMcp: JsonObject | null | undefined,
): JsonObject {
  const wire = isPlainObject(wireConfig) ? { ...wireConfig } : {};
  const desiredMcp = isPlainObject(wire['mcp']) ? { ...(wire['mcp'] as JsonObject) } : {};
  const current = isPlainObject(currentMcp) ? currentMcp : {};

  const nextMcp: JsonObject = { ...desiredMcp };
  let changed = false;

  for (const key of Object.keys(current)) {
    if (key in nextMcp) {
      continue;
    }

    nextMcp[key] = { enabled: false };
    changed = true;
  }

  for (const key of Object.keys(desiredMcp)) {
    const desired = desiredMcp[key];
    if (!isPlainObject(desired) || desired['enabled'] === false) {
      continue;
    }

    const existing = current[key];
    if (!isPlainObject(existing) || existing['enabled'] !== false) {
      continue;
    }

    nextMcp[key] = { ...desired, enabled: true };
    changed = true;
  }

  if (!changed) {
    return wire;
  }

  if (Object.keys(nextMcp).length > 0) {
    wire['mcp'] = nextMcp;
  } else {
    delete wire['mcp'];
  }

  return wire;
}
