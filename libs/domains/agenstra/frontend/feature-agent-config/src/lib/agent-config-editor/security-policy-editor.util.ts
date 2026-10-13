import {
  EGRESS_CONFIG_ROOT,
  MESSAGE_FILTERS_CONFIG_ROOT,
  evaluateEgressDestination,
  evaluateMessageFilters,
  resolveEffectiveEgressPolicy,
  resolveEffectiveMessageFilters,
  type EffectiveEgressPolicy,
  type EffectiveMessageFilterRule,
  type EffectivePlatformSecurityPolicy,
  type EgressEvaluationResult,
  type JsonObject,
  type MessageFilterEvaluation,
  type PlatformPolicyLayer,
} from '@forepath/agenstra/shared/util-opencode-config';

export type SecurityEditorLayer = 'global' | 'workspace' | 'agent';

/** Lists edited on the Web traffic tab (inherited items are read-only, local items editable). */
export const EGRESS_EDITOR_LIST_KEYS = ['allow_hosts', 'deny_hosts', 'deny_url_patterns'] as const;
export type EgressEditorListKey = (typeof EGRESS_EDITOR_LIST_KEYS)[number];

export function editorLayerSource(layer: SecurityEditorLayer): PlatformPolicyLayer {
  return layer === 'agent' ? 'environment' : layer;
}

/** Parent layers a layer inherits from (highest precedence first). */
export function parentLayerSources(layer: SecurityEditorLayer): PlatformPolicyLayer[] {
  if (layer === 'global') {
    return [];
  }

  return layer === 'workspace' ? ['global'] : ['global', 'workspace'];
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Policy contributed by the parent layers, reconstructed from the server-resolved policy (entries of the
 * current layer are removed so the draft can replace them).
 */
export function parentEgressPolicy(
  serverPolicy: EffectivePlatformSecurityPolicy | null | undefined,
  layer: SecurityEditorLayer,
): EffectiveEgressPolicy {
  const own = editorLayerSource(layer);
  const base = serverPolicy?.egress ?? resolveEffectiveEgressPolicy([]);
  const keep = <T extends { source: PlatformPolicyLayer }>(entries: readonly T[]) =>
    entries.filter((entry) => entry.source !== own);
  const sources = { ...base.scalarSources };
  const defaults = resolveEffectiveEgressPolicy([]);
  const scalar = <K extends 'mode' | 'blockPrivateNetworks' | 'blockIpLiterals' | 'logAllowed'>(key: K) =>
    base.scalarSources[key] === own ? defaults[key] : base[key];

  for (const key of Object.keys(sources) as Array<keyof typeof sources>) {
    if (sources[key] === own) {
      sources[key] = null;
    }
  }

  return {
    mode: scalar('mode'),
    allowHosts: keep(base.allowHosts),
    denyHosts: keep(base.denyHosts),
    denyUrlPatterns: keep(base.denyUrlPatterns),
    networkAllow: keep(base.networkAllow),
    blockPrivateNetworks: scalar('blockPrivateNetworks'),
    blockIpLiterals: scalar('blockIpLiterals'),
    logAllowed: scalar('logAllowed'),
    scalarSources: sources,
  };
}

/**
 * Effective egress policy for the editor draft: parent layers (from the server) + the current layer's
 * composed draft overlay. Parent scalars win (they are locked for lower layers anyway).
 */
export function draftEgressPolicy(
  serverPolicy: EffectivePlatformSecurityPolicy | null | undefined,
  layer: SecurityEditorLayer,
  draftOverlay: JsonObject,
): EffectiveEgressPolicy {
  const parent = parentEgressPolicy(serverPolicy, layer);
  const own = resolveEffectiveEgressPolicy([{ source: editorLayerSource(layer), overlay: draftOverlay }]);
  const merge = <T extends { value: string }>(parentEntries: readonly T[], ownEntries: readonly T[]) => [
    ...parentEntries,
    ...ownEntries.filter((entry) => !parentEntries.some((existing) => existing.value === entry.value)),
  ];
  const pick = <K extends 'mode' | 'blockPrivateNetworks' | 'blockIpLiterals' | 'logAllowed'>(key: K) =>
    parent.scalarSources[key] !== null
      ? { value: parent[key], source: parent.scalarSources[key] }
      : { value: own[key], source: own.scalarSources[key] };
  const mode = pick('mode');
  const blockPrivateNetworks = pick('blockPrivateNetworks');
  const blockIpLiterals = pick('blockIpLiterals');
  const logAllowed = pick('logAllowed');

  return {
    mode: mode.value,
    allowHosts: merge(parent.allowHosts, own.allowHosts),
    denyHosts: merge(parent.denyHosts, own.denyHosts),
    denyUrlPatterns: merge(parent.denyUrlPatterns, own.denyUrlPatterns),
    networkAllow: [...parent.networkAllow, ...own.networkAllow],
    blockPrivateNetworks: blockPrivateNetworks.value,
    blockIpLiterals: blockIpLiterals.value,
    logAllowed: logAllowed.value,
    scalarSources: {
      mode: mode.source,
      blockPrivateNetworks: blockPrivateNetworks.source,
      blockIpLiterals: blockIpLiterals.source,
      logAllowed: logAllowed.source,
    },
  };
}

/** Split a tester input (hostname, host:port or URL) into host / URL / scheme. */
export function parseEgressTestInput(raw: string): { host: string; url?: string; scheme?: 'http' | 'https' } | null {
  const value = raw.trim();

  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);

      return {
        host: parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
        url: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
        scheme: parsed.protocol === 'http:' ? 'http' : 'https',
      };
    } catch {
      return null;
    }
  }

  const head = value.split('/')[0] ?? '';
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(head);
  const host = bracketed
    ? bracketed[1]
    : (head.match(/:/g) ?? []).length === 1
      ? head.slice(0, head.indexOf(':'))
      : head;

  return host ? { host: host.toLowerCase() } : null;
}

