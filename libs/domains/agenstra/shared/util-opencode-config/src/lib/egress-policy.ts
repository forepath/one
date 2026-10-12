import {
  EGRESS_CONFIG_ROOT,
  isPlainPolicyObject,
  orderPolicyLayersHighToLow,
  policyValidationError,
  type PlatformPolicyLayer,
  type PlatformPolicyLayerInput,
} from './platform-policy';
import { hasNestedQuantifier } from './message-filters';
import type { JsonObject } from './types';

/**
 * Egress (web traffic) policy enforced by the per-agent egress guard sidecar.
 *
 * - `off`      — no guard enforcement (default; agents without a guard keep their legacy network)
 * - `monitor`  — all traffic allowed; would-be blocks are recorded as `observed`
 * - `enforce`  — allow / deny lists apply (deny wins; empty allowlist = unrestricted)
 * - `offline`  — all egress blocked (loopback and inbound manager traffic still work)
 */
export const EGRESS_MODES = ['off', 'monitor', 'enforce', 'offline'] as const;
export type EgressMode = (typeof EGRESS_MODES)[number];

/** Scalar settings: the highest layer that sets one wins and locks it for lower layers. */
export const EGRESS_SCALAR_KEYS = ['mode', 'block_private_networks', 'block_ip_literals', 'log_allowed'] as const;
export type EgressScalarKey = (typeof EGRESS_SCALAR_KEYS)[number];

/** List settings: entries concatenate across layers; lower layers may append but never remove. */
export const EGRESS_LIST_KEYS = ['allow_hosts', 'deny_hosts', 'deny_url_patterns', 'network_allow'] as const;
export type EgressListKey = (typeof EGRESS_LIST_KEYS)[number];

export const EGRESS_NETWORK_PROTOCOLS = ['tcp', 'udp'] as const;
export type EgressNetworkProtocol = (typeof EGRESS_NETWORK_PROTOCOLS)[number];

export const EGRESS_MAX_HOST_ENTRIES = 5000;
export const EGRESS_MAX_URL_PATTERNS = 500;
export const EGRESS_MAX_URL_PATTERN_LENGTH = 512;
export const EGRESS_MAX_NETWORK_RULES = 100;
export const EGRESS_MAX_NETWORK_DESTINATIONS = 64;
export const EGRESS_MAX_HOST_LENGTH = 253;

export const EGRESS_DEFAULTS = {
  mode: 'off' as EgressMode,
  blockPrivateNetworks: true,
  blockIpLiterals: false,
  logAllowed: true,
};

/** Rule identifiers reported by the guard (squid annotations / DNS / netfilter categories). */
export const EGRESS_RULES = [
  'offline',
  'deny_host',
  'private_network',
  'ip_literal',
  'deny_url',
  'not_allowlisted',
  'quic',
  'dns_over_tls',
  'undeclared_protocol',
  'guard',
] as const;
export type EgressRule = (typeof EGRESS_RULES)[number];

export const EGRESS_DECISIONS = ['allowed', 'blocked', 'observed', 'error'] as const;
export type EgressDecision = (typeof EGRESS_DECISIONS)[number];

export const EGRESS_EVENT_KINDS = ['web', 'dns', 'network', 'guard'] as const;
export type EgressEventKind = (typeof EGRESS_EVENT_KINDS)[number];

/** Non-web L3/L4 exception (destinations are IPs / CIDRs; ports `22` or `1000-2000`). */
export interface EgressNetworkAllowRule {
  protocol: EgressNetworkProtocol;
  ports: string;
  destinations: string[];
  description?: string;
}

/** Stored (snake_case) layer overlay under `egress`. */
export interface EgressConfigOverlay {
  mode?: EgressMode;
  allow_hosts?: string[];
  deny_hosts?: string[];
  deny_url_patterns?: string[];
  network_allow?: EgressNetworkAllowRule[];
  block_private_networks?: boolean;
  block_ip_literals?: boolean;
  log_allowed?: boolean;
}

export interface EffectiveEgressEntry {
  value: string;
  source: PlatformPolicyLayer;
}

export interface EffectiveEgressNetworkRule extends EgressNetworkAllowRule {
  source: PlatformPolicyLayer;
}

/** Fully resolved policy shipped to the agent manager (camelCase wire shape). */
export interface EffectiveEgressPolicy {
  mode: EgressMode;
  allowHosts: EffectiveEgressEntry[];
  denyHosts: EffectiveEgressEntry[];
  denyUrlPatterns: EffectiveEgressEntry[];
  networkAllow: EffectiveEgressNetworkRule[];
  blockPrivateNetworks: boolean;
  blockIpLiterals: boolean;
  logAllowed: boolean;
  /** Layer that set each scalar (null = platform default). */
  scalarSources: Record<'mode' | 'blockPrivateNetworks' | 'blockIpLiterals' | 'logAllowed', PlatformPolicyLayer | null>;
}

export type EgressHostKind = 'domain' | 'ipv4' | 'ipv6';

export interface NormalizedEgressHost {
  kind: EgressHostKind;
  /** Canonical lowercase value (domains without wildcard prefix, IPs / CIDRs normalized). */
  value: string;
  /** Prefix length for IP entries (32 / 128 when a single address). */
  prefix?: number;
}

