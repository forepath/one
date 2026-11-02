import type { LogEntry } from '@forepath/loadweaver/shared/util-agent-protocol';

/** A packet the firewall logged (nftables `log prefix`), from a kernel log record. */
export interface FirewallRecord {
  decision: 'denied' | 'observed';
  /** `lwobs <tag>`: the rule that observed it (monitor mode). */
  tag?: string;
  fields: Record<string, string>;
}

/**
 * Parses a kernel log line logged by Loadweaver's rules (`dmesg` output, optionally with its `[seconds]` prefix):
 * `lwdeny ` for the default deny, `lwobs <tag> ` for monitor-mode rules.
 */
export function parseKernelRecord(record: string): FirewallRecord | null {
  const text = record
    .replace(/^<\d+>/, '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .trim();
  const match = /^(lwdeny|lwobs ([0-9a-f]{12})) (.*)$/.exec(text);

  if (!match) return null;

  const fields: Record<string, string> = {};

  for (const pair of match[3].split(/\s+/)) {
    const [key, value] = pair.split('=');

    if (key && value !== undefined && ['IN', 'OUT', 'SRC', 'DST', 'PROTO', 'SPT', 'DPT', 'LEN'].includes(key))
      fields[key.toLowerCase()] = value.slice(0, 64);
  }

  return { decision: match[1] === 'lwdeny' ? 'denied' : 'observed', ...(match[2] ? { tag: match[2] } : {}), fields };
}

/** `project/deployment/service/index` of a workload container → its log labels. */
export function workloadLabels(workloadId: string | undefined): LogEntry['labels'] {
  const [project, deployment, service, index] = (workloadId ?? '').split('/');

  return project && deployment && service
    ? { project, deployment, service, ...(index !== undefined ? { replica: workloadId } : {}) }
    : {};
}

/** The level of a line: JSON lines with a level field keep it, stderr counts as a warning. */
export function levelOf(line: string, stream: 'stdout' | 'stderr'): LogEntry['level'] {
  if (line.startsWith('{')) {
    try {
      const level = String((JSON.parse(line) as Record<string, unknown>)['level'] ?? '').toLowerCase();

      if (['debug', 'trace'].includes(level)) return 'debug';

      if (['warn', 'warning'].includes(level)) return 'warn';

      if (['error', 'fatal', 'panic', 'critical'].includes(level)) return 'error';

      if (level) return 'info';
    } catch {
      // not JSON after all
    }
  }

  return stream === 'stderr' ? 'warn' : 'info';
}

/** Replaces secret values the node delivered to the workload (3.14: redacted before storage). */
export function redact(line: string, secrets: readonly string[]): string {
  let result = line;

  for (const secret of secrets) if (secret.length >= 6) result = result.split(secret).join('[redacted]');

  return result;
}

/** Peer handshakes from `wg show all dump`: per interface + peer, the latest handshake (unix seconds). */
export function handshakes(dump: string): Map<string, { iface: string; peer: string; handshake: number }> {
  const result = new Map<string, { iface: string; peer: string; handshake: number }>();

  for (const line of dump.split('\n')) {
    const f = line.split('\t');

    if (f.length === 9) result.set(`${f[0]}/${f[1]}`, { iface: f[0], peer: f[1], handshake: Number(f[5]) });
  }

  return result;
}

/** BGP sessions from `birdc show protocols`: name → state (`Established`, `Active`, ...). */
export function birdSessions(output: string): Map<string, string> {
  const result = new Map<string, string>();

  for (const line of output.split('\n')) {
    const f = line.trim().split(/\s+/);
    // The `Since` column may contain a space (date + time), so the state is found by name, not by position.
    const state = /\b(Idle|Connect|Active|OpenSent|OpenConfirm|Established|Close)\b/.exec(line)?.[1];

    if (f[1] === 'BGP' && state) result.set(f[0], state);
  }

  return result;
}

/** RBAC policy names of the egress listeners → Agenstra's rule names (mesh-config `EGRESS_RULE_POLICIES`). */
const EGRESS_RULES: Record<string, string> = {
  r1_offline: 'offline',
  r2_deny_host: 'deny_host',
  r3_private_network: 'private_network',
  r4_ip_literal: 'ip_literal',
  r5_deny_url: 'deny_url',
};

/** An egress decision of the node proxy, from its access line (3.7 / 3.14). */
export interface EgressDecision {
  /** The workload (or client) address that made the request. */
  source: string;
  kind: 'web';
  decision: 'allowed' | 'blocked' | 'observed';
  rule: string | null;
  host: string | null;
  method?: string;
  status?: number;
}

/**
 * Parses an egress access line (`kind: egress-http | egress-tls`): enforced RBAC denials are `blocked`, matches of
 * shadow-only rules (monitor mode or monitor policies) `observed`, the rest `allowed`; `rule` in Agenstra's terms.
 */
export function parseEgressDecision(line: string): EgressDecision | null {
  if (!line.startsWith('{"')) return null;

  let entry: Record<string, unknown>;

  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const kind = entry['kind'];

  if ((kind !== 'egress-http' && kind !== 'egress-tls') || typeof entry['source'] !== 'string') return null;

  const value = (key: string) => {
    const v = entry[key];

    return typeof v === 'string' && v !== '' && v !== '-' ? v : null;
  };
  const deniedBy = value('rule');
  const enforced = (value('details') ?? '').includes('rbac_access_denied');
  const shadowDenied = deniedBy !== null;
  const notAllowListed = value('allow') === 'denied' || (value('mode') === 'monitor' && value('shadow') === 'denied');
  const rule = deniedBy ? (EGRESS_RULES[deniedBy] ?? deniedBy) : notAllowListed || enforced ? 'not_allowlisted' : null;
  const decision = enforced ? 'blocked' : shadowDenied || notAllowListed ? 'observed' : 'allowed';
  const status = Number(entry['status']);

  return {
    source: entry['source'],
    kind: 'web',
    decision,
    rule: decision === 'allowed' ? null : rule,
    host: value('host'),
    ...(value('method') ? { method: value('method') as string } : {}),
    ...(Number.isInteger(status) && status > 0 ? { status } : {}),
  };
}
