import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';

import { agentMessage, type Envelope, type MetricsReport } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { HostInfoService } from '../host/host-info.service';
import { MANAGED_LABEL } from '../host/managed-containers';
import { handshakes } from '../logs/log-parsing';
import { NFT_TABLE } from '../network/nftables.renderer';
import { WORKLOAD_LABEL } from '../workloads/workload-container';
import {
  cpuCores,
  DeniedFlows,
  dockerNetworkBytes,
  dockerUsage,
  parseNetDev,
  parseNftCounters,
  parseProcStat,
  RequestStats,
  type RuleCounter,
} from './metrics-parsing';

export const METRICS_INTERVAL_MS = 10_000;
/** Reports kept while disconnected (5 minutes). */
const MAX_PENDING = 30;
const STATS_CONCURRENCY = 16;
/** Samples per `metrics` message (the protocol's limit); larger collections go out as several reports. */
export const MAX_SAMPLES_PER_REPORT = 10_000;

type Sample = MetricsReport['samples'][number];

/** A running replica container's last reading of its cumulative counters (usage metering, 3.24). */
interface ReplicaReading {
  /** When it was read (the collection's time, ms). */
  at: number;
  cpu?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  net?: { rx: number; tx: number };
}

/** Increase of a cumulative counter; after a restart (counter went down) everything counted since the restart. */
function counterDelta(now: number, before: number): number {
  return now >= before ? now - before : now;
}

/**
 * Splits a collection into reports the protocol accepts (at most `max` samples each, all with the same `at`); the
 * flows travel with the first one. Lets usage samples cover every replica of a node however many it runs.
 */
export function splitMetricsReport(report: MetricsReport, max = MAX_SAMPLES_PER_REPORT): MetricsReport[] {
  if (report.samples.length <= max) return [report];

  const reports: MetricsReport[] = [];

  for (let i = 0; i < report.samples.length; i += max)
    reports.push({ at: report.at, samples: report.samples.slice(i, i + max), flows: i === 0 ? report.flows : [] });

  return reports;
}

/**
 * The node's metrics every 10 s (3.18): CPU / memory / disk, containers by state, network per interface, WireGuard
 * per peer, CPU / memory / network per replica, requests / errors / latency per ingress hostname (from its access log), and
 * flows per policy edge (rule counters) plus denied flows (firewall log). Rates are per second over the interval.
 *
 * Usage metering (3.24) gets integrated per-replica samples over the measured time since the replica's previous
 * reading (`replica.cpu_seconds`, `replica.memory_byte_seconds`, `replica.net_rx_bytes`, `replica.net_tx_bytes`), so a
 * skipped or slow tick bills the full time, never a fixed 10 s per sample. Every running replica is read (no cap).
 */
