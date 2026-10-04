import type {
  OpencodeBuiltinMcpArgument,
  OpencodeBuiltinMcpKeyValueInput,
  OpencodeBuiltinMcpPackage,
  OpencodeBuiltinMcpRemote,
  OpencodeBuiltinMcpServer,
  OpencodeMcpServerSeed,
} from './types';

/**
 * Looks up a catalog MCP server by reverse-DNS `name` (case-sensitive).
 */
export function getBuiltinMcpServer(
  catalog: readonly OpencodeBuiltinMcpServer[],
  name: string,
): OpencodeBuiltinMcpServer | undefined {
  const normalized = name.trim();

  if (!normalized) {
    return undefined;
  }

  return catalog.find((server) => server.name === normalized);
}

/**
 * Returns catalog servers whose names are not already present in `existingKeys`.
 * Skips `deleted` status entries.
 */
export function unusedBuiltinMcpServers(
  catalog: readonly OpencodeBuiltinMcpServer[],
  existingKeys: string[],
): OpencodeBuiltinMcpServer[] {
  const used = new Set(existingKeys.map((key) => key.trim()).filter((key) => key.length > 0));

  return catalog.filter((server) => server.status !== 'deleted' && !used.has(server.name));
}

/** Display label for a catalog MCP server (title, else name). */
export function builtinMcpServerLabel(server: OpencodeBuiltinMcpServer): string {
  const title = server.title?.trim();

  return title || server.name;
}

/**
 * Stable config map key for a catalog server (`io.github.user/weather` → `io.github.user__weather`).
 * OpenCode mcp.servers keys are free-form; slash is awkward in some UIs so we normalize.
 */
