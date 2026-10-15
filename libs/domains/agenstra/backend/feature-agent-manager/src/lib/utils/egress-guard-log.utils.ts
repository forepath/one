import {
  EGRESS_RULES,
  evaluateEgressDestination,
  explainEgressRule,
  redactEgressUrl,
  type EffectiveEgressPolicy,
  type EgressDecision,
  type EgressEventKind,
  type EgressMode,
  type EgressRule,
  type PlatformPolicyLayer,
} from '@forepath/agenstra/shared/util-opencode-config';

import {
  EGRESS_GIT_SSH_COUNTER_CATEGORY,
  EGRESS_GUARD_COUNTER_COMMENT_PREFIX,
  EGRESS_GUARD_EVENT_LOG_MARKER,
  EGRESS_GUARD_WEB_LOG_MARKER,
} from '../constants/egress-guard.constants';

/** One parsed guard decision (before aggregation). */
export interface EgressGuardObservation {
  kind: EgressEventKind;
  decision: EgressDecision;
  occurredAt: Date;
  host: string | null;
  rule: EgressRule | null;
  matchedEntry?: string | null;
  matchedSource?: PlatformPolicyLayer | null;
  method?: string | null;
  httpStatus?: number | null;
  url?: string | null;
  bytesIn?: number;
  bytesOut?: number;
  durationMs?: number;
  count?: number;
  message?: string | null;
}

/** Parsed `docker logs --timestamps` line. */
export interface TimestampedLogLine {
  /** RFC 3339 nano timestamp as emitted by Docker (used as the collection cursor). */
  timestamp: string;
  line: string;
}

const RULE_SET = new Set<string>(EGRESS_RULES);

function toRule(raw: string | null | undefined): EgressRule | null {
  if (!raw || raw === '-') {
    return null;
  }

  // Squid joins multiple matching annotations with commas; the first one is the decisive rule.
  const first = decodeLogField(raw).split(',')[0]?.trim();

  return first && RULE_SET.has(first) ? (first as EgressRule) : null;
}

function decodeLogField(raw: string | undefined): string {
  if (!raw || raw === '-') {
    return '';
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function toInt(raw: string | undefined): number {
  const value = raw ? Number.parseInt(raw, 10) : NaN;

  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');

    return end > 0 ? host.slice(1, end) : host;
  }

  const colonCount = (host.match(/:/g) ?? []).length;

  return colonCount === 1 ? host.slice(0, host.indexOf(':')) : host;
}

/** Split Docker's `--timestamps` prefix from a log line. */
export function splitDockerTimestamp(rawLine: string): TimestampedLogLine | null {
  const line = rawLine.replace(/\r$/, '');
  const space = line.indexOf(' ');

  if (space <= 0) {
    return null;
  }

  const timestamp = line.slice(0, space);

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(timestamp)) {
    return null;
  }

  return { timestamp, line: line.slice(space + 1) };
}

