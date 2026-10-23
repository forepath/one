import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseGvisorRuntimeArgs } from '@forepath/shared/backend/util-container-runtime';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { stateDir } from '../state/agent-state.store';
import { CRIU_OPTIONS } from './checkpoint.manager';
import { ensureHolder, HOLDER_TARGET, holderPath } from './holder';
import { SANDBOX_KVM_RUNTIME, SANDBOX_RUNTIME } from './workload-container';

/**
 * Agent-managed runtime of restored replicas (3.10). Restoring through Docker is broken (moby wires the network
 * namespace from the task's pid before the shim restores), so a restored replica is a Docker container running a
 * placeholder (`holder.ts`) plus the restored process tree as a runc container in the agent's own runc root that
 * shares the placeholder's network namespace, root filesystem (the same overlay mount), mounts and cgroup:
 *
 * - Docker keeps providing what it always does for the replica: image + writable layer, volumes through the volume
 *   plugin, the (kept) address, health checks (run next to the process, same filesystem and network), stats (the
 *   restored tasks live in a child of the container's cgroup, so limits and usage stay Docker's), logs (the restored
 *   process writes into the container's own stdout / stderr FIFOs, so `docker logs` and the log pipeline see it).
 * - The agent provides exec (`runc exec` in the restored namespaces, live terminals), stop / kill and adoption.
 *
 * Until its next restart: when the restored process exits, the placeholder goes too and the replica is created
 * through Docker again as usual.
 *
 * gVisor replicas (stop-and-copy) work the same way with `runsc restore` (agent root `/run/loadweaver/runsc`): the
 * sandbox joins the placeholder's network namespace and copies its interfaces, addresses and routes into its own
 * network stack at restore (`--network=sandbox`, the kept address included); established TCP connections come back
 * from the checkpoint (gVisor's live TCP migration). The placeholder's kernel never sees the app's traffic (runsc takes
 * the address off its `eth0`), so Docker's health check can't probe it: the agent runs it through `runsc exec`.
 */

/** Label of a placeholder container: the migration it was restored from. */
export const RESTORED_LABEL = 'loadweaver.com/restored';

/** Label of a placeholder container: the runtime of its restored process tree (`runc`, `runsc`). */
export const RESTORED_RUNTIME_LABEL = 'loadweaver.com/restored-runtime';

/** Label of a gVisor placeholder: the replica's health check (Docker's form, JSON), run by the agent. */
export const RESTORED_HEALTH_LABEL = 'loadweaver.com/restored-health';

export type RestoredKind = 'runc' | 'runsc';

/**
 * Label of a gVisor placeholder: the platform its sandbox is restored on (`systrap`, `kvm`; M7.1). A checkpoint is
 * only ever restored on the platform it was taken on — never a systrap checkpoint on `runsc-kvm` or vice versa.
 */
export const RESTORED_PLATFORM_LABEL = 'loadweaver.com/restored-platform';

/** gVisor platforms Loadweaver runs (sandboxed: systrap, sandboxed-kvm: KVM). */
export type GvisorPlatform = 'systrap' | 'kvm';

/** The platform of gVisor runtime flags: `kvm`, or systrap (also gVisor's default without `--platform`); else null. */
export function gvisorPlatformOf(runtimeArgs: readonly string[] | undefined): GvisorPlatform | null {
  const { platform } = parseGvisorRuntimeArgs(runtimeArgs ?? []);

  return platform === 'kvm' ? 'kvm' : platform === null || platform === 'systrap' ? 'systrap' : null;
}

/** The gVisor platform of a placeholder (labels; systrap for placeholders from before the label). */
export function restoredPlatform(labels: Record<string, string> | undefined): GvisorPlatform {
  return labels?.[RESTORED_PLATFORM_LABEL] === 'kvm' ? 'kvm' : 'systrap';
}

export function restoredRuncRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_RESTORED_RUNC_ROOT'] || '/run/loadweaver/runc';
}

export function restoredRunscRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_RESTORED_RUNSC_ROOT'] || '/run/loadweaver/runsc';
}

/** The runtime of a restored replica's process tree, from its placeholder's labels. */
export function restoredKind(labels: Record<string, string> | undefined): RestoredKind {
  return labels?.[RESTORED_RUNTIME_LABEL] === 'runsc' ? 'runsc' : 'runc';
}