export interface EgressEvaluationResult {
  decision: Exclude<EgressDecision, 'error'>;
  rule: EgressRule | null;
  matchedEntry?: string;
  source?: PlatformPolicyLayer | null;
}

// ---------------------------------------------------------------------------
// IP helpers (browser-safe; no Node `net`)
// ---------------------------------------------------------------------------

function parseIpv4(raw: string): number[] | null {
  const parts = raw.split('.');

  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const value = Number(part);

    if (value > 255 || (part.length > 1 && part.startsWith('0'))) {
      return null;
    }

    octets.push(value);
  }

  return octets;
}

/** Parse IPv6 into 8 hextets (supports `::` compression and a trailing dotted IPv4). */
function parseIpv6(raw: string): number[] | null {
  let input = raw.trim().toLowerCase();

  if (input.startsWith('[') && input.endsWith(']')) {
    input = input.slice(1, -1);
  }

  if (!input.includes(':') || input.includes('%')) {
    return null;
  }

  let tailV4: number[] | null = null;
  const lastColon = input.lastIndexOf(':');
  const tail = input.slice(lastColon + 1);

  if (tail.includes('.')) {
    tailV4 = parseIpv4(tail);

    if (!tailV4) {
      return null;
    }

    input = `${input.slice(0, lastColon + 1)}0:0`;
  }

  const doubleColon = input.split('::');

  if (doubleColon.length > 2) {
    return null;
  }

  const parseGroup = (group: string): number[] | null => {
    if (!group) {
      return [];
    }

    const out: number[] = [];

    for (const part of group.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) {
        return null;
      }

      out.push(parseInt(part, 16));
    }

    return out;
  };

  const head = parseGroup(doubleColon[0]);
  const rest = doubleColon.length === 2 ? parseGroup(doubleColon[1]) : [];

  if (!head || !rest) {
    return null;
  }

  let hextets: number[];

  if (doubleColon.length === 2) {
    const missing = 8 - head.length - rest.length;

    if (missing < 1) {
      return null;
    }

    hextets = [...head, ...new Array<number>(missing).fill(0), ...rest];
  } else {
    hextets = head;
  }

  if (hextets.length !== 8) {
    return null;
  }

  if (tailV4) {
    hextets[6] = (tailV4[0] << 8) | tailV4[1];
    hextets[7] = (tailV4[2] << 8) | tailV4[3];
  }

  return hextets;
}

function ipv4ToBits(octets: number[]): number[] {
  const bits: number[] = [];

  for (const octet of octets) {
    for (let i = 7; i >= 0; i--) {
      bits.push((octet >> i) & 1);
    }
  }

  return bits;
}

function ipv6ToBits(hextets: number[]): number[] {
  const bits: number[] = [];

  for (const hextet of hextets) {
    for (let i = 15; i >= 0; i--) {
      bits.push((hextet >> i) & 1);
    }
  }

  return bits;
}

function prefixMatches(addressBits: number[], networkBits: number[], prefix: number): boolean {
  for (let i = 0; i < prefix; i++) {
    if (addressBits[i] !== networkBits[i]) {
      return false;
    }
  }

  return true;
}

function formatIpv6(hextets: number[]): string {
  // Canonical RFC 5952-ish compression of the longest zero run.
  let bestStart = -1;
  let bestLength = 0;

  for (let i = 0; i < 8; ) {
    if (hextets[i] !== 0) {
      i++;
      continue;
    }

    let j = i;

    while (j < 8 && hextets[j] === 0) {
      j++;
    }

    if (j - i > bestLength && j - i > 1) {
      bestStart = i;
      bestLength = j - i;
    }

    i = j;
  }

  const parts = hextets.map((value) => value.toString(16));

  if (bestStart === -1) {
    return parts.join(':');
  }

  const head = parts.slice(0, bestStart).join(':');
  const tail = parts.slice(bestStart + bestLength).join(':');

  return `${head}::${tail}`;
}

interface ParsedIpEntry {
  kind: 'ipv4' | 'ipv6';
  bits: number[];
  prefix: number;
  canonical: string;
}

function parseIpOrCidr(raw: string): ParsedIpEntry | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const slash = trimmed.indexOf('/');
  const address = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const prefixRaw = slash === -1 ? null : trimmed.slice(slash + 1);

  const v4 = parseIpv4(address);

  if (v4) {
    const prefix = prefixRaw === null ? 32 : /^\d{1,2}$/.test(prefixRaw) ? Number(prefixRaw) : NaN;

    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return null;
    }

    const bits = ipv4ToBits(v4);
    // Normalize host bits away so `10.1.2.3/8` becomes `10.0.0.0/8`.
    const masked = bits.map((bit, index) => (index < prefix ? bit : 0));
    const octets = [0, 1, 2, 3].map((octet) =>
      masked.slice(octet * 8, octet * 8 + 8).reduce((acc, bit) => (acc << 1) | bit, 0),
    );
    const canonicalAddress = octets.join('.');

    return {
      kind: 'ipv4',
      bits: masked,
      prefix,
      canonical: prefix === 32 ? canonicalAddress : `${canonicalAddress}/${prefix}`,
    };
  }

  const v6 = parseIpv6(address);

  if (v6) {
    const prefix = prefixRaw === null ? 128 : /^\d{1,3}$/.test(prefixRaw) ? Number(prefixRaw) : NaN;

    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
      return null;
    }

    const bits = ipv6ToBits(v6);
    const masked = bits.map((bit, index) => (index < prefix ? bit : 0));
    const hextets = [0, 1, 2, 3, 4, 5, 6, 7].map((group) =>
      masked.slice(group * 16, group * 16 + 16).reduce((acc, bit) => (acc << 1) | bit, 0),
    );
    const canonicalAddress = formatIpv6(hextets);

    return {
      kind: 'ipv6',
      bits: masked,
      prefix,
      canonical: prefix === 128 ? canonicalAddress : `${canonicalAddress}/${prefix}`,
    };
  }

  return null;
}

