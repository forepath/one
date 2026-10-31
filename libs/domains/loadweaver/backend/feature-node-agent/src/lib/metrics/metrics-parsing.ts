/** CPU jiffies from the first line of `/proc/stat`: busy and total. */
export function parseProcStat(text: string): { busy: number; total: number } | null {
  const line = text.split('\n').find((l) => l.startsWith('cpu '));

  if (!line) return null;

  const values = line.trim().split(/\s+/).slice(1).map(Number);
  const total = values.reduce((a, b) => a + b, 0);
  // idle + iowait
  const idle = (values[3] ?? 0) + (values[4] ?? 0);

  return { busy: total - idle, total };
}

/** Busy share between two `/proc/stat` readings, as cores (share × cores). */
export function cpuCores(
  before: { busy: number; total: number },
  after: { busy: number; total: number },
  cores: number,
): number {
  const total = after.total - before.total;

  return total > 0 ? ((after.busy - before.busy) / total) * cores : 0;
}

/** Bytes received / sent per interface from `/proc/net/dev`. */
export function parseNetDev(text: string): Map<string, { rx: number; tx: number }> {
  const result = new Map<string, { rx: number; tx: number }>();

  for (const line of text.split('\n').slice(2)) {
    const [name, rest] = line.split(':');

    if (!rest) continue;

    const f = rest.trim().split(/\s+/).map(Number);

    result.set(name.trim(), { rx: f[0] ?? 0, tx: f[8] ?? 0 });
  }

  return result;
}

export interface RuleCounter {
  handle: number;
  policy: string;
  src: string;
  dst: string;
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  port: number;
  decision: 'allowed' | 'denied' | 'observed';
  packets: number;
  bytes: number;
}

type NftExpr = Record<string, unknown>;

/**
 * Counters of the Loadweaver table's rules from `nft -j list table inet loadweaver`: per rule its policy (comment),
 * source / destination sets, first port and decision (log + accept = observed, drop = denied).
 */
export function parseNftCounters(json: string): RuleCounter[] {
  let parsed: { nftables?: Array<{ rule?: { handle: number; comment?: string; expr?: NftExpr[]; chain?: string } }> };

  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return [];
  }

  const counters: RuleCounter[] = [];

  for (const item of parsed.nftables ?? []) {
    const rule = item.rule;

    if (!rule?.expr) continue;

    const counter = rule.expr.find((e) => 'counter' in e)?.['counter'] as
      | { packets?: number; bytes?: number }
      | undefined;

    if (!counter) continue;

    let src = '';
    let dst = '';
    let protocol: RuleCounter['protocol'] = 'any';
    let port = 0;

    for (const e of rule.expr) {
      const match = e['match'] as
        | { left?: { payload?: { protocol?: string; field?: string } }; right?: unknown }
        | undefined;

      if (!match?.left?.payload) continue;

      const { protocol: proto, field } = match.left.payload;
      const right = match.right;
      const set = typeof right === 'string' && right.startsWith('@') ? right.slice(1).replace(/_[46]$/, '') : '';

      if (field === 'saddr' && set) src = set;
      else if (field === 'daddr' && set) dst = set;
      else if (field === 'dport' && (proto === 'tcp' || proto === 'udp')) {
        protocol = proto;
        port = typeof right === 'number' ? right : Number((right as { set?: unknown[] })?.set?.[0] ?? 0) || 0;
      }
    }

    // Monitor rules: their accept carries the `observed` comment suffix (the log rule before it has no counter).
    const observed = !!rule.comment?.endsWith(' observed');
    const verdict = rule.expr.some((e) => 'drop' in e) ? 'denied' : observed ? 'observed' : 'allowed';

    if (!rule.comment && verdict !== 'denied') continue;

    counters.push({
      handle: rule.handle,
      policy: observed
        ? (rule.comment as string).slice(0, -' observed'.length)
        : (rule.comment ?? 'builtin:default-deny'),
      src: src || '*',
      dst: dst || '*',
      protocol,
      port,
      decision: verdict,
      packets: counter.packets ?? 0,
      bytes: counter.bytes ?? 0,
    });
  }

  return counters;
}

/** The value at a quantile of sorted numbers (nearest rank). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;

  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

/** CPU cores and memory of a container from a one-shot Docker stats reading. */
export function dockerUsage(stats: {
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; stats?: { inactive_file?: number } };
}): { cores: number; memoryBytes: number } {
  const cpu = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const system = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
  const online = stats.cpu_stats?.online_cpus ?? 1;

  return {
    cores: system > 0 && cpu > 0 ? (cpu / system) * online : 0,
    memoryBytes: Math.max(0, (stats.memory_stats?.usage ?? 0) - (stats.memory_stats?.stats?.inactive_file ?? 0)),
  };
}

/**
 * A container's network byte counters from Docker stats (summed over its interfaces), or null without networks
 * (e.g. host networking). Usage metering (3.24) turns their increase into traffic per project.
 */
export function dockerNetworkBytes(stats: {
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
}): { rx: number; tx: number } | null {
  const interfaces = Object.values(stats.networks ?? {});

  if (interfaces.length === 0) return null;

  return interfaces.reduce((sum, n) => ({ rx: sum.rx + (n.rx_bytes ?? 0), tx: sum.tx + (n.tx_bytes ?? 0) }), {
    rx: 0,
    tx: 0,
  });
}

/**
 * Requests through the ingress per hostname within one interval (from its access log lines): counts, server errors
 * and latencies for p50 / p95 / p99.
 */
export class RequestStats {
  private hosts = new Map<string, { requests: number; errors: number; durations: number[] }>();

  record(host: string, status: number, durationMs: number): void {
    const key = host.toLowerCase().replace(/:\d+$/, '').slice(0, 253);
    const h = this.hosts.get(key) ?? { requests: 0, errors: 0, durations: [] };

    h.requests++;

    if (status >= 500) h.errors++;

    if (h.durations.length < 10_000) h.durations.push(durationMs);

    this.hosts.set(key, h);
  }

  /** The interval's numbers, and a fresh interval. */
  drain(): { host: string; requests: number; errors: number; p50: number; p95: number; p99: number }[] {
    const result = [...this.hosts].map(([host, h]) => {
      const sorted = [...h.durations].sort((a, b) => a - b);

      return {
        host,
        requests: h.requests,
        errors: h.errors,
        p50: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        p99: quantile(sorted, 0.99),
      };
    });

    this.hosts = new Map();

    return result;
  }
}

/** Denied packets per source / destination / port within one interval (from the firewall's log lines). */
export class DeniedFlows {
  private flows = new Map<string, number>();

  record(src: string, dst: string, protocol: string, port: number): void {
    const key = `${src}|${dst}|${protocol.toLowerCase()}|${port}`;

    if (this.flows.size < 5_000 || this.flows.has(key)) this.flows.set(key, (this.flows.get(key) ?? 0) + 1);
  }

  drain(): { src: string; dst: string; protocol: 'tcp' | 'udp' | 'icmp' | 'any'; port: number; packets: number }[] {
    const result = [...this.flows].map(([key, packets]) => {
      const [src, dst, protocol, port] = key.split('|');

      return {
        src,
        dst,
        protocol: (['tcp', 'udp', 'icmp'].includes(protocol) ? protocol : 'any') as 'tcp' | 'udp' | 'icmp' | 'any',
        port: Number(port) || 0,
        packets,
      };
    });

    this.flows = new Map();

    return result;
  }
}