/** A gVisor runtime as Docker runs it: binary and runtime arguments (`--platform=systrap`, …). */
export interface SandboxRuntime {
  binary: string;
  args: string[];
}

/**
 * The gVisor runtime registered with Docker for a platform (M7.1): the Loadweaver name first ({@link SANDBOX_RUNTIME},
 * {@link SANDBOX_KVM_RUNTIME}), else another `runsc*` runtime — always with gVisor's own network stack and exactly
 * that platform, so a restore uses the checkpointed sandbox's platform. Without `platform` (commands on existing
 * sandboxes: state, list, kill, exec, which don't depend on it) any such runtime, systrap first.
 */
export function sandboxRuntimeOf(
  runtimes: Record<string, { path?: string; runtimeArgs?: string[] } | undefined>,
  platform?: GvisorPlatform,
): SandboxRuntime | null {
  const netstack = (args: string[] = []) => !args.some((a) => /^--?network=(host|none)$/.test(a));
  const preferred =
    platform === 'kvm' ? [SANDBOX_KVM_RUNTIME] : platform ? [SANDBOX_RUNTIME] : [SANDBOX_RUNTIME, SANDBOX_KVM_RUNTIME];
  const names = [
    ...preferred.filter((n) => runtimes[n]),
    ...Object.keys(runtimes)
      .filter((n) => n.startsWith('runsc') && !preferred.includes(n))
      .sort(),
  ];

  for (const name of names) {
    const entry = runtimes[name];
    const args = entry?.runtimeArgs ?? [];
    const own = gvisorPlatformOf(args);

    if (!entry || !netstack(args) || !own || (platform && own !== platform)) continue;

    return { binary: entry.path || 'runsc', args };
  }

  return null;
}

/** A health check as the agent runs it for gVisor replicas (Docker's semantics and defaults). */
export interface RestoredHealthCheck {
  test: string[];
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startPeriodMs: number;
}

/** Docker's health check config → the agent's (null when there is none or it is disabled). */
export function restoredHealthCheck(config: Docker.HealthConfig | null | undefined): RestoredHealthCheck | null {
  const test = config?.Test ?? [];

  if (test.length < 2 || !['CMD', 'CMD-SHELL'].includes(test[0])) return null;

  const ms = (ns: number | undefined, fallback: number) => (ns && ns > 0 ? Math.round(ns / 1e6) : fallback);

  return {
    test,
    intervalMs: ms(config?.Interval, 30_000),
    timeoutMs: ms(config?.Timeout, 30_000),
    retries: config?.Retries && config.Retries > 0 ? config.Retries : 3,
    startPeriodMs: ms(config?.StartPeriod, 0),
  };
}

/** The command of a health check test: `CMD` runs as is, `CMD-SHELL` through `/bin/sh -c`. */
export function healthCommand(test: readonly string[]): string[] {
  return test[0] === 'CMD-SHELL' ? ['/bin/sh', '-c', test.slice(1).join(' ')] : test.slice(1);
}

type HealthStatus = 'starting' | 'healthy' | 'unhealthy';

interface HealthState {
  check: RestoredHealthCheck;
  startedAt: number;
  failures: number;
  status: HealthStatus;
  running: boolean;
  timer: NodeJS.Timeout;
}

/** Docker's health state transition after one probe. */
export function nextHealth(
  state: Pick<HealthState, 'status' | 'failures' | 'startedAt'>,
  check: Pick<RestoredHealthCheck, 'retries' | 'startPeriodMs'>,
  ok: boolean,
  now: number,
): { status: HealthStatus; failures: number } {
  if (ok) return { status: 'healthy', failures: 0 };

  // Failures in the start period don't count while the replica never was healthy.
  if (state.status === 'starting' && now - state.startedAt < check.startPeriodMs)
    return { status: 'starting', failures: 0 };

  const failures = state.failures + 1;

  return { status: failures >= check.retries ? 'unhealthy' : state.status, failures };
}

const RESTORE_TIMEOUT_MS = 5 * 60_000;

interface OciConfig {
  root?: { path?: string };
  process?: unknown;
  mounts?: { destination: string; type?: string; source?: string; options?: string[] }[];
  linux?: { namespaces?: { type: string; path?: string }[]; cgroupsPath?: string };
  [key: string]: unknown;
}