const PRIVATE_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
] as const;

const PRIVATE_IPV6_CIDRS = ['::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8'] as const;

/** Reserved / internal ranges blocked by `block_private_networks` (also rendered into the guard). */
export const EGRESS_PRIVATE_NETWORK_CIDRS: readonly string[] = [...PRIVATE_IPV4_CIDRS, ...PRIVATE_IPV6_CIDRS];

const PRIVATE_RANGES: ParsedIpEntry[] = EGRESS_PRIVATE_NETWORK_CIDRS.map(
  (cidr) => parseIpOrCidr(cidr) as ParsedIpEntry,
);

function ipMatchesEntry(address: ParsedIpEntry, entry: ParsedIpEntry): boolean {
  return address.kind === entry.kind && prefixMatches(address.bits, entry.bits, entry.prefix);
}

/** Whether a literal IP address falls into a private / reserved range. */
export function isPrivateNetworkAddress(host: string): boolean {
  const parsed = parseIpOrCidr(stripHostDecorations(host));

  if (!parsed || parsed.prefix !== (parsed.kind === 'ipv4' ? 32 : 128)) {
    return false;
  }

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) → evaluate the embedded IPv4 address.
  if (parsed.kind === 'ipv6' && parsed.bits.slice(0, 80).every((bit) => bit === 0)) {
    const mappedMarker = parsed.bits.slice(80, 96).every((bit) => bit === 1);

    if (mappedMarker) {
      const v4Bits = parsed.bits.slice(96);
      const octets = [0, 1, 2, 3].map((octet) =>
        v4Bits.slice(octet * 8, octet * 8 + 8).reduce((acc, bit) => (acc << 1) | bit, 0),
      );

      return isPrivateNetworkAddress(octets.join('.'));
    }
  }

  return PRIVATE_RANGES.some((range) => ipMatchesEntry(parsed, range));
}

function stripHostDecorations(host: string): string {
  let value = host.trim().toLowerCase();

  if (value.startsWith('[') && value.includes(']')) {
    value = value.slice(1, value.indexOf(']'));
  }

  return value.replace(/\.$/, '');
}

/** Whether a host string is an IP literal (v4 / v6, optionally bracketed). */
export function isIpLiteralHost(host: string): boolean {
  const value = stripHostDecorations(host);

  return parseIpv4(value) !== null || parseIpv6(value) !== null;
}

// ---------------------------------------------------------------------------
// Host entry normalization / matching
// ---------------------------------------------------------------------------

const DOMAIN_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

/**
 * Normalize an allow/deny host entry.
 * Domains match themselves and every subdomain (`example.com`, `*.example.com` and `.example.com`
 * are equivalent). IP literals and CIDRs (v4 / v6) match by address.
 * Returns null for invalid input (URLs, ports, paths, whitespace…).
 */
export function normalizeEgressHost(raw: unknown): NormalizedEgressHost | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim().toLowerCase();

  if (!trimmed || trimmed.length > EGRESS_MAX_HOST_LENGTH + 2 || /\s/.test(trimmed)) {
    return null;
  }

  const ip = parseIpOrCidr(trimmed.startsWith('[') ? trimmed.replace(/^\[([^\]]+)\]/, '$1') : trimmed);

  if (ip) {
    return { kind: ip.kind, value: ip.canonical, prefix: ip.prefix };
  }

  let domain = trimmed;

  if (domain.startsWith('*.')) {
    domain = domain.slice(2);
  } else if (domain.startsWith('.')) {
    domain = domain.slice(1);
  }

  domain = domain.replace(/\.$/, '');

  if (!domain || domain.length > EGRESS_MAX_HOST_LENGTH) {
    return null;
  }

  const labels = domain.split('.');

  if (labels.some((label) => !DOMAIN_LABEL.test(label))) {
    return null;
  }

  // Bare numeric dotted strings that failed IPv4 parsing (e.g. 999.1.1.1) are not hostnames.
  if (labels.every((label) => /^\d+$/.test(label))) {
    return null;
  }

  return { kind: 'domain', value: domain };
}

/** Whether a destination host matches a normalized entry (domain suffix or IP / CIDR). */
export function egressHostMatchesEntry(host: string, entry: NormalizedEgressHost): boolean {
  const target = stripHostDecorations(host);

  if (!target) {
    return false;
  }

  if (entry.kind === 'domain') {
    return target === entry.value || target.endsWith(`.${entry.value}`);
  }

  const address = parseIpOrCidr(target);
  const network = parseIpOrCidr(entry.value);

  if (!address || !network) {
    return false;
  }

  return ipMatchesEntry(address, network);
}

