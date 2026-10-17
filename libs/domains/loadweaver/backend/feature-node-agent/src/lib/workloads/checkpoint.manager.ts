import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { stateDir } from '../state/agent-state.store';
import {
  RESTORED_LABEL,
  restoredKind,
  restoredRuncRoot,
  restoredRunscRoot,
  RestoredRuntime,
  sandboxRuntimeOf,
} from './restored-runtime';

/**
 * Checkpoints of running replicas for live migration (3.10), below Docker (`docker start --checkpoint` is broken on
 * every tested Docker, see the M6 spike notes): CRIU through runc on Docker's own runc state
 * (`/run/docker/runtime-runc/moby`), with iterative pre-dumps (`--pre-dump`, dirty-page tracking, each round on top of
 * the previous one via `--parent-path`) and a final dump; gVisor replicas through `runsc checkpoint`
 * (stop-and-copy). The writable layer travels as a tar of the overlay upperdir (whiteouts, xattrs, numeric owners).
 * tmpfs mounts are never pre-dumped (CRIU copies them in the final dump: they count as frozen size).
 */

/** CRIU options shared by every dump / restore (the spike's working set). */
export const CRIU_OPTIONS = ['--tcp-established', '--manage-cgroups-mode=soft'] as const;

const DUMP_TIMEOUT_MS = 10 * 60_000;

/**
 * CRIU's configuration file for runc (read in RPC mode). runc only marks a network namespace as external (to be
 * joined, not re-created, on restore) when the container's config names it by path — Docker's configs don't — so
 * the final dump adds `external net[<inode>]:extRootNetNS` here (the key runc uses on restore) for its duration.
 */
export function criuRuncConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_CRIU_RUNC_CONFIG'] || '/etc/criu/runc.conf';
}

/** The CRIU option marking a network namespace (by inode) external under runc's restore key. */
export function externalNetnsOption(inode: number | bigint): string {
  return `external net[${inode}]:extRootNetNS`;
}
const TAR_TIMEOUT_MS = 30 * 60_000;

export interface CheckpointSource {
  /** The Docker container (pause, restart policy, removal). */
  dockerId: string;
  /** The runtime's container id the checkpoint commands use (Docker's, or the agent's for a restored replica). */
  containerId: string;
  /** A restored replica (3.10): its process tree runs in the agent's runc root next to a placeholder. */
  restored: boolean;
  runtime: 'runc' | 'runsc';
  /** runc / runsc binary and its global arguments (`--root`, the runtime's own flags). */
  binary: string;
  globalArgs: string[];
  pid: number;
  /** Overlay upperdir of the root filesystem (containerd snapshotter: from the task's mountinfo). */
  upperdir: string | null;
  restartPolicy: string;
  /** The running container's OCI config (gVisor restores need its `process`). */
  ociConfig: string;
}

export interface DumpResult {
  bytes: number;
  ms: number;
}

interface DockerRuntimes {
  Runtimes?: Record<string, { path?: string; runtimeArgs?: string[] }>;
}

/** The overlay upperdir of a process' root mount (`/proc/<pid>/mountinfo`, mount point `/`). */
export function upperdirFromMountinfo(mountinfo: string): string | null {
  for (const line of mountinfo.split('\n')) {
    const fields = line.split(' ');

    if (fields[4] !== '/') continue;

    const separator = fields.indexOf('-');

    if (separator < 0 || fields[separator + 1] !== 'overlay') continue;

    const upper = /(?:^|,)upperdir=([^,]+)/.exec(fields[separator + 3] ?? '')?.[1];

    if (upper) return upper.replace(/\\040/g, ' ');
  }

  return null;
}

/** The upperdir in `ctr snapshots mounts` output (a created container's writable layer, before it runs). */
export function upperdirFromMountCommand(output: string): string | null {
  return /upperdir=([^,\s]+)/.exec(output)?.[1] ?? null;
}

/** The host-side peer ifindex of the container's `eth0` (`ip -j link` inside its network namespace). */
export function peerIndex(links: { ifname?: string; link_index?: number }[]): number | null {
  return links.find((l) => l.ifname === 'eth0')?.link_index ?? null;
}