/**
 * Host cgroup (relative to `/sys/fs/cgroup`, cgroup v2) of a container from its OCI `cgroupsPath`:
 * systemd style `slice:prefix:name` → `slice/prefix-name.scope`, cgroupfs style paths as they are.
 */
export function hostCgroup(cgroupsPath: string): string {
  const systemd = /^([^:/]+):([^:]+):(.+)$/.exec(cgroupsPath);

  if (systemd) {
    const [, slice, prefix, name] = systemd;
    // Nested slices: `a-b.slice` lives in `a.slice/a-b.slice`.
    const parts = slice.replace(/\.slice$/, '').split('-');
    const slices = parts.map((_, i) => `${parts.slice(0, i + 1).join('-')}.slice`);

    return [...(slice === '-.slice' ? [] : slices), `${prefix}-${name}.scope`].join('/');
  }

  return cgroupsPath.replace(/^\/+/, '');
}

/**
 * The runc bundle config of a restored replica, from its placeholder container's own config: same root, mounts and
 * namespaces, minus the placeholder binary; the network namespace is the placeholder's; the cgroup a child of the
 * placeholder's (cgroupfs path).
 */
export function restoredConfig(holder: OciConfig, holderPid: number, cgroup: string): OciConfig {
  return {
    ...holder,
    mounts: (holder.mounts ?? []).filter((m) => m.destination !== HOLDER_TARGET),
    linux: {
      ...holder.linux,
      namespaces: (holder.linux?.namespaces ?? []).map((ns) =>
        ns.type === 'network' ? { type: 'network', path: `/proc/${holderPid}/ns/net` } : ns,
      ),
      cgroupsPath: `/${cgroup}/app`,
    },
  };
}

/**
 * nftables table dropping forwarded and local traffic to a replica's addresses while it is restored (null without
 * addresses). Only valid IPv4 / IPv6 literals get in.
 */
export function restoreLockRules(table: string, addresses: readonly string[]): string | null {
  const v4 = [...new Set(addresses.filter((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)))];
  const v6 = [...new Set(addresses.filter((a) => /^[0-9a-fA-F:]+$/.test(a) && a.includes(':')))];

  if (v4.length + v6.length === 0) return null;

  const drops = [
    ...(v4.length ? [`ip daddr { ${v4.join(', ')} } drop`] : []),
    ...(v6.length ? [`ip6 daddr { ${v6.join(', ')} } drop`] : []),
  ];
  const chain = (name: string) => [
    `  chain ${name} {`,
    `    type filter hook ${name} priority -400;`,
    ...drops.map((d) => `    ${d}`),
    '  }',
  ];

  return [`table inet ${table} {`, ...chain('forward'), ...chain('output'), '}', ''].join('\n');
}

/** Placeholder container options derived from the replica's normal Docker options. */
export function holderOptions(
  options: Docker.ContainerCreateOptions,
  migration: string,
  holderBinary: string,
  imageHealthcheck?: Docker.HealthConfig,
): Docker.ContainerCreateOptions {
  const sandboxed = !!options.HostConfig?.Runtime?.startsWith('runsc');
  // gVisor: Docker would probe the placeholder's kernel, not the sandbox; the agent runs the check (runsc exec).
  const health = sandboxed ? restoredHealthCheck(options.Healthcheck ?? imageHealthcheck) : null;
  // The replica's level decides the platform (M7.1): restored on the platform it was checkpointed on.
  const platform: GvisorPlatform = options.HostConfig?.Runtime === SANDBOX_KVM_RUNTIME ? 'kvm' : 'systrap';

  return {
    ...options,
    Entrypoint: [HOLDER_TARGET],
    Cmd: [],
    ...(sandboxed ? { Healthcheck: { Test: ['NONE'] } } : {}),
    Labels: {
      ...(options.Labels ?? {}),
      [RESTORED_LABEL]: migration,
      [RESTORED_RUNTIME_LABEL]: sandboxed ? 'runsc' : 'runc',
      ...(sandboxed ? { [RESTORED_PLATFORM_LABEL]: platform } : {}),
      ...(health ? { [RESTORED_HEALTH_LABEL]: JSON.stringify(health) } : {}),
    },
    HostConfig: {
      ...options.HostConfig,
      // The agent restarts nothing here: when the restored process exits, the replica goes back to Docker.
      RestartPolicy: { Name: 'no' },
      // gVisor restores bring their own sandbox; the placeholder only holds namespaces and mounts.
      Runtime: 'runc',
      Mounts: [
        ...(options.HostConfig?.Mounts ?? []),
        { Type: 'bind', Source: holderBinary, Target: HOLDER_TARGET, ReadOnly: true },
      ],
    },
  };
}

