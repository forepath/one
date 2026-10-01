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

/**
 * Resolves the allow/deny identity for a configured `mcp.servers` map key.
 * Prefers the UI-only `registry` field; otherwise matches `mcpServerConfigKey` against
 * known market ids from allow∪deny (and optional `knownRegistryNames`); else `custom`.
 */
export function resolveMcpAllowDenyIdentity(
  configKey: string,
  entry: { registry?: unknown } | null | undefined,
  allow: readonly string[],
  deny: readonly string[],
  knownRegistryNames: readonly string[] = [],
): string {
  if (entry && typeof entry.registry === 'string' && entry.registry.trim()) {
    return entry.registry.trim();
  }

  const key = configKey.trim();
  const candidates = new Set([
    ...normalizeAllowDenyIds(allow),
    ...normalizeAllowDenyIds(deny),
    ...knownRegistryNames.map((name) => name.trim()).filter((name) => name.length > 0),
  ]);

  candidates.delete(CUSTOM_MCP_ALLOW_DENY_TOKEN);

  for (const name of candidates) {
    if (mcpServerConfigKey(name) === key) {
      return name;
    }
  }

  // Hydration convention: config keys reverse `__` → `/` for catalog lookup.
  if (key.includes('__')) {
    const reversed = key.replace(/__/g, '/');

    if (reversed !== key) {
      return reversed;
    }
  }

  return CUSTOM_MCP_ALLOW_DENY_TOKEN;
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