/** Compare Docker RFC 3339 nano timestamps (lexicographic after zero-padding fractions). */
export function compareDockerTimestamps(left: string, right: string): number {
  const normalize = (value: string) => {
    const [base, fraction = ''] = value.replace(/Z$/, '').split('.');

    return `${base}.${fraction.padEnd(9, '0')}`;
  };

  const a = normalize(left);
  const b = normalize(right);

  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Parse one Squid access log line (`AGENSTRA_EGRESS …`, see the guard `logformat`).
 * Returns null for lines that are not decisions (e.g. TLS peek records of spliced connections).
 */
export function parseSquidAccessLine(
  line: string,
  mode: EgressMode,
  policy: EffectiveEgressPolicy | null,
): EgressGuardObservation | null {
  // Markers are only trusted at the start of a line: dnsmasq echoes agent-chosen query names.
  if (!line.startsWith(`${EGRESS_GUARD_WEB_LOG_MARKER} `)) {
    return null;
  }

  const fields = line
    .slice(EGRESS_GUARD_WEB_LOG_MARKER.length + 1)
    .trim()
    .split(/\s+/);

  if (fields.length < 13) {
    return null;
  }

  const [
    ts,
    status,
    httpStatusRaw,
    method,
    urlRaw,
    domainRaw,
    sniRaw,
    ,
    bytesInRaw,
    bytesOutRaw,
    durationRaw,
    noteRaw,
    errCode,
  ] = fields;
  const seconds = Number.parseFloat(ts);

  if (!Number.isFinite(seconds)) {
    return null;
  }

  const rule = toRule(noteRaw);
  const isPeekRecord = status.startsWith('NONE_NONE') || status.startsWith('TAG_NONE');
  const denied = status.startsWith('TCP_DENIED') || errCode === 'ERR_ACCESS_DENIED';
  let decision: EgressDecision;

  if (denied) {
    decision = 'blocked';
  } else if (isPeekRecord) {
    // Terminated intercepted TLS only produces the peek record; spliced connections log a tunnel too.
    if (!rule || mode === 'monitor' || mode === 'off') {
      return null;
    }

    decision = 'blocked';
  } else if (rule && mode === 'monitor') {
    decision = 'observed';
  } else {
    decision = 'allowed';
  }

  const sni = decodeLogField(sniRaw);
  const domain = decodeLogField(domainRaw);
  const url = decodeLogField(urlRaw);
  const host = stripPort((sni || domain || url).toLowerCase()) || null;
  const effectiveRule: EgressRule | null = decision === 'allowed' ? null : (rule ?? (denied ? 'deny_host' : null));
  const provenance = policy && effectiveRule ? explainEgressRule(policy, effectiveRule, host) : {};
  const httpStatus = toInt(httpStatusRaw);

  return {
    kind: 'web',
    decision,
    occurredAt: new Date(Math.round(seconds * 1000)),
    host,
    rule: effectiveRule,
    matchedEntry: provenance.matchedEntry ?? null,
    matchedSource: provenance.source ?? null,
    method: method && method !== '-' ? method.slice(0, 16) : null,
    httpStatus: httpStatus > 0 ? httpStatus : null,
    url: method === 'CONNECT' ? null : redactEgressUrl(url),
    bytesIn: toInt(bytesInRaw),
    bytesOut: toInt(bytesOutRaw),
    durationMs: toInt(durationRaw),
    count: 1,
  };
}

const DNSMASQ_CONFIG_BLOCK = /^dnsmasq(?:\[\d+\])?: config (\S+) is (NXDOMAIN|NODATA|0\.0\.0\.0|::)\s*$/;
const DNSMASQ_REBIND = /^dnsmasq(?:\[\d+\])?: possible DNS-rebind attack detected: (\S+)\s*$/;

/** Parse dnsmasq query log lines into DNS block observations (allowed lookups are not recorded). */
export function parseDnsmasqLine(
  line: string,
  occurredAt: Date,
  mode: EgressMode,
  policy: EffectiveEgressPolicy | null,
): EgressGuardObservation | null {
  if (mode === 'off' || mode === 'monitor') {
    return null;
  }

  const rebind = DNSMASQ_REBIND.exec(line);

  if (rebind) {
    return {
      kind: 'dns',
      decision: 'blocked',
      occurredAt,
      host: rebind[1].toLowerCase(),
      rule: 'private_network',
      matchedSource: policy?.scalarSources.blockPrivateNetworks ?? null,
      count: 1,
    };
  }

  const blocked = DNSMASQ_CONFIG_BLOCK.exec(line);

  if (!blocked) {
    return null;
  }

  const host = blocked[1].toLowerCase();
  let rule: EgressRule = mode === 'offline' ? 'offline' : 'deny_host';
  let matchedEntry: string | null = null;
  let matchedSource: PlatformPolicyLayer | null = null;

  if (policy) {
    const evaluation = evaluateEgressDestination(policy, host);

    if (evaluation.rule) {
      rule = evaluation.rule;
      matchedEntry = evaluation.matchedEntry ?? null;
      matchedSource = evaluation.source ?? null;
    }
  }

  return { kind: 'dns', decision: 'blocked', occurredAt, host, rule, matchedEntry, matchedSource, count: 1 };
}

/** Parse a guard supervisor event line (`AGENSTRA_GUARD {json}`); only failures become observations. */
export function parseGuardEventLine(line: string, occurredAt: Date): EgressGuardObservation | null {
  if (!line.startsWith(`${EGRESS_GUARD_EVENT_LOG_MARKER} `)) {
    return null;
  }

  try {
    const payload = JSON.parse(line.slice(EGRESS_GUARD_EVENT_LOG_MARKER.length + 1)) as {
      event?: string;
      detail?: string;
    };
    const event = typeof payload.event === 'string' ? payload.event : '';

    if (!['lockdown_failed', 'activate_failed', 'process_restarted'].includes(event)) {
      return null;
    }

    const detail = typeof payload.detail === 'string' ? payload.detail.slice(0, 500) : '';

    return {
      kind: 'guard',
      decision: 'error',
      occurredAt,
      host: null,
      rule: 'guard',
      message: detail ? `${event}: ${detail}` : event,
      count: 1,
    };
  } catch {
    return null;
  }
}

/** Parse one timestamped guard log line (Squid, dnsmasq, or supervisor). */
export function parseGuardLogLine(
  entry: TimestampedLogLine,
  mode: EgressMode,
  policy: EffectiveEgressPolicy | null,
): EgressGuardObservation | null {
  const occurredAt = new Date(entry.timestamp);

  if (entry.line.startsWith(`${EGRESS_GUARD_WEB_LOG_MARKER} `)) {
    return parseSquidAccessLine(entry.line, mode, policy);
  }

  if (entry.line.startsWith(`${EGRESS_GUARD_EVENT_LOG_MARKER} `)) {
    return parseGuardEventLine(entry.line, occurredAt);
  }

  if (entry.line.startsWith('dnsmasq')) {
    return parseDnsmasqLine(entry.line, occurredAt, mode, policy);
  }

  return null;
}

export interface EgressCounterSample {
  /** Stable identity of the counted rule (family + rule text without counters). */
  key: string;
  category: string;
  packets: number;
  protocol: string | null;
  port: string | null;
  destination: string | null;
}

const COUNTER_LINE = /^(v6 )?\[(\d+):(\d+)\] (.+)$/;

/** Parse `agenstra-egress counters` output (`iptables-save -c` lines of counted categories). */
export function parseEgressCounters(output: string): EgressCounterSample[] {
  const samples: EgressCounterSample[] = [];

  for (const rawLine of output.split('\n')) {
    const match = COUNTER_LINE.exec(rawLine.trim());

    if (!match) {
      continue;
    }

    const rule = match[4];
    const category = new RegExp(`--comment "?${EGRESS_GUARD_COUNTER_COMMENT_PREFIX}([a-z_]+)"?`).exec(rule)?.[1];

    if (!category) {
      continue;
    }

    samples.push({
      key: `${match[1] ? 'v6' : 'v4'} ${rule}`,
      category,
      packets: Number.parseInt(match[2], 10),
      protocol: /-p (tcp|udp)/.exec(rule)?.[1] ?? null,
      port: /--dports? (\S+)/.exec(rule)?.[1]?.replace(':', '-') ?? null,
      destination: /-d (\S+)/.exec(rule)?.[1]?.replace(/\/(32|128)$/, '') ?? null,
    });
  }

  return samples;
}

/**
 * Turn counter samples into observations using the previous snapshot (packets since last poll).
 * Counters reset when the guard re-applies its rules; a decrease is treated as a fresh count.
 */
export function diffEgressCounters(
  previous: ReadonlyMap<string, number> | null,
  samples: readonly EgressCounterSample[],
  mode: EgressMode,
  occurredAt: Date,
): { observations: EgressGuardObservation[]; snapshot: Map<string, number> } {
  const snapshot = new Map<string, number>();
  const observations: EgressGuardObservation[] = [];

  for (const sample of samples) {
    snapshot.set(sample.key, sample.packets);

    if (!previous) {
      continue;
    }

    const before = previous.get(sample.key);
    const delta = before === undefined || sample.packets < before ? sample.packets : sample.packets - before;

    if (delta <= 0) {
      continue;
    }

    // Declared network exceptions and Git over SSH are accepted traffic, not blocks.
    const allowedException = sample.category === 'network_allow' || sample.category === EGRESS_GIT_SSH_COUNTER_CATEGORY;
    const rule = allowedException
      ? null
      : RULE_SET.has(sample.category)
        ? (sample.category as EgressRule)
        : 'undeclared_protocol';

    observations.push({
      kind: 'network',
      decision: allowedException ? 'allowed' : mode === 'monitor' ? 'observed' : 'blocked',
      occurredAt,
      host: sample.destination,
      rule,
      method: sample.protocol && sample.port ? `${sample.protocol}/${sample.port}` : sample.protocol,
      count: delta,
    });
  }

  return { observations, snapshot };
}

/** Aggregation key: identical decisions per collection cycle collapse into one row with a count. */
export function egressObservationKey(observation: EgressGuardObservation): string {
  return [
    observation.kind,
    observation.decision,
    observation.host ?? '',
    observation.rule ?? '',
    observation.matchedEntry ?? '',
    observation.matchedSource ?? '',
    observation.decision === 'allowed' ? '' : (observation.method ?? ''),
    observation.message ?? '',
  ].join('|');
}

export interface AggregatedEgressObservation extends EgressGuardObservation {
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** Collapse observations (bounded row volume even for chatty agents). */
export function aggregateEgressObservations(
  observations: readonly EgressGuardObservation[],
): AggregatedEgressObservation[] {
  const byKey = new Map<string, AggregatedEgressObservation>();

  for (const observation of observations) {
    const key = egressObservationKey(observation);
    const existing = byKey.get(key);
    const count = observation.count ?? 1;

    if (!existing) {
      byKey.set(key, {
        ...observation,
        count,
        bytesIn: observation.bytesIn ?? 0,
        bytesOut: observation.bytesOut ?? 0,
        firstSeenAt: observation.occurredAt,
        lastSeenAt: observation.occurredAt,
      });
      continue;
    }

    existing.count += count;
    existing.bytesIn = (existing.bytesIn ?? 0) + (observation.bytesIn ?? 0);
    existing.bytesOut = (existing.bytesOut ?? 0) + (observation.bytesOut ?? 0);

    if (observation.occurredAt < existing.firstSeenAt) {
      existing.firstSeenAt = observation.occurredAt;
    }

    if (observation.occurredAt > existing.lastSeenAt) {
      existing.lastSeenAt = observation.occurredAt;
      existing.httpStatus = observation.httpStatus ?? existing.httpStatus;
      existing.url = observation.url ?? existing.url;
    }
  }

  return [...byKey.values()];
}