export function mcpServerConfigKey(serverName: string): string {
  return serverName.trim().replace(/\//g, '__');
}

/** Platform allow/deny list token for non-catalog (custom) MCP servers. */
export const CUSTOM_MCP_ALLOW_DENY_TOKEN = 'custom';

function normalizeAllowDenyIds(ids: readonly string[]): string[] {
  return ids.map((id) => id.trim()).filter((id) => id.length > 0);
}

/**
 * Whether an MCP identity (registry name or {@link CUSTOM_MCP_ALLOW_DENY_TOKEN}) is allowed.
 * Empty allowlist → no allow restriction; empty denylist → no deny restriction.
 * When both are set, denylist wins for overlapping ids.
 */
export function isMcpServerAllowed(identity: string, allow: readonly string[], deny: readonly string[]): boolean {
  const normalized = identity.trim();

  if (!normalized) {
    return false;
  }

  const allowed = normalizeAllowDenyIds(allow);
  const denied = new Set(normalizeAllowDenyIds(deny));

  if (denied.has(normalized)) {
    return false;
  }

  if (allowed.length > 0 && !allowed.includes(normalized)) {
    return false;
  }

  return true;
}

/** Whether custom (non-catalog) MCP servers are permitted by the allow/deny lists. */
export function isCustomMcpAllowed(allow: readonly string[], deny: readonly string[]): boolean {
  return isMcpServerAllowed(CUSTOM_MCP_ALLOW_DENY_TOKEN, allow, deny);
}

/**
 * Applies MCP allow/deny lists to a catalog.
 * Empty allowlist → no allow restriction; empty denylist → no deny restriction.
 * When both are set, denylist wins for overlapping ids. Skips `deleted` entries.
 */
export function filterBuiltinMcpServersByAllowDeny(
  catalog: readonly OpencodeBuiltinMcpServer[],
  allow: readonly string[],
  deny: readonly string[],
): OpencodeBuiltinMcpServer[] {
  return catalog.filter((server) => server.status !== 'deleted' && isMcpServerAllowed(server.name, allow, deny));
}

function normalizeCommandTokens(command: unknown): string[] | null {
  if (!Array.isArray(command)) {
    return null;
  }

  const tokens = command
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return tokens.length > 0 ? tokens : null;
}

/**
 * Whether a configured MCP entry's transport matches a catalog seed.
 * Env/headers/secrets may differ; type + command (local) or url (remote) must match.
 */
export function mcpServerTransportMatchesSeed(
  entry: { type?: unknown; command?: unknown; url?: unknown } | null | undefined,
  seed: OpencodeMcpServerSeed,
): boolean {
  if (!entry) {
    return false;
  }

  const entryType = typeof entry.type === 'string' ? entry.type.trim() : '';

  if (entryType !== seed.type) {
    return false;
  }

  if (seed.type === 'local') {
    const entryCommand = normalizeCommandTokens(entry.command);
    const seedCommand = normalizeCommandTokens(seed.command);

    if (!entryCommand || !seedCommand || entryCommand.length !== seedCommand.length) {
      return false;
    }

    return entryCommand.every((token, index) => token === seedCommand[index]);
  }

  const entryUrl = typeof entry.url === 'string' ? entry.url.trim() : '';
  const seedUrl = typeof seed.url === 'string' ? seed.url.trim() : '';

  return entryUrl.length > 0 && entryUrl === seedUrl;
}

/**
 * Whether a configured entry matches any materializable package/remote seed for a catalog server.
 */
export function mcpServerMatchesCatalogServer(
  entry: { type?: unknown; command?: unknown; url?: unknown } | null | undefined,
  catalogServer: OpencodeBuiltinMcpServer,
): boolean {
  const preferred = selectPreferredPackage(catalogServer.packages ?? []);

  if (preferred) {
    const fromPreferred = seedFromPackage(preferred);

    if (fromPreferred && mcpServerTransportMatchesSeed(entry, fromPreferred)) {
      return true;
    }
  }

  for (const pkg of catalogServer.packages ?? []) {
    const fromPackage = seedFromPackage(pkg);

    if (fromPackage && mcpServerTransportMatchesSeed(entry, fromPackage)) {
      return true;
    }
  }

  for (const remote of catalogServer.remotes ?? []) {
    const fromRemote = seedFromRemote(remote);

    if (fromRemote && mcpServerTransportMatchesSeed(entry, fromRemote)) {
      return true;
    }
  }

  return false;
}

function catalogLookupGet(
  catalogByName: ReadonlyMap<string, OpencodeBuiltinMcpServer> | Readonly<Record<string, OpencodeBuiltinMcpServer>>,
  name: string,
): OpencodeBuiltinMcpServer | undefined {
  if (catalogByName instanceof Map) {
    return catalogByName.get(name);
  }

  // `instanceof Map` does not narrow away `ReadonlyMap` in this union; cast the record branch.
  const record = catalogByName as Readonly<Record<string, OpencodeBuiltinMcpServer>>;

  return record[name];
}

/**
 * Resolves the allow/deny identity for a configured `mcp.servers` map key.
 *
 * Catalog identity requires a UI `registry` name whose {@link mcpServerConfigKey} equals the map key.
 * Key-only inference and `__`→`/` reversal are intentionally not used (those were spoofable).
 * When `catalogByName` is provided, the entry must also match a catalog seed transport; otherwise `custom`.
 *
 * `allow` / `deny` / `knownRegistryNames` are retained for call-site compatibility and are not used
 * for identity inference.
 */
export function resolveMcpAllowDenyIdentity(
  configKey: string,
  entry: { registry?: unknown; type?: unknown; command?: unknown; url?: unknown } | null | undefined,
  _allow: readonly string[] = [],
  _deny: readonly string[] = [],
  _knownRegistryNames: readonly string[] = [],
  catalogByName?: ReadonlyMap<string, OpencodeBuiltinMcpServer> | Readonly<Record<string, OpencodeBuiltinMcpServer>>,
): string {
  const key = configKey.trim();
  const registry = entry && typeof entry.registry === 'string' && entry.registry.trim() ? entry.registry.trim() : '';

  if (!registry || !key || mcpServerConfigKey(registry) !== key) {
    return CUSTOM_MCP_ALLOW_DENY_TOKEN;
  }

  if (catalogByName) {
    const catalogServer = catalogLookupGet(catalogByName, registry);

    if (!catalogServer || catalogServer.status === 'deleted' || !mcpServerMatchesCatalogServer(entry, catalogServer)) {
      return CUSTOM_MCP_ALLOW_DENY_TOKEN;
    }
  }

  return registry;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Strip spoofed / unverifiable `registry` claims from an overlay's `mcp.servers` map.
 * Fail closed: unknown registry names and transport mismatches lose catalog identity.
 */
export function stripUnverifiedMcpRegistryClaims(
  overlay: Record<string, unknown> | null | undefined,
  catalogByName: ReadonlyMap<string, OpencodeBuiltinMcpServer> | Readonly<Record<string, OpencodeBuiltinMcpServer>>,
): Record<string, unknown> {
  if (!isPlainObject(overlay)) {
    return {};
  }

  const config = { ...overlay };
  const mcp = isPlainObject(config['mcp']) ? { ...(config['mcp'] as Record<string, unknown>) } : null;

  if (!mcp || !isPlainObject(mcp['servers'])) {
    return config;
  }

  const servers = { ...(mcp['servers'] as Record<string, unknown>) };
  let changed = false;

  for (const [key, value] of Object.entries(servers)) {
    if (!isPlainObject(value) || typeof value['registry'] !== 'string' || !value['registry'].trim()) {
      continue;
    }

    const identity = resolveMcpAllowDenyIdentity(key, value, [], [], [], catalogByName);

    if (identity !== CUSTOM_MCP_ALLOW_DENY_TOKEN) {
      continue;
    }

    const next = { ...value };
    delete next['registry'];
    servers[key] = next;
    changed = true;
  }

  if (!changed) {
    return config;
  }

  mcp['servers'] = servers;
  config['mcp'] = mcp;

  return config;
}

/** Collect distinct non-empty `registry` strings from overlay `mcp.servers` entries. */
export function collectMcpRegistryClaims(overlay: Record<string, unknown> | null | undefined): string[] {
  if (!isPlainObject(overlay)) {
    return [];
  }

  const mcp = isPlainObject(overlay['mcp']) ? (overlay['mcp'] as Record<string, unknown>) : null;
  const servers = mcp && isPlainObject(mcp['servers']) ? (mcp['servers'] as Record<string, unknown>) : null;

  if (!servers) {
    return [];
  }

  const names = new Set<string>();

  for (const value of Object.values(servers)) {
    if (isPlainObject(value) && typeof value['registry'] === 'string' && value['registry'].trim()) {
      names.add(value['registry'].trim());
    }
  }

  return [...names];
}

function resolveInputValue(input: {
  value?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}): string | undefined {
  if (typeof input.value === 'string' && input.value.length > 0) {
    return input.value;
  }

  if (typeof input.default === 'string' && input.default.length > 0) {
    return input.default;
  }

  return undefined;
}

function isSecretOrUnsetRequired(input: {
  isSecret?: boolean;
  isRequired?: boolean;
  value?: string;
  default?: string;
}): boolean {
  if (input.isSecret === true) {
    return true;
  }

  if (input.isRequired === true && resolveInputValue(input) === undefined) {
    return true;
  }

  return false;
}

function collectKeyValueSplit(inputs: OpencodeBuiltinMcpKeyValueInput[] | undefined): {
  plain: Record<string, string>;
  secretNames: string[];
} {
  const plain: Record<string, string> = {};
  const secretNames: string[] = [];

  if (!inputs?.length) {
    return { plain, secretNames };
  }

  for (const input of inputs) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';

    if (!name) {
      continue;
    }

    if (isSecretOrUnsetRequired(input)) {
      if (!secretNames.includes(name)) {
        secretNames.push(name);
      }

      continue;
    }

    const value = resolveInputValue(input);

    if (value !== undefined) {
      plain[name] = value;
    }
  }

  return { plain, secretNames };
}

function resolveArgumentTokens(arg: OpencodeBuiltinMcpArgument): string[] {
  const resolved = resolveInputValue(arg);

  if (arg.type === 'named') {
    const flag = typeof arg.name === 'string' ? arg.name.trim() : '';

    if (!flag) {
      return [];
    }

    if (resolved === undefined) {
      // Skip unset named args (user must supply later); fixed values only at seed time.
      if (arg.isRequired || arg.isSecret) {
        return [];
      }

      return [flag];
    }

    return [`${flag}=${resolved}`];
  }

  // positional
  if (resolved === undefined) {
    return [];
  }

  return [resolved];
}

function resolveArgumentList(args: OpencodeBuiltinMcpArgument[] | undefined): string[] {
  if (!args?.length) {
    return [];
  }

  const tokens: string[] = [];

  for (const arg of args) {
    tokens.push(...resolveArgumentTokens(arg));
  }

  return tokens;
}

function packageIdentifierWithVersion(pkg: OpencodeBuiltinMcpPackage): string {
  const id = pkg.identifier.trim();
  const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';

  if (!version || version === 'latest') {
    return id;
  }

  // Scoped npm: @scope/name@version; unscoped: name@version (skip if already versioned)
  if (id.startsWith('@')) {
    return `${id}@${version}`;
  }

  if (id.includes('@')) {
    return id;
  }

  return `${id}@${version}`;
}

function runtimeCommandForPackage(pkg: OpencodeBuiltinMcpPackage): string[] | null {
  const hint = (pkg.runtimeHint ?? '').trim().toLowerCase();
  const registryType = (pkg.registryType ?? '').trim().toLowerCase();
  const runtimeArgs = resolveArgumentList(pkg.runtimeArguments);
  const packageArgs = resolveArgumentList(pkg.packageArguments);
  const identifier = packageIdentifierWithVersion(pkg);

  if (hint === 'npx' || (!hint && registryType === 'npm')) {
    return ['npx', ...runtimeArgs, '-y', identifier, ...packageArgs];
  }

  if (hint === 'uvx' || (!hint && (registryType === 'pypi' || registryType === 'python'))) {
    return ['uvx', ...runtimeArgs, identifier, ...packageArgs];
  }

  if (hint === 'docker' || registryType === 'oci') {
    return ['docker', 'run', '-i', '--rm', ...runtimeArgs, identifier, ...packageArgs];
  }

  if (hint === 'dnx' || registryType === 'nuget') {
    return ['dnx', ...runtimeArgs, identifier, ...packageArgs];
  }

  if (hint) {
    return [hint, ...runtimeArgs, identifier, ...packageArgs];
  }

  return null;
}

function isStdioTransport(pkg: OpencodeBuiltinMcpPackage): boolean {
  const type = pkg.transport?.type?.trim().toLowerCase();

  return !type || type === 'stdio';
}

function scorePackage(pkg: OpencodeBuiltinMcpPackage): number {
  const registryType = (pkg.registryType ?? '').trim().toLowerCase();
  const hint = (pkg.runtimeHint ?? '').trim().toLowerCase();
  let score = 0;

  if (registryType === 'npm' && isStdioTransport(pkg)) {
    score += 100;
  }

  if (hint === 'npx' || hint === 'uvx' || hint === 'docker' || hint === 'dnx') {
    score += 50;
  }

  if (isStdioTransport(pkg)) {
    score += 10;
  }

  if (runtimeCommandForPackage(pkg)) {
    score += 5;
  }

  return score;
}

/**
 * Picks the preferred package for seeding (npm+stdio first, then runtimeHint, else best scorer).
 */
export function selectPreferredPackage(packages: OpencodeBuiltinMcpPackage[]): OpencodeBuiltinMcpPackage | undefined {
  if (!packages.length) {
    return undefined;
  }

  const ranked = packages
    .map((pkg, index) => ({ pkg, index, score: scorePackage(pkg) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const best = ranked[0];

  return best && best.score > 0 ? best.pkg : packages[0];
}

function seedFromPackage(pkg: OpencodeBuiltinMcpPackage): OpencodeMcpServerSeed | null {
  const command = runtimeCommandForPackage(pkg);

  if (!command?.length) {
    return null;
  }

  const envSplit = collectKeyValueSplit(pkg.environmentVariables);
  const headerSplit = collectKeyValueSplit(pkg.transport?.headers);

  const seed: OpencodeMcpServerSeed = {
    type: 'local',
    command,
    secretEnv: envSplit.secretNames,
    secretHeaders: headerSplit.secretNames,
  };

  if (Object.keys(envSplit.plain).length > 0) {
    seed.environment = envSplit.plain;
  }

  return seed;
}

function seedFromRemote(remote: OpencodeBuiltinMcpRemote): OpencodeMcpServerSeed | null {
  const url = typeof remote.url === 'string' ? remote.url.trim() : '';

  if (!url) {
    return null;
  }

  const headerSplit = collectKeyValueSplit(remote.headers);

  const seed: OpencodeMcpServerSeed = {
    type: 'remote',
    url,
    secretEnv: [],
    secretHeaders: headerSplit.secretNames,
  };

  if (Object.keys(headerSplit.plain).length > 0) {
    seed.headers = headerSplit.plain;
  }

  return seed;
}

/**
 * Builds an OpenCode `mcp.servers` overlay seed from a catalog entry.
 * Returns `null` when neither a usable package nor remote can be materialized.
 */
export function seedMcpServerFromCatalog(entry: OpencodeBuiltinMcpServer): OpencodeMcpServerSeed | null {
  const attachRegistry = (seed: OpencodeMcpServerSeed): OpencodeMcpServerSeed => ({
    ...seed,
    registry: entry.name,
  });

  const preferred = selectPreferredPackage(entry.packages ?? []);

  if (preferred) {
    const fromPackage = seedFromPackage(preferred);

    if (fromPackage) {
      return attachRegistry(fromPackage);
    }
  }

  // Fall through packages in order if preferred failed to materialize.
  for (const pkg of entry.packages ?? []) {
    const fromPackage = seedFromPackage(pkg);

    if (fromPackage) {
      return attachRegistry(fromPackage);
    }
  }

  for (const remote of entry.remotes ?? []) {
    const fromRemote = seedFromRemote(remote);

    if (fromRemote) {
      return attachRegistry(fromRemote);
    }
  }

  return null;
}

/** Layer-secrets key for an MCP OAuth client secret. */
export function mcpOAuthClientSecretKey(serverKey: string): string {
  return `mcp.${serverKey.trim()}.oauth.client_secret`;
}