export function testEgressDestination(
  policy: EffectiveEgressPolicy,
  raw: string,
): (EgressEvaluationResult & { host: string }) | null {
  const parsed = parseEgressTestInput(raw);

  if (!parsed) {
    return null;
  }

  return {
    host: parsed.host,
    ...evaluateEgressDestination(policy, parsed.host, { url: parsed.url, scheme: parsed.scheme }),
  };
}

/** Effective message filter rules for the editor draft: inherited parent rules + the draft rules of this layer. */
export function draftMessageFilterRules(
  serverPolicy: EffectivePlatformSecurityPolicy | null | undefined,
  layer: SecurityEditorLayer,
  draftOverlay: JsonObject,
): EffectiveMessageFilterRule[] {
  const own = editorLayerSource(layer);
  const parents = (serverPolicy?.messageFilters ?? []).filter((rule) => rule.source !== own);
  const local = resolveEffectiveMessageFilters([{ source: own, overlay: draftOverlay }]);

  return [...parents, ...local];
}

export function testMessageFilters(
  rules: readonly EffectiveMessageFilterRule[],
  message: string,
  direction: 'incoming' | 'outgoing',
): MessageFilterEvaluation {
  return evaluateMessageFilters(rules, message, direction);
}

/** Parse a comma / newline separated destination list (network exceptions). */
export function parseDestinationList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Read the egress overlay of a composed layer draft. */
export function egressOverlay(draft: JsonObject): JsonObject {
  const egress = draft[EGRESS_CONFIG_ROOT];

  return isPlainObject(egress) ? egress : {};
}

/** Read the message filter rules of a composed layer draft. */
export function messageFilterRules(draft: JsonObject): JsonObject[] {
  const rules = draft[MESSAGE_FILTERS_CONFIG_ROOT];

  return Array.isArray(rules) ? rules.filter(isPlainObject) : [];
}

/** Next free default rule name within a layer (`Rule 1`, `Rule 2`, ...). */
export function nextMessageFilterRuleName(existing: readonly JsonObject[], prefix = 'Rule'): string {
  const names = new Set(existing.map((rule) => String(rule['name'] ?? '').trim()));
  let index = existing.length + 1;

  while (names.has(`${prefix} ${index}`)) {
    index += 1;
  }

  return `${prefix} ${index}`;
}