function findMatchingEntry(host: string, entries: readonly EffectiveEgressEntry[]): EffectiveEgressEntry | undefined {
  for (const entry of entries) {
    const normalized = normalizeEgressHost(entry.value);

    if (normalized && egressHostMatchesEntry(host, normalized)) {
      return entry;
    }
  }

  return undefined;
}

/**
 * Drop entries that are redundant because a broader entry of the same list already covers them
 * (Squid rejects / warns on overlapping `dstdomain` values). Keeps first occurrence order.
 */
export function compactEgressHostEntries<T extends { value: string }>(entries: readonly T[]): T[] {
  const normalized = entries
    .map((entry) => ({ entry, host: normalizeEgressHost(entry.value) }))
    .filter((item): item is { entry: T; host: NormalizedEgressHost } => item.host !== null);
  const result: T[] = [];
  const seen = new Set<string>();

  for (const { entry, host } of normalized) {
    if (seen.has(`${host.kind}:${host.value}`)) {
      continue;
    }

    const coveredByOther = normalized.some(
      (other) =>
        other.host !== host &&
        other.host.kind === host.kind &&
        other.host.value !== host.value &&
        (host.kind === 'domain'
          ? host.value.endsWith(`.${other.host.value}`)
          : (other.host.prefix ?? 0) < (host.prefix ?? 0) &&
            egressHostMatchesEntry(host.value.split('/')[0], other.host)),
    );

    if (coveredByOther) {
      continue;
    }

    seen.add(`${host.kind}:${host.value}`);
    result.push({ ...entry, value: host.value });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertStringList(value: unknown, path: string, max: number): string[] {
  if (!Array.isArray(value)) {
    throw policyValidationError(`'${path}' must be an array of strings`);
  }

  if (value.length > max) {
    throw policyValidationError(`'${path}' may contain at most ${max} entries`);
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !item.trim()) {
      throw policyValidationError(`'${path}/${index}' must be a non-empty string`);
    }
  }

  return value as string[];
}

const PORT_SPEC = /^(\d{1,5})(?:-(\d{1,5}))?$/;

/** Parse `22` / `1000-2000` into an inclusive range; null when invalid. */
export function parseEgressPortSpec(spec: string): { from: number; to: number } | null {
  const match = PORT_SPEC.exec(spec.trim());

  if (!match) {
    return null;
  }

  const from = Number(match[1]);
  const to = match[2] !== undefined ? Number(match[2]) : from;

  if (from < 1 || to > 65535 || from > to) {
    return null;
  }

  return { from, to };
}

/** Validate a POSIX/JS-compatible URL pattern used by the guard for plain HTTP URLs. */
export function validateEgressUrlPattern(pattern: string): string | null {
  if (pattern.length > EGRESS_MAX_URL_PATTERN_LENGTH) {
    return `pattern exceeds ${EGRESS_MAX_URL_PATTERN_LENGTH} characters`;
  }

  // One pattern per ACL file line: whitespace / control characters would split or corrupt it.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(pattern)) {
    return 'pattern must not contain whitespace or control characters';
  }

  // A leading `#` turns the ACL file line into a comment (the rule would be silently ignored).
  if (pattern.startsWith('#')) {
    return 'pattern must not start with "#"';
  }

  // The guard uses POSIX extended regular expressions: reject JS-only syntax (backreferences,
  // lookarounds, non-capturing / named groups, lazy quantifiers, shorthand classes) that would
  // make the guard reject the whole policy bundle.
  if (/\\[1-9]|\(\?/.test(pattern)) {
    return 'pattern must not use backreferences, lookarounds or special groups';
  }

  if (/[*+?}]\?/.test(pattern.replace(/\\./g, ''))) {
    return 'pattern must not use lazy quantifiers';
  }

  if (/\\[dDwWsSbBpPuxck0]/.test(pattern)) {
    return 'pattern must not use JavaScript escape classes (use POSIX bracket expressions instead)';
  }

  if (hasNestedQuantifier(pattern)) {
    return 'pattern uses nested quantifiers or overlapping repeated alternatives, which risk catastrophic backtracking';
  }

  try {
    new RegExp(pattern, 'i');
  } catch {
    return 'pattern is not a valid regular expression';
  }

  return null;
}

/**
 * Validate the shape of an `egress` overlay (partial; only present keys are checked).
 * @throws OpencodeConfigValidationError
 */
