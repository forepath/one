import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  RUNTIMES_WIRE,
  type DesiredState,
  type IsolationProbe,
  type IsolationStateWire,
  type KvmFacts,
  type RuntimeWire,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES, type ImageComponentName } from '@forepath/loadweaver/shared/util-release';
import {
  GVISOR_HOST_SCRIPT_EXIT_CODES,
  GVISOR_RUNTIMES,
  buildGvisorHostScript,
  parseGvisorHostReport,
  parseGvisorRuntimeArgs,
  type GvisorHostKvmFacts,
  type GvisorPlatform,
} from '@forepath/shared/backend/util-container-runtime';
import { Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';

import { AgentStateStore, stateDir } from '../state/agent-state.store';
import { clusterImageFor, componentImage } from '../updates/release-images';
import { CommandRunner } from './command-runner';
import { PROBE_LABEL } from './managed-containers';
import { microvmMigrationSupport, parseImageLabels, type MicrovmMigrationSupport } from '../microvm/microvm-migration';
import { MicrovmProbe } from '../microvm/microvm-probe';

/**
 * Isolation probes (3.1, M7.1): every level is verified on the node itself — runtime registration and arguments
 * (`docker info` → `parseGvisorRuntimeArgs`), the KVM facts of the shared host script (`check --json` →
 * `parseGvisorHostReport`) and a smoke container per Docker runtime — instead of matching runtime names. A level is
 * reported in `capabilities.runtimes` only when its probe passed; the scheduler places a workload only where its exact
 * level is ready.
 *
 * | level         | static check                                                         | smoke test               |
 * | ------------- | -------------------------------------------------------------------- | ------------------------ |
 * | runc          | Docker reachable                                                     | `true` with runc         |
 * | sandboxed     | `runsc-systrap` registered, platform systrap (or default), Netstack  | `dmesg` shows gVisor     |
 * | sandboxed-kvm | KVM usable, not opted out; `runsc-kvm` registered, platform kvm      | `dmesg` shows gVisor     |
 * | microvm       | KVM usable, not opted out, `/dev/net/tun`, the pinned launcher image | (boot probe: M7.2)       |
 *
 * Runs at start (the previous result is reused within the same boot while the fresh one runs), every 6 h
 * (`LOADWEAVER_ISOLATION_PROBE_INTERVAL_MS`), after host updates, after repeated workload start failures on a level
 * and on demand (`desiredState.host.probeNonce`). Changed results are announced to the listeners (the stream sends a
 * fresh hello). Probe containers carry `loadweaver.com/probe=1`: never drift, leftovers removed at start.
 */

/** Smoke-test budget per container (design: 30 s, 64 MiB, no network). */
export const PROBE_TIMEOUT_MS = 30_000;
const HOST_SCRIPT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 6 * 3600_000;
const MIN_INTERVAL_MS = 60_000;
/** Consecutive start failures on a level that trigger a re-probe (Agenstra's `AGENT_ISOLATION_FAILURE_THRESHOLD`). */
export const START_FAILURE_THRESHOLD = 3;
/** Image component of the shared microVM launcher (pinned by the release, M7.2). */
export const MICROVM_LAUNCHER_COMPONENT = 'microvm-launcher';

/** Reason codes, Agenstra's `IsolationReasonCode` strings. */
export const ISOLATION_REASON = {
  DOCKER_UNAVAILABLE: 'E_DOCKER_BASELINE_UNAVAILABLE',
  RUNC_PROBE_FAILED: 'E_RUNC_PROBE_FAILED',
  RUNTIME_NOT_REGISTERED: 'E_RUNTIME_NOT_REGISTERED',
  RUNTIME_MISCONFIGURED: 'E_RUNTIME_MISCONFIGURED',
  PROBE_RUNTIME_MISMATCH: 'E_PROBE_RUNTIME_MISMATCH',
  PROBE_IMAGE_UNAVAILABLE: 'E_PROBE_IMAGE_UNAVAILABLE',
  PROBE_START_FAILED: 'E_PROBE_START_FAILED',
  PROBE_TIMEOUT: 'E_PROBE_TIMEOUT',
  KVM_UNAVAILABLE: 'E_KVM_UNAVAILABLE',
  DISABLED_BY_ADMIN: 'E_DISABLED_BY_ADMIN',
  MICROVM_IMAGE_UNSUPPORTED: 'E_MICROVM_IMAGE_UNSUPPORTED',
  MICROVM_BOOT_FAILED: 'E_MICROVM_BOOT_FAILED',
} as const;

export type IsolationLevels = Partial<Record<RuntimeWire, IsolationProbe>>;
export type HostSettings = NonNullable<DesiredState['host']>;
export type DockerRuntimes = Record<string, { path?: string; runtimeArgs?: string[] } | undefined>;

export interface IsolationReport {
  checkedAt: string;
  /** Kernel boot the report belongs to (`/proc/sys/kernel/random/boot_id`): never reused across a reboot. */
  bootId?: string;
  levels: IsolationLevels;
  /** The ready levels, in ladder order (`capabilities.runtimes`). */
  runtimes: RuntimeWire[];
  kvm?: KvmFacts;
  cpuFlagsHash?: string;
  /** Docker's runtimes as probed (for the checkpoint capability). */
  dockerRuntimes: DockerRuntimes;
  /** The microVM launcher on this node (`capabilities.microvm`, 3.35): when the microvm level was probed. */
  microvm?: { launcherDigest: string; unpackCache: boolean; thinPool: boolean; migration?: MicrovmMigrationSupport };
}

interface StoredIsolation {
  host?: { kvm: 'auto' | 'disabled'; probeNonce?: string };
  report?: IsolationReport;
}

/** Host access of the probes (overridable in tests). */
export interface ProbeHost {
  readText(path: string): Promise<string>;
  /** The device opens read-write (the agent runs as root; a stale or permission-less node fails). */
  openable(path: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  now(): Date;
}

export const defaultProbeHost: ProbeHost = {
  readText: async (path) => await readFile(path, 'utf8').catch(() => ''),
  openable: async (path) => {
    try {
      const handle = await open(path, constants.O_RDWR);

      await handle.close();

      return true;
    } catch {
      return false;
    }
  },
  exists: async (path) =>
    await access(path).then(
      () => true,
      () => false,
    ),
  now: () => new Date(),
};

/** Hash of the CPU's feature flags (first `flags` / `Features` line): VMs with `host-passthrough` migrate only between equal values. */
export function cpuFlagsHash(cpuinfo: string): string | undefined {
  const line = /^(?:flags|Features)\s*:\s*(.*)$/m.exec(cpuinfo)?.[1];
  const flags = [...new Set((line ?? '').split(/\s+/).filter((f) => /^[A-Za-z0-9_.-]+$/.test(f)))].sort();

  return flags.length ? createHash('sha256').update(flags.join(' ')).digest('hex') : undefined;
}

/**
 * KVM usable for the KVM levels: `/dev/kvm` exists and opens, and the CPU doesn't lack virtualization. A present
 * device implies the module is loaded or built in (arm64 kernels build KVM in, where `/proc/modules` doesn't list it
 * and the CPU flag check is `unknown`).
 */
export function kvmUsable(facts: GvisorHostKvmFacts, openable: boolean): boolean {
  return facts.device === 'present' && facts.cpu !== 'no' && openable;
}

/** The gVisor runtime of a platform is registered as the level needs it: its platform, gVisor's own network stack. */
export function gvisorRuntimeProblem(platform: GvisorPlatform, runtimes: DockerRuntimes): string | null {
  const name = GVISOR_RUNTIMES[platform].runtime;
  const entry = runtimes[name];

  if (!entry) return null;

  const args = parseGvisorRuntimeArgs(entry.runtimeArgs);
  const platformOk =
    platform === 'systrap' ? args.platform === null || args.platform === 'systrap' : args.platform === 'kvm';

  if (!platformOk)
    return `Docker runtime '${name}' runs gVisor with --platform=${args.platform ?? '(default)'}, the ${platform} platform is expected`;

  if (args.network !== null)
    return `Docker runtime '${name}' runs gVisor with --network=${args.network}; workloads need gVisor's own network stack`;

  return null;
}

/** `capabilities.sandboxProbe` (protocol v1 control planes) derived from the sandboxed level. */
export function sandboxProbeOf(probe: IsolationProbe | undefined): 'ready' | 'missing' | 'failed' | 'unknown' {
  if (!probe) return 'unknown';

  if (probe.state === 'ready') return 'ready';

  return probe.state === 'unsupported' || probe.state === 'disabled-by-admin' ? 'missing' : 'failed';
}

/** What decides whether the probe result changed (and the control plane needs a fresh hello). */
function signature(report: IsolationReport): string {
  return JSON.stringify({
    runtimes: report.runtimes,
    levels: RUNTIMES_WIRE.map((l) => [l, report.levels[l]?.state, report.levels[l]?.reasonCode]),
    kvm: report.kvm ? [report.kvm.usable, report.kvm.optOut, report.kvm.device, report.kvm.nested] : null,
    cpu: report.cpuFlagsHash ?? null,
  });
}

function probeIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env['LOADWEAVER_ISOLATION_PROBE_INTERVAL_MS']);

  return Number.isSafeInteger(value) && value > 0 ? Math.max(value, MIN_INTERVAL_MS) : DEFAULT_INTERVAL_MS;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && /exit signal|ETIMEDOUT|timed out|SIGTERM/i.test(error.message);
}