@Injectable()
export class RestoredRuntime implements OnModuleDestroy {
  private readonly logger = new Logger(RestoredRuntime.name);
  private readonly sandboxes = new Map<GvisorPlatform | 'any', SandboxRuntime>();
  private readonly health = new Map<string, HealthState>();

  constructor(
    private readonly commands: CommandRunner,
    @Inject(DOCKER) private readonly docker: Docker,
  ) {}

  onModuleDestroy(): void {
    for (const state of this.health.values()) clearInterval(state.timer);

    this.health.clear();
  }

  /** The runc / runsc container name of a replica's restored process tree. */
  static runcName(holderId: string): string {
    return `lwr-${holderId.slice(0, 32)}`;
  }

  private runc(args: string[]): string[] {
    return ['--root', restoredRuncRoot(), ...args];
  }

  /**
   * Docker's gVisor runtime (binary + flags) for a platform, looked up once per platform (M7.1); without a platform
   * any Netstack runtime (commands on existing sandboxes).
   */
  async sandboxRuntime(platform?: GvisorPlatform): Promise<SandboxRuntime> {
    const cached = this.sandboxes.get(platform ?? 'any');

    if (cached) return cached;

    const info = await this.commands
      .json<{
        Runtimes?: Record<string, { path?: string; runtimeArgs?: string[] }>;
      }>('docker', ['info', '--format', '{{json .}}'], { timeoutMs: 15_000 })
      .catch(() => null);
    const runtime = sandboxRuntimeOf(info?.Runtimes ?? {}, platform);

    if (!runtime)
      throw new Error(
        platform === 'kvm'
          ? `no gVisor KVM runtime (${SANDBOX_KVM_RUNTIME}) registered with Docker: restore needs the same platform`
          : `no gVisor runtime (${SANDBOX_RUNTIME}) registered with Docker`,
      );

    this.sandboxes.set(platform ?? 'any', runtime);

    return runtime;
  }

  /**
   * Reads the gVisor binaries (`runsc`, the `gvisor-bin/` sidecars next to it) once, so a restore during the freeze
   * doesn't wait for them to come from disk. Best effort.
   */
  async prewarm(platform?: GvisorPlatform): Promise<void> {
    const runtime = await this.sandboxRuntime(platform).catch(() => null);

    if (!runtime) return;

    const binary = await realpath(runtime.binary).catch(() => null);

    if (!binary) return;

    const sidecars = join(dirname(binary), 'gvisor-bin');
    const files = [binary, ...(await readdir(sidecars).catch(() => [] as string[])).map((f) => join(sidecars, f))];

    for (const file of files)
      await new Promise<void>((resolve) => {
        const stream = createReadStream(file);

        stream.on('data', () => undefined);
        stream.on('close', resolve);
        stream.on('error', () => resolve());
      });
  }

  /** `runsc` with the agent's root for restored sandboxes and Docker's runtime flags (of `platform`, if given). */
  private async runsc(args: string[], platform?: GvisorPlatform): Promise<[string, string[]]> {
    const runtime = await this.sandboxRuntime(platform);

    return [runtime.binary, ['--root', restoredRunscRoot(), ...runtime.args, ...args]];
  }

  /** Whether restored gVisor sandboxes may exist (their root exists): no runsc calls on hosts without any. */
  private async hasRunscRoot(): Promise<boolean> {
    return !!(await stat(restoredRunscRoot()).catch(() => null));
  }

  /** Creates (not starts) the placeholder container of a replica restored from `migration`. */
  async createHolder(options: Docker.ContainerCreateOptions, migration: string): Promise<string> {
    const binary = await ensureHolder(holderPath(stateDir()));
    const existing = await this.docker
      .getContainer(String(options.name))
      .inspect()
      .catch(() => null);

    if (existing) {
      if (existing.Config.Labels?.[RESTORED_LABEL] === migration && !existing.State.Running) return existing.Id;

      throw new Error(`container ${String(options.name)} already exists`);
    }

    // gVisor replicas without their own health check use the image's (the agent runs it, see holderOptions).
    const imageHealthcheck =
      options.HostConfig?.Runtime?.startsWith('runsc') && !options.Healthcheck && options.Image
        ? await this.docker
            .getImage(options.Image)
            .inspect()
            .then((i) => (i.Config as { Healthcheck?: Docker.HealthConfig }).Healthcheck)
            .catch(() => undefined)
        : undefined;
    const container = await this.docker.createContainer(holderOptions(options, migration, binary, imageHealthcheck));

    return container.id;
  }