export function assertValidEgressConfig(value: unknown, path = `/${EGRESS_CONFIG_ROOT}`): void {
  if (value === undefined) {
    return;
  }

  if (!isPlainPolicyObject(value)) {
    throw policyValidationError(`'${path}' must be an object`);
  }

  const allowedKeys = new Set<string>([...EGRESS_SCALAR_KEYS, ...EGRESS_LIST_KEYS]);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));

  if (unknown.length > 0) {
    throw policyValidationError(`Unknown keys at '${path}': ${unknown.join(', ')}`);
  }

  if (value['mode'] !== undefined && !(EGRESS_MODES as readonly unknown[]).includes(value['mode'])) {
    throw policyValidationError(`'${path}/mode' must be one of: ${EGRESS_MODES.join(', ')}`);
  }

  for (const key of ['block_private_networks', 'block_ip_literals', 'log_allowed'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      throw policyValidationError(`'${path}/${key}' must be a boolean`);
    }
  }

  for (const key of ['allow_hosts', 'deny_hosts'] as const) {
    if (value[key] === undefined) {
      continue;
    }

    const list = assertStringList(value[key], `${path}/${key}`, EGRESS_MAX_HOST_ENTRIES);

    for (const [index, entry] of list.entries()) {
      if (!normalizeEgressHost(entry)) {
        throw policyValidationError(
          `'${path}/${key}/${index}' ('${entry}') must be a hostname (optionally *.prefixed), an IP address or a CIDR`,
        );
      }
    }
  }

  if (value['deny_url_patterns'] !== undefined) {
    const list = assertStringList(value['deny_url_patterns'], `${path}/deny_url_patterns`, EGRESS_MAX_URL_PATTERNS);

    for (const [index, pattern] of list.entries()) {
      const problem = validateEgressUrlPattern(pattern);

      if (problem) {
        throw policyValidationError(`'${path}/deny_url_patterns/${index}': ${problem}`);
      }
    }
  }

  if (value['network_allow'] !== undefined) {
    const rules = value['network_allow'];

    if (!Array.isArray(rules)) {
      throw policyValidationError(`'${path}/network_allow' must be an array`);
    }

    if (rules.length > EGRESS_MAX_NETWORK_RULES) {
      throw policyValidationError(`'${path}/network_allow' may contain at most ${EGRESS_MAX_NETWORK_RULES} rules`);
    }

    for (const [index, rule] of rules.entries()) {
      const rulePath = `${path}/network_allow/${index}`;

      if (!isPlainPolicyObject(rule)) {
        throw policyValidationError(`'${rulePath}' must be an object`);
      }

      const ruleKeys = Object.keys(rule).filter(
        (key) => !['protocol', 'ports', 'destinations', 'description'].includes(key),
      );

      if (ruleKeys.length > 0) {
        throw policyValidationError(`Unknown keys at '${rulePath}': ${ruleKeys.join(', ')}`);
      }

      if (!(EGRESS_NETWORK_PROTOCOLS as readonly unknown[]).includes(rule['protocol'])) {
        throw policyValidationError(`'${rulePath}/protocol' must be one of: ${EGRESS_NETWORK_PROTOCOLS.join(', ')}`);
      }

      if (typeof rule['ports'] !== 'string' || !parseEgressPortSpec(rule['ports'])) {
        throw policyValidationError(`'${rulePath}/ports' must be a port (e.g. 22) or a range (e.g. 1000-2000)`);
      }

      const destinations = assertStringList(
        rule['destinations'],
        `${rulePath}/destinations`,
        EGRESS_MAX_NETWORK_DESTINATIONS,
      );

      if (destinations.length === 0) {
        throw policyValidationError(`'${rulePath}/destinations' must contain at least one IP address or CIDR`);
      }

      for (const [destinationIndex, destination] of destinations.entries()) {
        const normalized = normalizeEgressHost(destination);

        if (!normalized || normalized.kind === 'domain') {
          throw policyValidationError(
            `'${rulePath}/destinations/${destinationIndex}' ('${destination}') must be an IP address or CIDR`,
          );
        }
      }

      if (
        rule['description'] !== undefined &&
        (typeof rule['description'] !== 'string' || rule['description'].length > 200)
      ) {
        throw policyValidationError(`'${rulePath}/description' must be a string of at most 200 characters`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Merge (cross-layer + within-layer compose)
// ---------------------------------------------------------------------------

/**
 * Merge two `egress` overlays (left = lower precedence, right = higher precedence):
 * scalars from `right` win, lists concatenate (deduplicated by JSON identity).
 */
export function mergeEgressOverlays(left: unknown, right: unknown): JsonObject {
  const base = isPlainPolicyObject(left) ? left : {};
  const overlay = isPlainPolicyObject(right) ? right : {};
  const result: JsonObject = {};

  for (const key of EGRESS_SCALAR_KEYS) {
    if (overlay[key] !== undefined) {
      result[key] = overlay[key];
    } else if (base[key] !== undefined) {
      result[key] = base[key];
    }
  }

  for (const key of EGRESS_LIST_KEYS) {
    const leftList = Array.isArray(base[key]) ? (base[key] as unknown[]) : [];
    const rightList = Array.isArray(overlay[key]) ? (overlay[key] as unknown[]) : [];

    if (!Array.isArray(base[key]) && !Array.isArray(overlay[key])) {
      continue;
    }

    const seen = new Set<string>();
    const merged: unknown[] = [];

    for (const item of [...leftList, ...rightList]) {
      const serialized = JSON.stringify(item);

      if (seen.has(serialized)) {
        continue;
      }

      seen.add(serialized);
      merged.push(structuredClone(item));
    }

    result[key] = merged;
  }

  // Preserve unknown keys verbatim so validation can report them instead of silently dropping data.
  for (const [key, value] of Object.entries(base)) {
    if (!(key in result) && !(EGRESS_SCALAR_KEYS as readonly string[]).includes(key)) {
      result[key] = structuredClone(value);
    }
  }

  for (const [key, value] of Object.entries(overlay)) {
    if (
      !(EGRESS_SCALAR_KEYS as readonly string[]).includes(key) &&
      !(EGRESS_LIST_KEYS as readonly string[]).includes(key)
    ) {
      result[key] = structuredClone(value);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Effective resolution
// ---------------------------------------------------------------------------

function readEgressOverlay(overlay: PlatformPolicyLayerInput['overlay']): JsonObject {
  if (!isPlainPolicyObject(overlay)) {
    return {};
  }

  const egress = overlay[EGRESS_CONFIG_ROOT];

  return isPlainPolicyObject(egress) ? egress : {};
}

function pushUniqueEntries(
  target: EffectiveEgressEntry[],
  values: unknown,
  source: PlatformPolicyLayer,
  normalize: (raw: string) => string | null,
): void {
  if (!Array.isArray(values)) {
    return;
  }

  for (const raw of values) {
    if (typeof raw !== 'string') {
      continue;
    }

    const value = normalize(raw);

    if (!value || target.some((entry) => entry.value === value)) {
      continue;
    }

    target.push({ value, source });
  }
}

/** Whether `value` (domain / IP / CIDR) is fully covered by one of the `bounds` entries. */
function egressEntryCoveredBy(value: string, bounds: readonly EffectiveEgressEntry[]): boolean {
  const child = normalizeEgressHost(value);

  if (!child) {
    return false;
  }

  return bounds.some((bound) => {
    const parent = normalizeEgressHost(bound.value);

    if (!parent) {
      return false;
    }

    if (child.kind === 'domain' || parent.kind === 'domain') {
      return child.kind === 'domain' && parent.kind === 'domain' && egressHostMatchesEntry(child.value, parent);
    }

    const childNet = parseIpOrCidr(child.value);
    const parentNet = parseIpOrCidr(parent.value);

    return (
      !!childNet &&
      !!parentNet &&
      childNet.kind === parentNet.kind &&
      childNet.prefix >= parentNet.prefix &&
      prefixMatches(childNet.bits, parentNet.bits, parentNet.prefix)
    );
  });
}

/** Whether a network exception is fully covered by one of the `bounds` rules (protocol, ports, destinations). */
function networkRuleCoveredBy(
  rule: EffectiveEgressNetworkRule,
  bounds: readonly EffectiveEgressNetworkRule[],
): boolean {
  const ports = parseEgressPortSpec(rule.ports);

  return bounds.some((bound) => {
    const boundPorts = parseEgressPortSpec(bound.ports);

    return (
      bound.protocol === rule.protocol &&
      !!ports &&
      !!boundPorts &&
      ports.from >= boundPorts.from &&
      ports.to <= boundPorts.to &&
      rule.destinations.every((destination) =>
        egressEntryCoveredBy(
          destination,
          bound.destinations.map((value) => ({ value, source: bound.source })),
        ),
      )
    );
  });
}

/**
 * Resolve the effective egress policy from layer overlays.
 * Precedence: global → workspace → environment (scalars: first defined wins; lists: union with provenance).
 * Allow lists are bounded by higher layers: once a higher layer declares `allow_hosts` (or
 * `network_allow`), lower-layer allow entries are only kept when a higher-layer entry covers them,
 * so workspaces / environments can narrow but never widen an inherited allowlist.
 */
export function resolveEffectiveEgressPolicy(layers: readonly PlatformPolicyLayerInput[]): EffectiveEgressPolicy {
  const ordered = orderPolicyLayersHighToLow(layers);
  const policy: EffectiveEgressPolicy = {
    mode: EGRESS_DEFAULTS.mode,
    allowHosts: [],
    denyHosts: [],
    denyUrlPatterns: [],
    networkAllow: [],
    blockPrivateNetworks: EGRESS_DEFAULTS.blockPrivateNetworks,
    blockIpLiterals: EGRESS_DEFAULTS.blockIpLiterals,
    logAllowed: EGRESS_DEFAULTS.logAllowed,
    scalarSources: { mode: null, blockPrivateNetworks: null, blockIpLiterals: null, logAllowed: null },
  };
  const scalarMap = [
    ['mode', 'mode'],
    ['block_private_networks', 'blockPrivateNetworks'],
    ['block_ip_literals', 'blockIpLiterals'],
    ['log_allowed', 'logAllowed'],
  ] as const;

  for (const layer of ordered) {
    const egress = readEgressOverlay(layer.overlay);
    const higherAllowHosts = policy.allowHosts.filter((entry) => entry.source !== layer.source);
    const higherNetworkAllow = policy.networkAllow.filter((rule) => rule.source !== layer.source);

    for (const [configKey, policyKey] of scalarMap) {
      if (policy.scalarSources[policyKey] !== null || egress[configKey] === undefined) {
        continue;
      }

      const value = egress[configKey];

      if (policyKey === 'mode') {
        if ((EGRESS_MODES as readonly unknown[]).includes(value)) {
          policy.mode = value as EgressMode;
          policy.scalarSources.mode = layer.source;
        }
      } else if (typeof value === 'boolean') {
        policy[policyKey] = value;
        policy.scalarSources[policyKey] = layer.source;
      }
    }

    pushUniqueEntries(policy.allowHosts, egress['allow_hosts'], layer.source, (raw) => {
      const value = normalizeEgressHost(raw)?.value ?? null;

      return value && (higherAllowHosts.length === 0 || egressEntryCoveredBy(value, higherAllowHosts)) ? value : null;
    });
    pushUniqueEntries(
      policy.denyHosts,
      egress['deny_hosts'],
      layer.source,
      (raw) => normalizeEgressHost(raw)?.value ?? null,
    );
    pushUniqueEntries(policy.denyUrlPatterns, egress['deny_url_patterns'], layer.source, (raw) =>
      validateEgressUrlPattern(raw) === null ? raw : null,
    );

    if (Array.isArray(egress['network_allow'])) {
      for (const rule of egress['network_allow']) {
        if (!isPlainPolicyObject(rule)) {
          continue;
        }

        const protocol = rule['protocol'];
        const ports = typeof rule['ports'] === 'string' ? rule['ports'].trim() : '';
        const destinations = Array.isArray(rule['destinations'])
          ? (rule['destinations'] as unknown[])
              .map((destination) => normalizeEgressHost(destination))
              .filter(
                (destination): destination is NormalizedEgressHost => !!destination && destination.kind !== 'domain',
              )
              .map((destination) => destination.value)
          : [];

        if (
          !(EGRESS_NETWORK_PROTOCOLS as readonly unknown[]).includes(protocol) ||
          !parseEgressPortSpec(ports) ||
          destinations.length === 0
        ) {
          continue;
        }

        const candidate: EffectiveEgressNetworkRule = {
          protocol: protocol as EgressNetworkProtocol,
          ports,
          destinations: [...new Set(destinations)],
          ...(typeof rule['description'] === 'string' && rule['description'].trim()
            ? { description: rule['description'].trim() }
            : {}),
          source: layer.source,
        };
        const identity = JSON.stringify([candidate.protocol, candidate.ports, candidate.destinations]);

        if (higherNetworkAllow.length > 0 && !networkRuleCoveredBy(candidate, higherNetworkAllow)) {
          continue;
        }

        if (
          policy.networkAllow.some(
            (existing) => JSON.stringify([existing.protocol, existing.ports, existing.destinations]) === identity,
          )
        ) {
          continue;
        }

        policy.networkAllow.push(candidate);
      }
    }
  }

  return policy;
}

const POLICY_LAYER_VALUES = new Set<string>(['global', 'workspace', 'environment']);

function normalizeSource(raw: unknown): PlatformPolicyLayer {
  return typeof raw === 'string' && POLICY_LAYER_VALUES.has(raw) ? (raw as PlatformPolicyLayer) : 'global';
}

function normalizeNullableSource(raw: unknown): PlatformPolicyLayer | null {
  return typeof raw === 'string' && POLICY_LAYER_VALUES.has(raw) ? (raw as PlatformPolicyLayer) : null;
}

/**
 * Defensive normalization of an effective policy received over the wire (agent manager boundary).
 * Every entry is re-validated; invalid values are dropped so nothing unvalidated reaches the guard's
 * Squid / dnsmasq / netfilter configuration. Returns the `off` default for non-objects.
 */
export function normalizeEffectiveEgressPolicy(raw: unknown): EffectiveEgressPolicy {
  const fallback = resolveEffectiveEgressPolicy([]);

  if (!isPlainPolicyObject(raw)) {
    return fallback;
  }

  const hostEntries = (value: unknown): EffectiveEgressEntry[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    const out: EffectiveEgressEntry[] = [];

    for (const item of value.slice(0, EGRESS_MAX_HOST_ENTRIES * 3)) {
      if (!isPlainPolicyObject(item)) {
        continue;
      }

      const normalized = normalizeEgressHost(item['value']);

      if (normalized && !out.some((entry) => entry.value === normalized.value)) {
        out.push({ value: normalized.value, source: normalizeSource(item['source']) });
      }
    }

    return out;
  };

  const patterns = Array.isArray(raw['denyUrlPatterns'])
    ? (raw['denyUrlPatterns'] as unknown[])
        .slice(0, EGRESS_MAX_URL_PATTERNS * 3)
        .filter(
          (item): item is JsonObject =>
            isPlainPolicyObject(item) &&
            typeof item['value'] === 'string' &&
            validateEgressUrlPattern(item['value'] as string) === null,
        )
        .map((item) => ({ value: item['value'] as string, source: normalizeSource(item['source']) }))
    : [];

  const networkAllow: EffectiveEgressNetworkRule[] = [];

  if (Array.isArray(raw['networkAllow'])) {
    for (const item of (raw['networkAllow'] as unknown[]).slice(0, EGRESS_MAX_NETWORK_RULES * 3)) {
      if (!isPlainPolicyObject(item)) {
        continue;
      }

      const protocol = item['protocol'];
      const ports = typeof item['ports'] === 'string' ? item['ports'].trim() : '';
      const destinations = Array.isArray(item['destinations'])
        ? (item['destinations'] as unknown[])
            .slice(0, EGRESS_MAX_NETWORK_DESTINATIONS)
            .map((destination) => normalizeEgressHost(destination))
            .filter(
              (destination): destination is NormalizedEgressHost => !!destination && destination.kind !== 'domain',
            )
            .map((destination) => destination.value)
        : [];

      if (
        !(EGRESS_NETWORK_PROTOCOLS as readonly unknown[]).includes(protocol) ||
        !parseEgressPortSpec(ports) ||
        destinations.length === 0
      ) {
        continue;
      }

      networkAllow.push({
        protocol: protocol as EgressNetworkProtocol,
        ports,
        destinations: [...new Set(destinations)],
        ...(typeof item['description'] === 'string' && item['description'].trim()
          ? { description: item['description'].trim().slice(0, 200) }
          : {}),
        source: normalizeSource(item['source']),
      });
    }
  }

  const sources = isPlainPolicyObject(raw['scalarSources']) ? raw['scalarSources'] : {};

  return {
    mode: (EGRESS_MODES as readonly unknown[]).includes(raw['mode']) ? (raw['mode'] as EgressMode) : fallback.mode,
    allowHosts: hostEntries(raw['allowHosts']),
    denyHosts: hostEntries(raw['denyHosts']),
    denyUrlPatterns: patterns,
    networkAllow,
    blockPrivateNetworks:
      typeof raw['blockPrivateNetworks'] === 'boolean' ? raw['blockPrivateNetworks'] : fallback.blockPrivateNetworks,
    blockIpLiterals: typeof raw['blockIpLiterals'] === 'boolean' ? raw['blockIpLiterals'] : fallback.blockIpLiterals,
    logAllowed: typeof raw['logAllowed'] === 'boolean' ? raw['logAllowed'] : fallback.logAllowed,
    scalarSources: {
      mode: normalizeNullableSource(sources['mode']),
      blockPrivateNetworks: normalizeNullableSource(sources['blockPrivateNetworks']),
      blockIpLiterals: normalizeNullableSource(sources['blockIpLiterals']),
      logAllowed: normalizeNullableSource(sources['logAllowed']),
    },
  };
}

/** Whether the guard must be present / enforcing for this policy. */
export function egressPolicyRequiresGuard(policy: Pick<EffectiveEgressPolicy, 'mode'> | null | undefined): boolean {
  return !!policy && policy.mode !== 'off';
}

/**
 * Evaluate a destination against the effective policy (same precedence as the guard):
 * offline → deny list → private networks → IP literals → URL patterns (plain HTTP) → allowlist.
 * Denylist wins over the allowlist; an empty allowlist means unrestricted. Private-network and
 * IP-literal blocks are lifted for destinations matching an explicit allow entry.
 */
export function evaluateEgressDestination(
  policy: EffectiveEgressPolicy,
  host: string,
  options: { url?: string; scheme?: 'http' | 'https' } = {},
): EgressEvaluationResult {
  if (policy.mode === 'off') {
    return { decision: 'allowed', rule: null };
  }

  const target = stripHostDecorations(host);
  const violation = ((): Omit<EgressEvaluationResult, 'decision'> | null => {
    if (policy.mode === 'offline') {
      return { rule: 'offline', source: policy.scalarSources.mode };
    }

    const denied = findMatchingEntry(target, policy.denyHosts);

    if (denied) {
      return { rule: 'deny_host', matchedEntry: denied.value, source: denied.source };
    }

    const allowedExplicitly = findMatchingEntry(target, policy.allowHosts);

    // Explicit allow entries (e.g. an internal Git server CIDR) are the documented exception path.
    if (policy.blockPrivateNetworks && isPrivateNetworkAddress(target) && !allowedExplicitly) {
      return { rule: 'private_network', source: policy.scalarSources.blockPrivateNetworks };
    }

    if (policy.blockIpLiterals && isIpLiteralHost(target) && !allowedExplicitly) {
      return { rule: 'ip_literal', source: policy.scalarSources.blockIpLiterals };
    }

    if (options.url && options.scheme !== 'https') {
      for (const pattern of policy.denyUrlPatterns) {
        // Defense in depth for policies stored before validation tightened.
        if (validateEgressUrlPattern(pattern.value) !== null) {
          continue;
        }

        try {
          if (new RegExp(pattern.value, 'i').test(options.url)) {
            return { rule: 'deny_url', matchedEntry: pattern.value, source: pattern.source };
          }
        } catch {
          // Invalid patterns are rejected on write; ignore defensively.
        }
      }
    }

    if (policy.allowHosts.length > 0 && !allowedExplicitly) {
      return { rule: 'not_allowlisted' };
    }

    return null;
  })();

  if (!violation) {
    return { decision: 'allowed', rule: null };
  }

  return { decision: policy.mode === 'monitor' ? 'observed' : 'blocked', ...violation };
}

/** Explain which policy entry is responsible for a guard-reported rule on a host (best-effort provenance). */
export function explainEgressRule(
  policy: EffectiveEgressPolicy,
  rule: EgressRule | null,
  host: string | null | undefined,
): { matchedEntry?: string; source?: PlatformPolicyLayer | null } {
  if (!rule) {
    return {};
  }

  if (rule === 'deny_host' && host) {
    const entry = findMatchingEntry(host, policy.denyHosts);

    return entry ? { matchedEntry: entry.value, source: entry.source } : {};
  }

  if (rule === 'offline') {
    return { source: policy.scalarSources.mode };
  }

  if (rule === 'private_network') {
    return { source: policy.scalarSources.blockPrivateNetworks };
  }

  if (rule === 'ip_literal') {
    return { source: policy.scalarSources.blockIpLiterals };
  }

  return {};
}

/** Strip query strings and fragments from URLs before they are persisted (tokens / secrets). */
export function redactEgressUrl(url: string | null | undefined, maxLength = 512): string | null {
  if (!url) {
    return null;
  }

  const withoutQuery = url.split(/[?#]/, 1)[0] ?? '';
  // Drop userinfo (user:password@) when present.
  const withoutUserInfo = withoutQuery.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');

  return withoutUserInfo.length > maxLength ? withoutUserInfo.slice(0, maxLength) : withoutUserInfo;
}