@Injectable()
export class MetricsCollectorService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsCollectorService.name);
  readonly requests = new RequestStats();
  readonly denied = new DeniedFlows();
  private send: ((envelope: Envelope) => boolean) | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Collections not sent yet (each one or more reports), the oldest first. */
  private pending: MetricsReport[][] = [];
  private cpu: { busy: number; total: number } | null = null;
  private net = new Map<string, { rx: number; tx: number }>();
  private wg = new Map<string, { rx: number; tx: number }>();
  private rules = new Map<number, RuleCounter>();
  private readings = new Map<string, ReplicaReading>();
  private last = Date.now();
  private running = false;

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly commands: CommandRunner,
    private readonly host: HostInfoService,
  ) {}

  attach(send: (envelope: Envelope) => boolean): void {
    this.send = send;
    this.timer ??= setInterval(() => void this.tick(), METRICS_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      this.pending.push(splitMetricsReport(await this.collect()));
      this.pending = this.pending.slice(-MAX_PENDING);

      while (this.send && this.pending.length > 0) {
        const group = this.pending[0];

        if (group.length > 0 && !this.send(agentMessage('metrics', group[0]))) break;

        group.shift();

        if (group.length === 0) this.pending.shift();
      }
    } catch (error) {
      this.logger.warn(`Metrics: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async collect(now = Date.now()): Promise<MetricsReport> {
    const previousCollection = this.last;
    const seconds = Math.max(1, (now - this.last) / 1000);
    const samples: Sample[] = [];
    const add = (metric: string, entity: string, value: number, project?: string) => {
      if (Number.isFinite(value))
        samples.push({ metric, entity: entity.slice(0, 255), value, ...(project ? { project } : {}) });
    };

    this.last = now;

    // Node.
    const stat = parseProcStat(await readFile('/proc/stat', 'utf8').catch(() => ''));

    if (stat && this.cpu) add('node.cpu_cores', 'node', cpuCores(this.cpu, stat, cpus().length));

    this.cpu = stat ?? this.cpu;

    const usage = await this.host.usage().catch(() => null);

    if (usage) {
      add('node.memory_bytes', 'node', usage.memoryBytes);
      add('node.disk_bytes', 'node', usage.diskBytes);
    }

    // Network per interface (rates over the interval).
    const net = parseNetDev(await readFile('/proc/net/dev', 'utf8').catch(() => ''));

    for (const [iface, n] of [...net].filter(([name]) => name !== 'lo').slice(0, 64)) {
      const before = this.net.get(iface);

      if (before && n.rx >= before.rx && n.tx >= before.tx) {
        add('net.rx_bytes_per_s', iface, (n.rx - before.rx) / seconds);
        add('net.tx_bytes_per_s', iface, (n.tx - before.tx) / seconds);
      }
    }

    this.net = net;

    // WireGuard per peer.
    const dump = await this.commands
      .run('wg', ['show', 'all', 'dump'])
      .then((r) => r.stdout)
      .catch(() => '');
    const wg = new Map<string, { rx: number; tx: number }>();

    for (const line of dump.split('\n')) {
      const f = line.split('\t');

      if (f.length !== 9) continue;

      const key = `${f[0]}/${f[1].slice(0, 12)}`;
      const rx = Number(f[6]);
      const tx = Number(f[7]);
      const before = this.wg.get(key);

      wg.set(key, { rx, tx });

      if (before && rx >= before.rx && tx >= before.tx) {
        add('wg.rx_bytes_per_s', key, (rx - before.rx) / seconds);
        add('wg.tx_bytes_per_s', key, (tx - before.tx) / seconds);
      }
    }

    for (const [, p] of handshakes(dump))
      if (p.handshake > 0) add('wg.handshake_age_s', `${p.iface}/${p.peer.slice(0, 12)}`, now / 1000 - p.handshake);

    this.wg = wg;

    // Containers and replicas.
    const containers = await this.docker
      .listContainers({ all: true, filters: { label: [`${MANAGED_LABEL}=true`] } })
      .catch(() => []);
    const states = new Map<string, number>();

    for (const c of containers) states.set(c.State, (states.get(c.State) ?? 0) + 1);

    for (const [state, count] of states) add('node.containers', state, count);

    // One-shot readings (no 1 s sampling wait), a few at a time. Every running replica is read: these are also the
    // usage-metering samples, and since they integrate the measured time a slow pass costs resolution, not billing.
    const readings = new Map<string, ReplicaReading>();
    const replicas = containers.filter((x) => x.State === 'running' && x.Labels?.[WORKLOAD_LABEL]);

    for (let i = 0; i < replicas.length; i += STATS_CONCURRENCY)
      await Promise.all(
        replicas.slice(i, i + STATS_CONCURRENCY).map(async (c) => {
          const replica = c.Labels[WORKLOAD_LABEL];
          const project = replica.split('/')[0];
          const before = this.readings.get(c.Id);

          try {
            const stats = (await this.docker
              .getContainer(c.Id)
              .stats({ stream: false, 'one-shot': true })) as Parameters<typeof dockerUsage>[0];
            // One-shot readings carry no previous sample: CPU is the change since this collector's last reading.
            const u = dockerUsage({ ...stats, precpu_stats: before?.cpu ?? stats.cpu_stats });
            const bytes = dockerNetworkBytes(stats as Parameters<typeof dockerNetworkBytes>[0]);
            const reading: ReplicaReading = {
              at: now,
              cpu: {
                cpu_usage: { total_usage: stats.cpu_stats?.cpu_usage?.total_usage },
                system_cpu_usage: stats.cpu_stats?.system_cpu_usage,
              },
              ...(bytes ? { net: bytes } : {}),
            };
            // Created since the previous collection: its counters started within this interval and count in full.
            const createdAt = typeof c.Created === 'number' && c.Created > 0 ? c.Created * 1000 : null;
            const fresh = !before && createdAt !== null && createdAt > previousCollection;
            // Measured time this reading stands for: since the replica's previous reading, else since the previous
            // collection (or its creation, if later).
            const interval = before
              ? Math.max(0, (now - before.at) / 1000)
              : Math.max(0, Math.min(seconds, createdAt !== null ? (now - createdAt) / 1000 : seconds));

            readings.set(c.Id, reading);

            if (before) add('replica.cpu_cores', replica, u.cores, project);
            add('replica.memory_bytes', replica, u.memoryBytes, project);
            add('replica.memory_byte_seconds', replica, u.memoryBytes * interval, project);

            const cpuNow = stats.cpu_stats?.cpu_usage?.total_usage;
            const cpuBefore = before?.cpu?.cpu_usage?.total_usage;

            if (typeof cpuNow === 'number' && (typeof cpuBefore === 'number' || fresh))
              add('replica.cpu_seconds', replica, counterDelta(cpuNow, cpuBefore ?? 0) / 1e9, project);

            // Traffic per replica: counter increase since the last reading; a restart resets the counters.
            if (bytes && (before?.net || fresh)) {
              const rx = counterDelta(bytes.rx, before?.net?.rx ?? 0);
              const tx = counterDelta(bytes.tx, before?.net?.tx ?? 0);

              add('replica.net_rx_bytes', replica, rx, project);
              add('replica.net_tx_bytes', replica, tx, project);

              if (before?.net && bytes.rx >= before.net.rx && bytes.tx >= before.net.tx && interval > 0) {
                add('replica.net_rx_bytes_per_s', replica, rx / interval, project);
                add('replica.net_tx_bytes_per_s', replica, tx / interval, project);
              }
            }
          } catch {
            // Gone meanwhile, or the reading failed: keep the previous one, so the next reading covers the gap.
            if (before) readings.set(c.Id, before);
          }
        }),
      );

    this.readings = readings;

    // Ingress per hostname.
    for (const h of this.requests.drain()) {
      add('ingress.requests_per_s', h.host, h.requests / seconds);
      add('ingress.errors_per_s', h.host, h.errors / seconds);
      add('ingress.latency_p50_ms', h.host, h.p50);
      add('ingress.latency_p95_ms', h.host, h.p95);
      add('ingress.latency_p99_ms', h.host, h.p99);
    }

    return { at: new Date(now).toISOString(), samples, flows: await this.flows() };
  }

  /** Per policy edge: packets / bytes since the last interval (rule counters), plus denied flows (firewall log). */
  private async flows(): Promise<MetricsReport['flows']> {
    const json = await this.commands
      .run('nft', ['-j', 'list', 'table', 'inet', NFT_TABLE])
      .then((r) => r.stdout)
      .catch(() => '');
    const counters = parseNftCounters(json);
    const flows: MetricsReport['flows'] = [];

    for (const c of counters) {
      const before = this.rules.get(c.handle);
      const packets = before && c.packets >= before.packets ? c.packets - before.packets : 0;
      const bytes = before && c.bytes >= before.bytes ? c.bytes - before.bytes : 0;

      // The default deny is covered by the firewall log, per source and destination.
      if (packets > 0 && c.decision !== 'denied')
        flows.push({
          policy: c.policy.slice(0, 255),
          src: c.src,
          dst: c.dst,
          protocol: c.protocol,
          port: c.port,
          decision: c.decision,
          packets,
          bytes,
        });
    }

    this.rules = new Map(counters.map((c) => [c.handle, c]));

    for (const d of this.denied.drain())
      flows.push({
        policy: '',
        src: d.src,
        dst: d.dst,
        protocol: d.protocol,
        port: d.port,
        decision: 'denied',
        packets: d.packets,
        bytes: 0,
      });

    return flows.slice(0, 10_000);
  }
}