  /**
   * Starts the placeholder and restores the checkpoint into it. `imageDir` is the final dump (with its pre-dump
   * parents next to it), `workDir` gets CRIU's / runsc's restore log. gVisor checkpoints need the checkpointed
   * container's OCI `process` (runsc validates the restore spec against the checkpointed one).
   */
  async restore(
    holderId: string,
    imageDir: string,
    workDir: string,
    sandbox?: { process: unknown },
  ): Promise<{ pid: number; ms: number }> {
    const start = Date.now();
    const holder = this.docker.getContainer(holderId);
    // Until the restored process owns them, nothing may reach the replica's addresses: the placeholder's kernel
    // would answer for them and reset the connections that are about to be restored.
    const table = await this.lockAddresses(holderId);
    let info: Docker.ContainerInspectInfo;

    try {
      await holder.start().catch(async (error: unknown) => {
        if (!(await holder.inspect()).State.Running) throw error;
      });

      info = await holder.inspect();

      const holderPid = info.State.Pid;
      const bundle = join(stateDir(), 'restored', info.Id.slice(0, 32));
      const holderConfig = JSON.parse(
        await readFile(`/run/containerd/io.containerd.runtime.v2.task/moby/${info.Id}/config.json`, 'utf8'),
      ) as OciConfig;
      const cgroup = hostCgroup(holderConfig.linux?.cgroupsPath ?? '');

      await this.splitCgroup(cgroup, holderPid);
      await mkdir(bundle, { recursive: true, mode: 0o700 });

      const config = restoredConfig(holderConfig, holderPid, cgroup);

      await writeFile(
        join(bundle, 'config.json'),
        JSON.stringify(sandbox ? { ...config, process: sandbox.process } : config),
        { mode: 0o600 },
      );
      await mkdir(workDir, { recursive: true, mode: 0o700 });

      const name = RestoredRuntime.runcName(info.Id);

      if (sandbox) {
        await mkdir(restoredRunscRoot(), { recursive: true, mode: 0o700 });

        const log = join(workDir, 'runsc.log');
        const [binary, args] = await this.runsc(
          [
            '--log',
            log,
            // gVisor sets "live TCP migration" only on sandboxes it starts (not on restored ones): without this, the
            // next checkpoint of this sandbox (another move, a resume) would reset its established connections.
            '--allow-connected-on-save',
            'restore',
            '-detach',
            '--image-path',
            imageDir,
            '--bundle',
            bundle,
            name,
            // Same platform as the checkpoint (M7.1): the placeholder's label comes from the replica's level.
          ],
          restoredPlatform(info.Config.Labels),
        );

        await this.runRestore(info.Id, binary, args, log);
      } else {
        await mkdir(restoredRuncRoot(), { recursive: true, mode: 0o700 });
        await this.runRestore(
          info.Id,
          'runc',
          this.runc([
            'restore',
            '-d',
            ...CRIU_OPTIONS,
            '--image-path',
            imageDir,
            '--work-path',
            workDir,
            '--bundle',
            bundle,
            name,
          ]),
          join(workDir, 'restore.log'),
        );
      }
    } finally {
      await this.unlockAddresses(table);
    }

    const pid = await this.pid(RestoredRuntime.runcName(info.Id));

    if (!pid) throw new Error('restored process is not running');

    const ms = Date.now() - start;

    this.logger.log(`Restored ${String(info.Name).replace(/^\//, '')} from ${imageDir} in ${ms} ms (pid ${pid})`);

    return { pid, ms };
  }

