import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';

import type { LogEntry, NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { COMPONENT_LABEL, MANAGED_LABEL } from '../host/managed-containers';
import { ruleTag } from '../network/nftables.renderer';
import { LOG_STORE_COMPONENT } from '../control-plane/log-store';
import { secretDir, WORKLOAD_LABEL } from '../workloads/workload-container';
import { runtimeDir } from '../workloads/workload.manager';
import {
  birdSessions,
  handshakes,
  levelOf,
  parseEgressDecision,
  parseKernelRecord,
  redact,
  workloadLabels,
} from './log-parsing';
import { LogShipper } from './log-shipper';
import { MetricsCollectorService } from '../metrics/metrics-collector.service';

const REFRESH_MS = 10_000;
const POLL_MS = 30_000;
/** A WireGuard peer without a handshake for this long counts as down (it re-handshakes every 2 minutes). */
const HANDSHAKE_STALE_S = 180;

/** Where platform containers' output belongs (3.14). */
function sourceOf(component: string | undefined): LogEntry['source'] {
  switch (component) {
    case 'ingress':
      return 'ingress';
    case 'mesh':
      return 'proxy';
    case 'etcd':
    case 'postgres':
    case 'controlPlane':
      return 'control-plane';
    case 'object-store':
      return 'storage';
    default:
      return 'runtime';
  }
}

/**
 * Collects the node's logs (3.14), enriched with the policy model's identifiers, and hands them to the shipper:
 * container output (workloads and platform components, secrets redacted on the node), container lifecycle events,
 * firewall decisions from the kernel log (with the policy that matched), tunnel handshakes and BGP session changes.
 */
@Injectable()
export class LogCollectorsService implements OnModuleDestroy {
  private readonly logger = new Logger(LogCollectorsService.name);
  private readonly followed = new Map<
    string,
    { stop: () => void; since: number; secrets: string[]; workload?: string }
  >();
  /** Address → local replica, so firewall lines carry the project of the workload they hit (3.14). */
  private replicas = new Map<string, string>();
  private readonly timers: NodeJS.Timeout[] = [];
  private started = false;
  private stopped = false;
  private events: NodeJS.ReadableStream | null = null;
  private kmsg: ChildProcess | null = null;
  /** `lwobs <tag>` → policy of the rule, from the applied firewall. */
  private tags = new Map<string, string>();
  private tunnels = new Map<string, boolean>();
  private sessions = new Map<string, string>();

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly commands: CommandRunner,
    private readonly shipper: LogShipper,
    private readonly metrics: MetricsCollectorService,
  ) {}

  /** Starts once the agent is connected for the first time. */
  start(): void {
    if (this.started || process.env['LOADWEAVER_LOG_COLLECTION'] === 'off') return;

    this.started = true;
    void this.refreshContainers();
    this.timers.push(setInterval(() => void this.refreshContainers(), REFRESH_MS));
    this.timers.push(setInterval(() => void this.pollTunnels(), POLL_MS));
    this.timers.push(setInterval(() => void this.pollRouting(), POLL_MS));
    void this.followEvents();
    this.followKernel();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.timers.forEach((t) => clearInterval(t));

    for (const f of this.followed.values()) f.stop();

    (this.events as { destroy?: () => void } | null)?.destroy?.();
    this.kmsg?.kill();
  }

  /** Local replicas by address (from the applied workload specs). */
  updateWorkloads(workloads: readonly { id: string; addresses?: string[] }[]): void {
    this.replicas = new Map(workloads.flatMap((w) => (w.addresses ?? []).map((a) => [a, w.id] as const)));
  }

  /** The applied firewall: which observe rule belongs to which policy. */
  updateFirewall(config: NodeNetworkConfig): void {
    this.tags = new Map(config.firewall.rules.map((r) => [ruleTag(r.id), r.policy]));
  }

  private emit(entry: Omit<LogEntry, 'at'> & { at?: string }): void {
    this.shipper.push({ at: new Date().toISOString(), ...entry });
  }

  /** Follows the output of every running Loadweaver container (not the log store itself: no feedback loop). */
  async refreshContainers(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({ filters: { label: [`${MANAGED_LABEL}=true`] } });
      const running = new Set<string>();

      for (const c of containers) {
        if (c.Labels?.[COMPONENT_LABEL] === LOG_STORE_COMPONENT) continue;

        running.add(c.Id);

        const followed = this.followed.get(c.Id);

        if (!followed) await this.follow(c);
        // Secrets rotate: what is redacted follows what the node delivered.
        else if (followed.workload) followed.secrets = await this.secretsOf(followed.workload);
      }

      for (const [id, f] of this.followed)
        if (!running.has(id)) {
          f.stop();
          this.followed.delete(id);
        }
    } catch (error) {
      this.logger.warn(`Container logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Secret values delivered to a workload (tmpfs files on this node), for redaction. */
  private async secretsOf(workloadId: string | undefined): Promise<string[]> {
    if (!workloadId) return [];

    const dir = secretDir(runtimeDir(), workloadId);
    const files = await readdir(dir).catch(() => [] as string[]);
    const values: string[] = [];

    for (const file of files.slice(0, 64)) {
      const value = (await readFile(join(dir, file), 'utf8').catch(() => '')).trim();

      if (value.length >= 6 && value.length <= 4096) values.push(value);
    }

    return values;
  }

  private async follow(info: Docker.ContainerInfo): Promise<void> {
    const workload = info.Labels?.[WORKLOAD_LABEL];
    const component = info.Labels?.[COMPONENT_LABEL];
    const source: LogEntry['source'] = workload ? 'container' : sourceOf(component);
    const labels: LogEntry['labels'] = workload
      ? workloadLabels(workload)
      : { component: (component ?? 'platform').slice(0, 64) };
    const since = this.followed.get(info.Id)?.since ?? Math.floor(Date.now() / 1000);
    const stream = (await this.docker.getContainer(info.Id).logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
      since,
    })) as unknown as NodeJS.ReadableStream & {
      destroy: () => void;
    };
    const entry = { stop: () => stream.destroy(), since, secrets: await this.secretsOf(workload), workload };

    this.followed.set(info.Id, entry);

    for (const name of ['stdout', 'stderr'] as const) {
      const out = new PassThrough();

      createInterface({ input: out }).on('line', (raw) => {
        const space = raw.indexOf(' ');
        const at = space > 0 ? raw.slice(0, space) : '';
        const parsed = Date.parse(at);
        const line = redact(space > 0 && !Number.isNaN(parsed) ? raw.slice(space + 1) : raw, entry.secrets);

        entry.since = Math.floor((Number.isNaN(parsed) ? Date.now() : parsed) / 1000);

        // Ingress access lines also feed the per-hostname request metrics (3.18).
        if (source === 'ingress' && line.startsWith('{"')) this.recordRequest(line);

        // Egress decisions of the node proxy belong to the workload that made the request (3.7 / 3.14).
        const egress = source === 'proxy' ? parseEgressDecision(line) : null;
        const replica = egress ? this.replicas.get(egress.source) : undefined;

        this.emit({
          ...(Number.isNaN(parsed) ? {} : { at: new Date(parsed).toISOString() }),
          source,
          level: egress?.decision === 'blocked' ? 'warn' : levelOf(line, name),
          message: line,
          labels: { ...labels, ...(replica ? workloadLabels(replica) : {}), stream: name },
          ...(egress
            ? {
                fields: {
                  egressDecision: egress.decision,
                  ...(egress.rule ? { egressRule: egress.rule } : {}),
                  ...(egress.host ? { egressHost: egress.host.slice(0, 253) } : {}),
                },
              }
            : {}),
        });
      });
      (name === 'stdout' ? this.outs(stream).stdout : this.outs(stream).stderr).pipe(out);
    }
  }

  private recordRequest(line: string): void {
    try {
      const access = JSON.parse(line) as {
        kind?: string;
        host?: string;
        status?: string | number;
        duration_ms?: string | number;
      };

      if (access.kind === 'ingress-http' && access.host)
        this.metrics.requests.record(access.host, Number(access.status) || 0, Number(access.duration_ms) || 0);
    } catch {
      // not an access line
    }
  }

  /** Docker multiplexes stdout / stderr on one stream for containers without a TTY. */
  private demuxed = new WeakMap<object, { stdout: PassThrough; stderr: PassThrough }>();

  private outs(stream: NodeJS.ReadableStream): { stdout: PassThrough; stderr: PassThrough } {
    let pair = this.demuxed.get(stream);

    if (!pair) {
      pair = { stdout: new PassThrough(), stderr: new PassThrough() };
      this.docker.modem.demuxStream(stream, pair.stdout, pair.stderr);
      this.demuxed.set(stream, pair);
    }

    return pair;
  }

  /** Container lifecycle (3.14 runtime): starts, exits with their code, OOM kills. */
  private async followEvents(): Promise<void> {
    try {
      this.events = await this.docker.getEvents({
        filters: {
          type: ['container'],
          event: ['start', 'die', 'oom', 'kill', 'restart'],
          label: [`${MANAGED_LABEL}=true`],
        },
      });
      createInterface({ input: this.events }).on('line', (line) => {
        try {
          const event = JSON.parse(line) as {
            status?: string;
            Action?: string;
            Actor?: { Attributes?: Record<string, string> };
          };
          const attributes = event.Actor?.Attributes ?? {};
          const action = event.Action ?? event.status ?? 'event';
          const workload = attributes[WORKLOAD_LABEL];

          this.emit({
            source: 'runtime',
            level: action === 'oom' || (action === 'die' && attributes['exitCode'] !== '0') ? 'warn' : 'info',
            message: `container ${attributes['name'] ?? ''} ${action}${attributes['exitCode'] ? ` (exit code ${attributes['exitCode']})` : ''}`,
            labels: workload
              ? workloadLabels(workload)
              : { component: (attributes[COMPONENT_LABEL] ?? 'platform').slice(0, 64) },
            fields: { event: action.slice(0, 32) },
          });
        } catch {
          // not an event line
        }
      });
    } catch (error) {
      this.logger.warn(`Docker events: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Firewall drops and monitor-mode observations from the kernel log (new messages only, `dmesg --follow-new`). */
  private followKernel(): void {
    const child = spawn('dmesg', ['--follow-new'], { stdio: ['ignore', 'pipe', 'ignore'] });

    this.kmsg = child;
    child.on('error', (error) => this.logger.warn(`Kernel log unavailable: ${error.message}`));
    createInterface({ input: child.stdout }).on('line', (record) => {
      const parsed = parseKernelRecord(record);

      if (!parsed) return;

      const policy = parsed.tag ? this.tags.get(parsed.tag) : undefined;
      const f = parsed.fields;

      if (parsed.decision === 'denied' && f['src'] && f['dst'])
        this.metrics.denied.record(f['src'], f['dst'], f['proto'] ?? 'any', Number(f['dpt'] ?? 0));

      this.emit({
        source: 'firewall',
        level: parsed.decision === 'denied' ? 'warn' : 'info',
        message: `${parsed.decision} ${f['proto'] ?? ''} ${f['src'] ?? '?'}${f['spt'] ? `:${f['spt']}` : ''} → ${f['dst'] ?? '?'}${f['dpt'] ? `:${f['dpt']}` : ''}${policy ? ` (${policy})` : ''}`,
        // Labelled with the local replica it hit (or came from), so its project sees it.
        labels: {
          ...workloadLabels(this.replicas.get(f['dst'] ?? '') ?? this.replicas.get(f['src'] ?? '')),
          ...(policy ? { policy } : {}),
        },
        fields: { decision: parsed.decision, ...f },
      });
    });
  }

  /** Tunnel up / down from handshake ages (3.14 tunnels). */
  async pollTunnels(now = Math.floor(Date.now() / 1000)): Promise<void> {
    try {
      const peers = handshakes((await this.commands.run('wg', ['show', 'all', 'dump'])).stdout);

      for (const [key, p] of peers) {
        const up = p.handshake > 0 && now - p.handshake <= HANDSHAKE_STALE_S;
        const before = this.tunnels.get(key);

        if (before !== undefined && before !== up)
          this.emit({
            source: 'tunnel',
            level: up ? 'info' : 'warn',
            message: `WireGuard peer on ${p.iface} ${up ? 'up' : 'down (no handshake for 3 minutes)'}`,
            labels: { component: p.iface.slice(0, 64), peer: p.peer.slice(0, 64) },
          });

        this.tunnels.set(key, up);
      }
    } catch {
      // no WireGuard yet
    }
  }

  /** BGP session state changes (3.14 routing). */
  async pollRouting(): Promise<void> {
    try {
      const sessions = birdSessions((await this.commands.run('birdc', ['show', 'protocols'])).stdout);

      for (const [name, state] of sessions) {
        const before = this.sessions.get(name);

        if (before !== undefined && before !== state)
          this.emit({
            source: 'routing',
            level: state === 'Established' ? 'info' : 'warn',
            message: `BGP session ${name}: ${before} → ${state}`,
            labels: { component: name.slice(0, 64) },
          });

        this.sessions.set(name, state);
      }
    } catch {
      // BIRD not running yet
    }
  }
}