@Injectable()
export class IsolationProbeService implements OnApplicationShutdown {
  private readonly logger = new Logger(IsolationProbeService.name);
  private report: IsolationReport | null = null;
  private stored: StoredIsolation | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private readonly listeners: ((report: IsolationReport) => void)[] = [];
  private readonly failures = new Map<RuntimeWire, number>();
  /** Overridable in tests. */
  host: ProbeHost = defaultProbeHost;
  /** The release's microVM launcher image (overridable in tests). */
  launcher: () => string | null = launcherImage;

  constructor(
    private readonly commands: CommandRunner,
    @Optional() private readonly state?: AgentStateStore,
    @Optional() private readonly microvmProbe?: MicrovmProbe,
  ) {}

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);

    this.timer = null;
  }

  /** Called with the new report whenever a probe changed the result. */
  onChange(listener: (report: IsolationReport) => void): void {
    this.listeners.push(listener);
  }

  /**
   * The current result: the last probe of this boot, else a fresh one. A stored result of the same boot is answered
   * at once while a new probe runs (a restarted agent connects without waiting for the smoke tests).
   */
  async current(): Promise<IsolationReport> {
    this.start();

    if (this.report) return this.report;

    const stored = (await this.load()).report;

    if (stored && stored.bootId && stored.bootId === (await this.bootId())) {
      this.report = stored;
      void this.reprobe('agent start');

      return stored;
    }

    return await this.reprobe('agent start');
  }

  /** The node spec's KVM opt-out as last received (`desiredState.host.kvm`). */
  async optedOut(): Promise<boolean> {
    return (await this.load()).host?.kvm === 'disabled';
  }

  /**
   * For host updates (3.1): whether KVM is opted out, and whether the node uses (or could use) KVM, so the update
   * installs the KVM modules for its kernels from the snapshot.
   */
  async kvmPlan(): Promise<{ optOut: boolean; capable: boolean }> {
    const optOut = await this.optedOut();
    const kvm = (this.report ?? (await this.load()).report)?.kvm;

    return { optOut, capable: !!kvm && (kvm.usable || kvm.cpu === 'yes') };
  }

  /**
   * Host settings of the desired state (3.1, feature `isolation-ladder`): a changed KVM opt-out removes (`disabled`)
   * or registers again (`auto`) the gVisor KVM runtimes through the shared host script — never downloading anything —
   * and re-probes; a new probe nonce re-probes.
   */
  async applyHost(host: HostSettings | undefined): Promise<void> {
    const stored = await this.load();
    const previous = stored.host ?? { kvm: 'auto' as const };
    const next = { kvm: host?.kvm ?? 'auto', ...(host?.probeNonce ? { probeNonce: host.probeNonce } : {}) };

    if (previous.kvm === next.kvm && previous.probeNonce === next.probeNonce) return;

    await this.save({ ...stored, host: next });

    if (previous.kvm !== next.kvm) {
      this.logger.log(
        `KVM ${next.kvm === 'disabled' ? 'opted out by the node spec' : 'allowed again by the node spec'}`,
      );
      await this.hostScript(next.kvm === 'disabled' ? 'uninstall-kvm' : 'install-kvm').catch((error: unknown) =>
        this.logger.warn(`KVM runtimes not changed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }

    await this.reprobe(previous.kvm !== next.kvm ? 'KVM opt-out changed' : 'probe requested');
  }

  /** A workload of the level failed to start: the third failure in a row re-probes the level's runtime. */
  recordStartFailure(level: RuntimeWire): void {
    const count = (this.failures.get(level) ?? 0) + 1;

    if (count < START_FAILURE_THRESHOLD) {
      this.failures.set(level, count);

      return;
    }

    this.failures.delete(level);
    void this.reprobe(`${START_FAILURE_THRESHOLD} start failures on ${level}`);
  }

  recordStartSuccess(level: RuntimeWire): void {
    this.failures.delete(level);
  }

  /** Runs the probes now (serialized); announces a changed result. */
  reprobe(reason: string): Promise<IsolationReport> {
    const run = this.chain.then(async () => {
      const before = this.report;
      const report = await this.probe();

      this.report = report;
      await this.save({ ...(await this.load()), report });

      if (!before || signature(before) !== signature(report)) {
        this.logger.log(
          `Isolation probe (${reason}): ready ${report.runtimes.join(', ') || 'none'}${RUNTIMES_WIRE.filter(
            (l) => report.levels[l] && report.levels[l]?.state !== 'ready',
          )
            .map((l) => `; ${l} ${report.levels[l]?.state} (${report.levels[l]?.reasonCode ?? '-'})`)
            .join('')}`,
        );

        if (before) for (const listener of this.listeners) listener(report);
      }

      return report;
    });

    this.chain = run.catch(() => undefined);

    return run;
  }

  /** One probe of every level (see the class documentation). */
  async probe(): Promise<IsolationReport> {
    const checkedAt = this.host.now().toISOString();
    const result = (state: IsolationStateWire, reasonCode?: string, reason?: string): IsolationProbe => ({
      state,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reason ? { reason: reason.slice(0, 512) } : {}),
      checkedAt,
    });
    const optOut = await this.optedOut();
    const [docker, facts, cpuinfo, bootId] = await Promise.all([
      this.dockerRuntimes(),
      this.kvmFacts(),
      this.host.readText('/proc/cpuinfo'),
      this.bootId(),
    ]);
    const usable = !!facts && kvmUsable(facts, facts.device === 'present' && (await this.host.openable('/dev/kvm')));
    const kvm: KvmFacts | undefined = facts
      ? {
          cpu: facts.cpu,
          device: facts.device,
          module: facts.module,
          nested: facts.nested,
          hypervisor: facts.hypervisor,
          usable,
          optOut,
        }
      : undefined;
    const kvmReason = facts
      ? `KVM is not usable on this node (cpu=${facts.cpu} device=${facts.device} module=${facts.module} nested=${facts.nested})`
      : 'KVM facts unavailable (the host script did not report them)';
    const levels: IsolationLevels = {};
    let microvm: IsolationReport['microvm'];

    if (!docker) {
      for (const level of RUNTIMES_WIRE)
        levels[level] = result('probe-failed', ISOLATION_REASON.DOCKER_UNAVAILABLE, 'Docker is not reachable');
    } else {
      await this.removeLeftovers();

      const image = await this.probeImage();

      // runc: the floor every other level builds on.
      if (!image)
        levels.runc = result(
          'ready',
          ISOLATION_REASON.PROBE_IMAGE_UNAVAILABLE,
          'the probe image is unavailable; Docker answers, the runc smoke test was skipped',
        );
      else {
        const smoke = await this.smoke('runc', 'runc', image, ['true']);

        levels.runc = smoke.ok
          ? result('ready')
          : result(
              'probe-failed',
              smoke.timeout ? ISOLATION_REASON.PROBE_TIMEOUT : ISOLATION_REASON.RUNC_PROBE_FAILED,
              smoke.error,
            );
      }

      const floor = levels.runc.state === 'ready';
      const gvisor = async (
        level: 'sandboxed' | 'sandboxed-kvm',
        platform: GvisorPlatform,
      ): Promise<IsolationProbe> => {
        const name = GVISOR_RUNTIMES[platform].runtime;

        if (!docker[name])
          return result(
            'unsupported',
            ISOLATION_REASON.RUNTIME_NOT_REGISTERED,
            `Docker runtime '${name}' is not registered`,
          );

        const problem = gvisorRuntimeProblem(platform, docker);

        if (problem) return result('unsupported', ISOLATION_REASON.RUNTIME_MISCONFIGURED, problem);

        if (!floor) return result('probe-failed', ISOLATION_REASON.RUNC_PROBE_FAILED, 'the runc probe failed');

        if (!image)
          return result(
            'probe-failed',
            ISOLATION_REASON.PROBE_IMAGE_UNAVAILABLE,
            `the probe image is unavailable; ${name} cannot be verified`,
          );

        const smoke = await this.smoke(level, name, image, ['dmesg']);

        if (!smoke.ok)
          return result(
            'probe-failed',
            smoke.timeout ? ISOLATION_REASON.PROBE_TIMEOUT : ISOLATION_REASON.PROBE_START_FAILED,
            smoke.error,
          );

        return /gVisor/i.test(smoke.stdout)
          ? result('ready')
          : result(
              'probe-failed',
              ISOLATION_REASON.PROBE_RUNTIME_MISMATCH,
              `the container of '${name}' did not run on gVisor`,
            );
      };

      levels.sandboxed = await gvisor('sandboxed', 'systrap');
      levels['sandboxed-kvm'] = optOut
        ? result(
            'disabled-by-admin',
            ISOLATION_REASON.DISABLED_BY_ADMIN,
            'KVM is disabled by the node spec (virtualization.kvm)',
          )
        : !usable
          ? result('unsupported', ISOLATION_REASON.KVM_UNAVAILABLE, kvmReason)
          : await gvisor('sandboxed-kvm', 'kvm');
      levels.microvm = optOut
        ? result(
            'disabled-by-admin',
            ISOLATION_REASON.DISABLED_BY_ADMIN,
            'KVM is disabled by the node spec (virtualization.kvm)',
          )
        : !usable
          ? result('unsupported', ISOLATION_REASON.KVM_UNAVAILABLE, kvmReason)
          : await this.microvm(result, floor, (facts) => (microvm = facts));
    }

    const flags = cpuFlagsHash(cpuinfo);

    return {
      checkedAt,
      ...(bootId ? { bootId } : {}),
      levels,
      runtimes: RUNTIMES_WIRE.filter((l) => levels[l]?.state === 'ready'),
      ...(kvm ? { kvm } : {}),
      ...(flags ? { cpuFlagsHash: flags } : {}),
      dockerRuntimes: docker ?? {},
      ...(microvm ? { microvm } : {}),
    };
  }

  /**
   * microVM readiness: `/dev/net/tun`, the release's launcher image on the node, then the boot probe (M7.2:
   * {@link MicrovmProbe}, which also checks the image unpack cache).
   */
  private async microvm(
    result: (state: IsolationStateWire, reasonCode?: string, reason?: string) => IsolationProbe,
    floor: boolean,
    report: (facts: NonNullable<IsolationReport['microvm']>) => void,
  ): Promise<IsolationProbe> {
    if (!floor)
      return result(
        'probe-failed',
        ISOLATION_REASON.RUNC_PROBE_FAILED,
        'the runc probe failed (the launcher runs on runc)',
      );

    if (!(await this.host.exists('/dev/net/tun')))
      return result('unsupported', ISOLATION_REASON.MICROVM_BOOT_FAILED, '/dev/net/tun is missing (tap networking)');

    const launcher = this.launcher();

    if (!launcher)
      return result(
        'unsupported',
        ISOLATION_REASON.MICROVM_IMAGE_UNSUPPORTED,
        'this agent build pins no microVM launcher image',
      );

    const cluster = clusterImageFor(launcher);

    const local = (await this.imagePresent(launcher))
      ? launcher
      : cluster && (await this.imagePresent(cluster))
        ? cluster
        : null;

    if (!local)
      return result(
        'unsupported',
        ISOLATION_REASON.PROBE_IMAGE_UNAVAILABLE,
        `the microVM launcher image ${launcher} is not on this node`,
      );

    if (!this.microvmProbe) return result('ready');

    const probe = await this.microvmProbe.run(local, await this.probeImage());
    const launcherDigest = await this.commands
      .run('docker', ['image', 'inspect', '--format', '{{.Id}}', local], { timeoutMs: 15_000 })
      .then((r) => r.stdout.trim().slice(0, 100))
      .catch(() => '');

    // Live migration of generic microVMs (M7 W10b): what the launcher image declares (QEMU / virtiofsd versions).
    const labels = await this.commands
      .run('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', local], { timeoutMs: 15_000 })
      .then((r) => parseImageLabels(r.stdout))
      .catch(() => ({}));

    report({
      launcherDigest,
      unpackCache: probe.unpackCache,
      thinPool: probe.thinPool,
      migration: microvmMigrationSupport(labels),
    });

    if (!probe.ok)
      return result(
        probe.reasonCode === ISOLATION_REASON.PROBE_TIMEOUT ? 'probe-failed' : 'unsupported',
        probe.reasonCode,
        probe.reason,
      );

    return result('ready');
  }

  /** Docker's registered runtimes, or null when Docker doesn't answer. */
  private async dockerRuntimes(): Promise<DockerRuntimes | null> {
    try {
      const info = await this.commands.json<{ Runtimes?: DockerRuntimes }>(
        'docker',
        ['info', '--format', '{{json .}}'],
        {
          timeoutMs: 15_000,
        },
      );

      return info?.Runtimes ?? {};
    } catch {
      return null;
    }
  }

  /** KVM facts of the shared host script (`check --json`, read-only). */
  private async kvmFacts(): Promise<GvisorHostKvmFacts | null> {
    const out = await this.hostScript('check').catch(() => '');

    return parseGvisorHostReport(out)?.kvm ?? null;
  }

  /**
   * Runs the shared gVisor host script (written below the state directory; `kvmApt: false`: packages come only from
   * the release's snapshot). Never `install`: that would (re)install a gVisor release.
   */
  private async hostScript(command: 'check' | 'install-kvm' | 'uninstall-kvm'): Promise<string> {
    const dir = join(this.state?.dir ?? stateDir(), 'isolation');
    const path = join(dir, 'gvisor-host.sh');
    const content = buildGvisorHostScript({ kvmApt: false });

    if ((await readFile(path, 'utf8').catch(() => null)) !== content) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(path, content, { mode: 0o700 });
    }

    const { stdout } = await this.commands.run('env', ['AGENSTRA_KVM_APT=0', 'bash', path, command, '--json'], {
      timeoutMs: HOST_SCRIPT_TIMEOUT_MS,
      okExitCodes: Object.values(GVISOR_HOST_SCRIPT_EXIT_CODES),
    });

    return stdout;
  }

  private async bootId(): Promise<string | undefined> {
    return (await this.host.readText('/proc/sys/kernel/random/boot_id')).trim() || undefined;
  }

  private async imagePresent(image: string): Promise<boolean> {
    return await this.commands
      .run('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 15_000 })
      .then(
        () => true,
        () => false,
      );
  }

  /** The node shell image for the smoke tests: present, pulled, or the release's copy in the cluster registry. */
  private async probeImage(): Promise<string | null> {
    const image = componentImage('node-shell');
    const cluster = clusterImageFor(image);

    for (const ref of [image, cluster]) if (ref && (await this.imagePresent(ref))) return ref;

    for (const ref of [image, cluster]) {
      if (!ref) continue;

      const pulled = await this.commands.run('docker', ['pull', '-q', ref], { timeoutMs: 300_000 }).then(
        () => true,
        () => false,
      );

      if (pulled) return ref;
    }

    return null;
  }

  /** One smoke container: no network, 64 MiB, labelled as a probe, removed afterwards (also on timeout). */
  private async smoke(
    level: string,
    runtime: string,
    image: string,
    command: string[],
  ): Promise<{ ok: boolean; stdout: string; timeout?: boolean; error?: string }> {
    const name = `lw-probe-${level}-${randomBytes(4).toString('hex')}`;

    try {
      const { stdout } = await this.commands.run(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          name,
          '--label',
          `${PROBE_LABEL}=1`,
          '--network',
          'none',
          '--memory',
          '64m',
          '--pids-limit',
          '64',
          '--runtime',
          runtime,
          '--entrypoint',
          command[0],
          image,
          ...command.slice(1),
        ],
        { timeoutMs: PROBE_TIMEOUT_MS },
      );

      return { ok: true, stdout };
    } catch (error) {
      await this.commands.run('docker', ['rm', '-f', name], { timeoutMs: 15_000 }).catch(() => undefined);

      return {
        ok: false,
        stdout: '',
        timeout: isTimeout(error),
        error: `smoke test with ${runtime} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /** Probe containers a previous agent left behind (killed mid-probe). */
  private async removeLeftovers(): Promise<void> {
    const ids = await this.commands
      .run('docker', ['ps', '-aq', '--filter', `label=${PROBE_LABEL}=1`], { timeoutMs: 15_000 })
      .then((r) => r.stdout.split(/\s+/).filter((id) => /^[0-9a-f]{12,64}$/.test(id)))
      .catch(() => [] as string[]);

    if (ids.length)
      await this.commands.run('docker', ['rm', '-f', ...ids], { timeoutMs: 30_000 }).catch(() => undefined);
  }

  private start(): void {
    if (this.started) return;

    this.started = true;
    this.timer = setInterval(() => void this.reprobe('periodic').catch(() => undefined), probeIntervalMs());
    this.timer.unref?.();
  }

  private async load(): Promise<StoredIsolation> {
    if (this.stored) return this.stored;

    const raw = (await this.state?.isolationState().catch(() => null)) as StoredIsolation | null | undefined;
    let stored: StoredIsolation = raw && typeof raw === 'object' ? raw : {};

    // Before the first host settings: the opt-out of the last applied desired state.
    if (!stored.host) {
      const kvm = (await this.state?.appliedState().catch(() => null))?.host?.kvm;

      if (kvm) stored = { ...stored, host: { kvm } };
    }

    this.stored = stored;

    return stored;
  }

  private async save(stored: StoredIsolation): Promise<void> {
    this.stored = stored;
    await this.state
      ?.saveIsolationState(stored)
      .catch((error: unknown) =>
        this.logger.warn(`Isolation state not saved: ${error instanceof Error ? error.message : String(error)}`),
      );
  }
}

/** The release's microVM launcher image, once the release pins one (`COMPONENT_IMAGES['microvm-launcher']`). */
export function launcherImage(): string | null {
  return MICROVM_LAUNCHER_COMPONENT in COMPONENT_IMAGES
    ? componentImage(MICROVM_LAUNCHER_COMPONENT as ImageComponentName)
    : null;
}