  /** Host-side drop of everything addressed to the placeholder's (not yet started) addresses. */
  private async lockAddresses(holderId: string): Promise<string | null> {
    const info = await this.docker.getContainer(holderId).inspect();
    const addresses = Object.values(info.NetworkSettings?.Networks ?? {}).flatMap((n) => [
      ...(n.IPAMConfig?.IPv4Address ? [n.IPAMConfig.IPv4Address] : []),
      ...(n.IPAMConfig?.IPv6Address ? [n.IPAMConfig.IPv6Address] : []),
      ...(n.IPAddress ? [n.IPAddress] : []),
      ...(n.GlobalIPv6Address ? [n.GlobalIPv6Address] : []),
    ]);
    const table = `lw_restore_${info.Id.slice(0, 12)}`;
    const rules = restoreLockRules(table, addresses);

    if (!rules) return null;

    await this.commands.run('nft', ['-f', '-'], { input: rules });

    return table;
  }

  private async unlockAddresses(table: string | null): Promise<void> {
    if (!table) return;

    await this.commands
      .run('nft', ['delete', 'table', 'inet', table])
      .catch((error: unknown) =>
        this.logger.warn(`Removing ${table}: ${error instanceof Error ? error.message : String(error)}`),
      );
  }

  /**
   * cgroup v2 allows processes only in leaves: the placeholder moves into `<cgroup>/holder`, the restored tasks get
   * `<cgroup>/app`; the container's cgroup keeps Docker's limits and accounts both.
   */
  private async splitCgroup(cgroup: string, holderPid: number): Promise<void> {
    const dir = join('/sys/fs/cgroup', cgroup);

    if (!(await stat(join(dir, 'cgroup.procs')).catch(() => null)))
      throw new Error(`cgroup v2 ${dir} not found (cgroup v1 hosts can't run restored replicas)`);

    await mkdir(join(dir, 'holder'), { recursive: true });
    await writeFile(join(dir, 'holder', 'cgroup.procs'), String(holderPid));

    const controllers = (await readFile(join(dir, 'cgroup.controllers'), 'utf8')).trim().split(/\s+/).filter(Boolean);

    for (const controller of controllers)
      await writeFile(join(dir, 'cgroup.subtree_control'), `+${controller}`).catch(() => undefined);
  }