/** The last `Error` lines of a CRIU log (runc only quotes its tail, which rarely holds the cause). */
export async function criuErrors(log: string): Promise<string> {
  const text = await readFile(log, 'utf8').catch(() => '');

  return text
    .split('\n')
    .filter((l) => /\bError\b/.test(l))
    .slice(-3)
    .map((l) => l.trim())
    .join('; ');
}

/** Runs a runc / runsc checkpoint command; failures carry CRIU's own error lines from `<dir>/dump.log`. */
async function withCriuErrors<T>(dir: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const errors = await criuErrors(join(dir, 'dump.log'));
    const message = error instanceof Error ? error.message.split(':')[0] : String(error);

    throw new Error(errors ? `${message}: ${errors}` : error instanceof Error ? error.message : String(error));
  }
}

@Injectable()
export class CheckpointManager {
  /** Final dumps are serialized: they share CRIU's runc configuration file. */
  private dumps: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly commands: CommandRunner,
    @Inject(DOCKER) private readonly docker: Docker,
  ) {}

  /** runc / runsc state of a running Docker container. */
  async locate(containerId: string): Promise<CheckpointSource> {
    const info = await this.docker.getContainer(containerId).inspect();
    const pid = info.State.Pid;

    if (!info.State.Running || !pid) throw new Error(`container ${containerId.slice(0, 12)} is not running`);

    // A replica restored here earlier (and not restarted since): its process tree is the agent's runc / runsc
    // container next to the placeholder.
    if (info.Config.Labels?.[RESTORED_LABEL]) {
      const name = RestoredRuntime.runcName(info.Id);
      const kind = restoredKind(info.Config.Labels);
      const sandbox = kind === 'runsc' ? await this.sandboxRuntime() : null;
      const binary = sandbox?.binary ?? 'runc';
      const globalArgs = sandbox ? ['--root', restoredRunscRoot(), ...sandbox.args] : ['--root', restoredRuncRoot()];
      const state = await this.commands.json<{ status?: string; pid?: number }>(binary, [...globalArgs, 'state', name]);

      if (state.status !== 'running' || !state.pid) throw new Error(`restored process of ${info.Name} is not running`);

      return {
        dockerId: info.Id,
        containerId: name,
        restored: true,
        runtime: kind,
        binary,
        globalArgs,
        pid: state.pid,
        // gVisor keeps root filesystem writes inside the sandbox (and its checkpoint).
        upperdir: sandbox
          ? null
          : upperdirFromMountinfo(await readFile(`/proc/${state.pid}/mountinfo`, 'utf8').catch(() => '')),
        restartPolicy: info.HostConfig.RestartPolicy?.Name || 'no',
        ociConfig: join(stateDir(), 'restored', info.Id.slice(0, 32), 'config.json'),
      };
    }

    const runtimeName = info.HostConfig.Runtime || 'runc';
    const runtime = runtimeName.startsWith('runsc') ? 'runsc' : 'runc';
    let binary = 'runc';
    let runtimeArgs: string[] = [];

    if (runtime === 'runsc') {
      const entry = (await this.dockerRuntimes())[runtimeName];

      binary = entry?.path || 'runsc';
      runtimeArgs = entry?.runtimeArgs ?? [];
    }

    const root = await this.runtimeRoot(runtimeName, info.Id);
    const mountinfo = await readFile(`/proc/${pid}/mountinfo`, 'utf8').catch(() => '');

    return {
      dockerId: info.Id,
      containerId: info.Id,
      restored: false,
      runtime,
      binary,
      globalArgs: ['--root', root, ...runtimeArgs],
      pid,
      upperdir: runtime === 'runsc' ? null : upperdirFromMountinfo(mountinfo),
      restartPolicy: info.HostConfig.RestartPolicy?.Name || 'no',
      ociConfig: `/run/containerd/io.containerd.runtime.v2.task/moby/${info.Id}/config.json`,
    };
  }

  private async dockerRuntimes(): Promise<NonNullable<DockerRuntimes['Runtimes']>> {
    const docker = await this.commands.json<DockerRuntimes>('docker', ['info', '--format', '{{json .}}'], {
      timeoutMs: 15_000,
    });

    return docker.Runtimes ?? {};
  }

  private async sandboxRuntime(): Promise<{ binary: string; args: string[] }> {
    const runtime = sandboxRuntimeOf(await this.dockerRuntimes());

    if (!runtime) throw new Error('no gVisor runtime registered with Docker');

    return runtime;
  }

  /** The OCI `process` of a running replica (a gVisor restore must present the checkpointed one). */
  async ociProcess(source: CheckpointSource): Promise<unknown> {
    const config = JSON.parse(await readFile(source.ociConfig, 'utf8')) as { process?: unknown };

    if (!config.process) throw new Error(`no OCI process in ${source.ociConfig}`);

    return config.process;
  }

  /**
   * Docker keeps runtime state under `<exec-root>/runtime-<name>/moby`; runc-compatible runtimes run through the runc
   * shim share `runtime-runc` (runc: a directory per container, runsc: `<id>_sandbox:<id>.state` files).
   */
  private async runtimeRoot(runtimeName: string, id: string): Promise<string> {
    const base = '/run/docker';
    const candidates = [
      join(base, `runtime-${runtimeName === 'io.containerd.runc.v2' ? 'runc' : runtimeName}`, 'moby'),
      join(base, 'runtime-runc', 'moby'),
      ...(await readdir(base).catch(() => [] as string[]))
        .filter((dir) => dir.startsWith('runtime-'))
        .map((dir) => join(base, dir, 'moby')),
    ];

    for (const root of candidates)
      if ((await readdir(root).catch(() => [] as string[])).some((entry) => entry.startsWith(id))) return root;

    return candidates[0];
  }

  /** One pre-copy round (runc only): memory pages written since `parent`, the task keeps running. */
  async preDump(source: CheckpointSource, dir: string, parent: string | null): Promise<DumpResult> {
    const start = Date.now();

    await withCriuErrors(dir, () =>
      this.commands.run(
        source.binary,
        [
          ...source.globalArgs,
          'checkpoint',
          '--pre-dump',
          ...CRIU_OPTIONS,
          '--image-path',
          dir,
          ...(parent ? ['--parent-path', parent] : []),
          source.containerId,
        ],
        { timeoutMs: DUMP_TIMEOUT_MS },
      ),
    );

    return { bytes: await this.dirBytes(dir), ms: Date.now() - start };
  }

  /**
   * The final dump. `leaveRunning` keeps the (paused) tasks alive for a resume on abort; without it CRIU kills them
   * after a successful dump (needed when a replicated volume must be demoted: the tasks hold it open).
   */
  async dump(
    source: CheckpointSource,
    dir: string,
    options: { parent: string | null; leaveRunning: boolean },
  ): Promise<DumpResult> {
    const run = this.dumps.then(() => this.dumpNow(source, dir, options));

    this.dumps = run.catch(() => undefined);

    return await run;
  }

  private async dumpNow(
    source: CheckpointSource,
    dir: string,
    options: { parent: string | null; leaveRunning: boolean },
  ): Promise<DumpResult> {
    const start = Date.now();
    const netns = await stat(`/proc/${source.pid}/ns/net`);
    const configPath = criuRuncConfigPath();
    const original = await readFile(configPath, 'utf8').catch(() => null);

    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${original ? `${original.trimEnd()}\n` : ''}${externalNetnsOption(netns.ino)}\n`);

    try {
      await this.runDump(source, dir, options);
    } finally {
      if (original === null) await rm(configPath, { force: true });
      else await writeFile(configPath, original);
    }

    return { bytes: await this.dirBytes(dir), ms: Date.now() - start };
  }

  private async runDump(
    source: CheckpointSource,
    dir: string,
    options: { parent: string | null; leaveRunning: boolean },
  ): Promise<void> {
    await withCriuErrors(dir, () =>
      this.commands.run(
        source.binary,
        [
          ...source.globalArgs,
          'checkpoint',
          ...CRIU_OPTIONS,
          ...(options.leaveRunning ? ['--leave-running'] : []),
          '--image-path',
          dir,
          ...(options.parent ? ['--parent-path', options.parent] : []),
          source.containerId,
        ],
        { timeoutMs: DUMP_TIMEOUT_MS },
      ),
    );
  }

  /**
   * gVisor: the sandbox writes its whole state (memory, root filesystem writes, its network stack incl. established
   * TCP connections) and exits (stop-and-copy). Not `--leave-running`: a sandbox saved for resuming marks its
   * connections to be dropped at a restore elsewhere; an aborted attempt restores the source from this image instead.
   */
  async runscCheckpoint(source: CheckpointSource, dir: string): Promise<DumpResult> {
    const start = Date.now();

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.commands.run(
      source.binary,
      [...source.globalArgs, 'checkpoint', '--image-path', dir, source.containerId],
      { timeoutMs: DUMP_TIMEOUT_MS },
    );

    return { bytes: await this.dirBytes(dir), ms: Date.now() - start };
  }

  async pause(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).pause();
  }

  async unpause(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).unpause();
  }

  /** Docker must not restart a replica whose tasks a checkpoint stopped (or whose volume moved away). */
  async setRestartPolicy(containerId: string, name: string): Promise<void> {
    await this.docker.getContainer(containerId).update({ RestartPolicy: { Name: name } });
  }

  /** The host side of the container's `eth0` (bridge port or kept-address veth). */
  async hostInterface(pid: number): Promise<string | null> {
    const inner = await this.commands
      .json<{ ifname?: string; link_index?: number }[]>('nsenter', ['-t', String(pid), '-n', 'ip', '-j', 'link'])
      .catch(() => []);
    const index = peerIndex(inner);

    if (index === null) return null;

    const host = await this.commands.json<{ ifindex?: number; ifname?: string }[]>('ip', ['-j', 'link']);

    return host.find((l) => l.ifindex === index)?.ifname ?? null;
  }

  /**
   * Cuts the frozen replica off the network: packets that still reach this node are dropped instead of being
   * acknowledged by its (frozen) kernel sockets, so established connections continue from the checkpoint on the
   * target. Returns the routes through the interface (link down removes them) for `connect`.
   */
  async disconnect(hostInterface: string): Promise<string[][]> {
    const routes: string[][] = [];

    for (const family of ['-4', '-6']) {
      const listed = await this.commands
        .json<{ dst?: string }[]>('ip', ['-j', family, 'route', 'show', 'dev', hostInterface])
        .catch(() => []);

      for (const route of listed)
        if (route.dst && route.dst !== 'default') routes.push([family, 'route', 'replace', route.dst]);
    }

    await this.commands.run('ip', ['link', 'set', hostInterface, 'down']);

    return routes;
  }

  async connect(hostInterface: string, routes: string[][]): Promise<void> {
    await this.commands.run('ip', ['link', 'set', hostInterface, 'up']);

    for (const route of routes) await this.commands.run('ip', [...route, 'dev', hostInterface]).catch(() => undefined);
  }

  /** The writable layer as a tar (whiteouts are 0/0 character devices, kept with xattrs and numeric owners). */
  async tarUpper(upperdir: string, file: string): Promise<void> {
    await this.commands.run(
      'tar',
      ['--xattrs', '--xattrs-include=*', '--numeric-owner', '-C', upperdir, '-cf', file, '.'],
      { timeoutMs: TAR_TIMEOUT_MS },
    );
  }

  async applyUpper(file: string, upperdir: string): Promise<void> {
    await this.commands.run(
      'tar',
      ['--xattrs', '--xattrs-include=*', '--numeric-owner', '--same-permissions', '-C', upperdir, '-xf', file],
      { timeoutMs: TAR_TIMEOUT_MS },
    );
  }

  /** Writable layer of a created (not yet started) container: its containerd snapshot (moby namespace). */
  async createdUpperdir(containerId: string): Promise<string> {
    const info = await this.docker.getContainer(containerId).inspect();
    const graph = (info.GraphDriver?.Data ?? {}) as Record<string, string>;

    if (graph['UpperDir']) return graph['UpperDir'];

    const { stdout } = await this.commands.run('ctr', ['-n', 'moby', 'snapshots', 'mounts', '/nonexistent', info.Id]);
    const upper = upperdirFromMountCommand(stdout);

    if (!upper) throw new Error(`no writable layer found for ${containerId.slice(0, 12)}`);

    return upper;
  }

  async dirBytes(dir: string): Promise<number> {
    let total = 0;

    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile()) total += (await stat(join(dir, entry.name))).size;
      else if (entry.isDirectory()) total += await this.dirBytes(join(dir, entry.name));
    }

    return total;
  }
}