  /**
   * runc restore with the container's own stdout / stderr FIFOs as the restored process' output (its log). The
   * process gets anonymous pipes, relayed into the FIFOs by two `cat`s that live as long as it writes: like Docker's
   * own containers, so a restored replica can be checkpointed again (CRIU can't dump descriptors of host paths outside
   * the container, runc hands pipes over as external). The paths are positional parameters, never interpolated.
   * runsc hands the pipes to the sandbox as the container's stdio the same way.
   */
  private async runRestore(containerId: string, binary: string, args: string[], log: string): Promise<void> {
    const fifo = async (stream: 'stdout' | 'stderr') => {
      for (const path of [
        `/run/docker/containerd/${containerId}/${containerId}-${stream}`,
        `/run/docker/containerd/${containerId}/init-${stream}`,
      ])
        if ((await stat(path).catch(() => null))?.isFIFO()) return path;

      return '/dev/null';
    };
    const out = await fifo('stdout');
    const err = await fifo('stderr');

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'bash',
          [
            '-c',
            'out="$1"; err="$2"; shift 2; exec "$@" </dev/null > >(exec cat > "$out" 2>/dev/null) 2> >(exec cat > "$err" 2>/dev/null)',
            'bash',
            out,
            err,
            binary,
            ...args,
          ],
          {
            stdio: 'ignore',
            env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' },
          },
        );
        const timer = setTimeout(() => child.kill('SIGKILL'), RESTORE_TIMEOUT_MS);

        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timer);

          if (code === 0) resolve();
          else reject(new Error(`${binary.split('/').pop()} restore failed (exit ${code ?? 'signal'})`));
        });
      });
    } catch (error) {
      const text = await readFile(log, 'utf8').catch(() => '');
      const lines = text
        .split('\n')
        .filter((l) => /error/i.test(l))
        .slice(-3)
        .join('; ');

      throw new Error(`${error instanceof Error ? error.message : String(error)}${lines ? `: ${lines}` : ''}`);
    }
  }

  /** The runtime command (runc / runsc with the agent's roots) for a restored process tree's runtime. */
  private async command(kind: RestoredKind, args: string[]): Promise<[string, string[]]> {
    return kind === 'runsc' ? await this.runsc(args) : ['runc', this.runc(args)];
  }

  /** PID of a restored process tree's init (gVisor: the sandbox), or null when it isn't running. */
  async pid(name: string, kind?: RestoredKind): Promise<number | null> {
    for (const k of kind ? [kind] : (['runc', 'runsc'] as const)) {
      if (k === 'runsc' && !(await this.hasRunscRoot())) continue;

      try {
        const state = await this.commands.json<{ status?: string; pid?: number }>(
          ...(await this.command(k, ['state', name])),
        );

        if (state.status === 'running' && state.pid) return state.pid;
      } catch {
        // not in this runtime's root
      }
    }

    return null;
  }

  /** Every restored process tree this node runs, runc and runsc (name → running). */
  async list(): Promise<Map<string, boolean>> {
    const listed: { id: string; status: string }[] = [];

    for (const kind of ['runc', 'runsc'] as const) {
      if (kind === 'runsc' && !(await this.hasRunscRoot())) continue;

      listed.push(
        ...((await this.command(kind, ['list', '--format', 'json'])
          .then((cmd) => this.commands.json<{ id: string; status: string }[] | null>(...cmd))
          .catch(() => null)) ?? []),
      );
    }

    return new Map(listed.map((c) => [c.id, c.status === 'running']));
  }

  /** Kills and removes a restored process tree in either runtime (idempotent). */
  async remove(name: string): Promise<void> {
    for (const kind of ['runc', 'runsc'] as const) {
      if (kind === 'runsc' && !(await this.hasRunscRoot())) continue;

      const run = async (args: string[]) =>
        await this.command(kind, args)
          .then((cmd) => this.commands.run(...cmd))
          .catch(() => undefined);

      await run(['kill', name, 'KILL']);

      for (let i = 0; i < 20 && (await this.pid(name, kind)); i++) await new Promise((r) => setTimeout(r, 100));

      await run(['delete', '--force', name]);
    }
  }

  /**
   * Stops a restored replica like `docker stop` would (its stop signal, then SIGKILL after the grace period) and
   * removes it with its placeholder.
   */
  async stopReplica(holderId: string, signal: string, graceMs: number): Promise<void> {
    const name = RestoredRuntime.runcName(holderId);

    for (const kind of ['runc', 'runsc'] as const) {
      if (!(await this.pid(name, kind))) continue;

      await this.command(kind, ['kill', name, signal.replace(/^SIG/, '')])
        .then((cmd) => this.commands.run(...cmd))
        .catch(() => undefined);

      const deadline = Date.now() + graceMs;

      while (Date.now() < deadline && (await this.pid(name, kind))) await new Promise((r) => setTimeout(r, 200));
    }

    await this.removeReplica(holderId);
  }

  /** Removes a placeholder and its restored process tree (the replica's volumes are unmounted by Docker). */
  async removeReplica(holderId: string): Promise<void> {
    const health = this.health.get(holderId);

    if (health) clearInterval(health.timer);

    this.health.delete(holderId);
    await this.remove(RestoredRuntime.runcName(holderId));
    await this.docker
      .getContainer(holderId)
      .remove({ force: true })
      .catch(() => undefined);
    await rm(join(stateDir(), 'restored', holderId.slice(0, 32)), { recursive: true, force: true });
  }

  /**
   * Health of a restored gVisor replica (the agent probes it through `runsc exec`, with Docker's semantics:
   * `starting` until the first success or the end of the start period, `unhealthy` after `retries` failures in a
   * row). Undefined for runc replicas (Docker's own health check applies) and replicas without a health check.
   */
  healthOf(holderId: string, labels: Record<string, string> | undefined): HealthStatus | undefined {
    if (restoredKind(labels) !== 'runsc' || !labels?.[RESTORED_HEALTH_LABEL]) return undefined;

    const existing = this.health.get(holderId);

    if (existing) return existing.status;

    let check: RestoredHealthCheck;

    try {
      check = JSON.parse(labels[RESTORED_HEALTH_LABEL]) as RestoredHealthCheck;
    } catch {
      return undefined;
    }

    const state: HealthState = {
      check,
      startedAt: Date.now(),
      failures: 0,
      status: 'starting',
      running: false,
      timer: setInterval(() => void this.probe(holderId), Math.max(1_000, check.intervalMs)),
    };

    state.timer.unref?.();
    this.health.set(holderId, state);

    return state.status;
  }

  private async probe(holderId: string): Promise<void> {
    const state = this.health.get(holderId);

    if (!state || state.running) return;

    state.running = true;

    try {
      const ok = await this.command('runsc', [
        'exec',
        RestoredRuntime.runcName(holderId),
        ...healthCommand(state.check.test),
      ])
        .then((cmd) => this.commands.run(cmd[0], cmd[1], { timeoutMs: Math.max(1_000, state.check.timeoutMs) }))
        .then(
          () => true,
          () => false,
        );

      Object.assign(state, nextHealth(state, state.check, ok, Date.now()));
    } finally {
      state.running = false;
    }
  }
}

/** Where machine exec writes the process specs of restored replicas (0600 files in a 0700 directory). */
export function restoredExecDir(): string {
  return join(stateDir(), 'restored-exec');
}

/**
 * The process of a machine exec in a restored replica, for `runc exec --process` / `runsc exec --process` (M6 review
 * L2): the replica's own process spec (capabilities, AppArmor profile, rlimits, ...) with the command, its
 * environment on top of the replica's, the working directory and a numeric `uid[:gid]` user — so neither the
 * environment (secrets) nor the arguments appear on a command line (`/proc/<pid>/cmdline`, the helper's `Cmd`).
 */
export function restoredExecProcess(
  base: unknown,
  command: readonly string[],
  options: { user?: string; workingDir?: string; env?: readonly string[] } = {},
): Record<string, unknown> {
  const process = { ...((base as Record<string, unknown> | undefined) ?? {}) } as Record<string, unknown> & {
    env?: string[];
    cwd?: string;
    user?: { uid?: number; gid?: number; [key: string]: unknown };
  };
  const extra = options.env ?? [];
  const overridden = new Set(extra.map((e) => e.slice(0, e.indexOf('='))));
  let user = process.user ?? { uid: 0, gid: 0 };

  if (options.user) {
    const numeric = /^(\d{1,10})(?::(\d{1,10}))?$/.exec(options.user);

    if (!numeric) throw new Error('restored replicas take a numeric user (uid[:gid])');

    user = { ...user, uid: Number(numeric[1]), ...(numeric[2] !== undefined ? { gid: Number(numeric[2]) } : {}) };
  }

  return {
    ...process,
    terminal: false,
    args: [...command],
    env: [...(process.env ?? []).filter((e) => !overridden.has(e.slice(0, e.indexOf('=')))), ...extra],
    cwd: options.workingDir ?? process.cwd ?? '/',
    user,
  };
}

/** Writes the process spec of a machine exec (see `restoredExecProcess`); the caller removes the file afterwards. */
export async function writeRestoredExecProcess(
  holderId: string,
  command: readonly string[],
  options: { user?: string; workingDir?: string; env?: readonly string[] } = {},
): Promise<string> {
  const config = JSON.parse(
    await readFile(join(stateDir(), 'restored', holderId.slice(0, 32), 'config.json'), 'utf8'),
  ) as OciConfig;
  const dir = restoredExecDir();
  const file = join(dir, `${randomUUID()}.json`);

  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(restoredExecProcess(config.process, command, options)), {
    mode: 0o600,
    flag: 'wx',
  });

  return file;
}

/**
 * `runc exec` of a command in a restored replica's namespaces, with the container's own capabilities, seccomp and
 * AppArmor profile (run in the host's namespaces, e.g. through the live-session helper's `nsenter`); gVisor
 * replicas: `runsc exec` in the sandbox. Machine exec passes a `processFile` (see `writeRestoredExecProcess`)
 * instead of the command: user, working directory and environment travel in that file, never as arguments.
 */
export function restoredExecCommand(
  holderId: string,
  command: string[],
  tty: boolean,
  kind: RestoredKind = 'runc',
  runsc = 'runsc',
  options: { processFile?: string } = {},
): string[] {
  const process = options.processFile ? ['--process', options.processFile] : [];
  const args = options.processFile ? [] : command;

  // runsc exec allocates a terminal when its stdio is one (no flag).
  return kind === 'runsc'
    ? [
        runsc,
        '--root',
        restoredRunscRoot(),
        'exec',
        ...(tty ? ['--env', 'TERM=xterm-256color'] : []),
        ...process,
        RestoredRuntime.runcName(holderId),
        ...args,
      ]
    : [
        'runc',
        '--root',
        restoredRuncRoot(),
        'exec',
        ...(tty ? ['-t', '--env', 'TERM=xterm-256color'] : []),
        ...process,
        RestoredRuntime.runcName(holderId),
        ...args,
      ];
}
