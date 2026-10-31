import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  agentMessage,
  importChannel,
  type Envelope,
  type ImportAction,
  type ImportProgress,
  type ImportStepCommand,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { AgentStateStore } from '../state/agent-state.store';
import { VolumeManager } from '../volumes/volume.manager';
import { FORMER_PREFIX } from './discovery.service';

const COMPONENTS_TIMEOUT_MS = 30 * 60_000;
const COPY_TIMEOUT_MS = 12 * 3_600_000;
const STOP_GRACE_SECONDS = 30;

/** `Total transferred file size: 1,234 bytes` of `rsync --stats`. */
export function rsyncBytes(output: string): number {
  const match = /Total transferred file size: ([\d,.]+) bytes/.exec(output);

  return match ? Number(match[1].replace(/[,.]/g, '')) : 0;
}

/**
 * rsync arguments of a copy into a replicated volume (3.21): archive with hard links, ACLs and xattrs, numeric
 * owners (the container's uids, not the host's names), and on the final pass deletes, so the volume equals the
 * source exactly. `--` ends the options; both paths end with `/` (contents, not the directory itself).
 */
export function rsyncArgs(source: string, target: string, final: boolean): string[] {
  return [
    '-aHAX',
    '--numeric-ids',
    '--stats',
    ...(final ? ['--delete'] : []),
    '--',
    `${source.replace(/\/+$/, '')}/`,
    `${target.replace(/\/+$/, '')}/`,
  ];
}

/**
 * Executes the agent's steps of an approved join plan (3.21, feature `node-import`): component installation (the
 * control plane's idempotent script, run outside the agent's sandbox with `systemd-run`), rsync pre-copy into the
 * mounted replicated volume while the source runs, the stop of the source containers (restart policy off, so a
 * Docker restart doesn't bring them back), the final pass with deletes, the restart of the source on a rollback, the
 * port handover check and the wipe of a former, different cluster's archived identity. Idempotent per step: a
 * re-sent finished step is answered with its result, a running one is not started twice.
 */
@Injectable()
export class ImportExecutor {
  private readonly logger = new Logger(ImportExecutor.name);
  private send: ((envelope: Envelope) => void) | null = null;
  private readonly results = new Map<string, ImportProgress>();
  private readonly running = new Set<string>();

  constructor(
    private readonly commands: CommandRunner,
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly volumes: VolumeManager,
    private readonly state: AgentStateStore,
  ) {}

  attach(send: (envelope: Envelope) => void): void {
    this.send = send;
  }

  private report(progress: ImportProgress): void {
    this.send?.(agentMessage('importProgress', progress, { channel: importChannel(progress.import) }));
  }

  async handle(command: ImportStepCommand): Promise<ImportProgress | null> {
    const key = `${command.import}|${command.step}`;
    const done = this.results.get(key);

    if (done) {
      this.report(done);

      return done;
    }

    if (this.running.has(key)) return null;

    this.running.add(key);
    this.report({ import: command.import, step: command.step, status: 'running' });

    let result: ImportProgress;

    try {
      result = { import: command.import, step: command.step, status: 'done', ...(await this.run(command)) };
    } catch (error) {
      result = {
        import: command.import,
        step: command.step,
        status: 'failed',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 4096),
      };
      this.logger.warn(`Import step ${command.step} failed: ${result.message}`);
    } finally {
      this.running.delete(key);
    }

    this.results.set(key, result);
    this.report(result);

    return result;
  }

  private async run(command: ImportStepCommand): Promise<Partial<ImportProgress>> {
    const action: ImportAction = command.action;

    switch (action.kind) {
      case 'components':
        return await this.components(command.import, action.script);
      case 'precopy':
        return await this.copy(action.copies, false);
      case 'final-sync':
        return await this.copy(action.copies, true);
      case 'stop':
        return await this.stop(action.containers);
      case 'restart-source':
        return await this.restart(action.containers, action.restartPolicies ?? {});
      case 'handover':
        return await this.handover(action.containers, action.ports);
      case 'wipe-identity':
        return await this.wipe(action.clusterId);
    }
  }

  private async components(id: string, script: string): Promise<Partial<ImportProgress>> {
    const dir = join(this.state.dir, 'import');
    const file = join(dir, `${id}-components.sh`);

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(file, script, { mode: 0o700 });

    try {
      // Outside the agent's sandbox (ProtectSystem): apt writes /usr and /etc.
      const result = await this.commands.run(
        'systemd-run',
        [`--unit=loadweaver-import-${id.slice(0, 8)}`, '--wait', '--collect', '--quiet', '--pipe', '/bin/bash', file],
        { timeoutMs: COMPONENTS_TIMEOUT_MS },
      );

      return { message: (result.stdout.trim().split('\n').pop() ?? 'components installed').slice(0, 4096) };
    } finally {
      await rm(file, { force: true });
    }
  }

  private async copy(copies: { source: string; volume: string }[], final: boolean): Promise<Partial<ImportProgress>> {
    let bytes = 0;

    for (const copy of copies) {
      const info = await stat(copy.source);

      if (!info.isDirectory()) throw new Error(`${copy.source} is not a directory`);

      const target = await this.volumes.mount(copy.volume);
      const result = await this.commands.run('rsync', rsyncArgs(copy.source, target, final), {
        timeoutMs: COPY_TIMEOUT_MS,
        // 24: files vanished during the pre-copy (the source still writes); the final pass copies them.
        okExitCodes: final ? [] : [24],
      });

      bytes += rsyncBytes(result.stdout);

      // After the final pass the workload mounts the volume itself (volume plugin).
      if (final) await this.volumes.unmount(copy.volume);
    }

    return { bytes, message: `${final ? 'final pass' : 'pre-copy'} of ${copies.length} volume(s): ${bytes} bytes` };
  }

  private async stop(ids: string[]): Promise<Partial<ImportProgress>> {
    const restartPolicies: Record<string, string> = {};

    for (const id of ids) {
      const container = this.docker.getContainer(id);
      const info = await container.inspect();

      restartPolicies[id] = info.HostConfig?.RestartPolicy?.Name || 'no';
      await container.update({ RestartPolicy: { Name: 'no', MaximumRetryCount: 0 } });

      if (info.State?.Running) await container.stop({ t: STOP_GRACE_SECONDS });
    }

    return { restartPolicies, message: `stopped ${ids.length} container(s)` };
  }

  private async restart(ids: string[], policies: Record<string, string>): Promise<Partial<ImportProgress>> {
    for (const id of [...ids].reverse()) {
      const container = this.docker.getContainer(id);
      const policy = policies[id];

      if (policy && policy !== 'no') await container.update({ RestartPolicy: { Name: policy } });

      const info = await container.inspect();

      if (!info.State?.Running) await container.start();
    }

    return { message: `restarted ${ids.length} container(s)` };
  }

  private async handover(
    ids: string[],
    ports: { protocol: 'tcp' | 'udp'; port: number }[],
  ): Promise<Partial<ImportProgress>> {
    for (const id of ids) {
      const info = await this.docker.getContainer(id).inspect();

      if (info.State?.Running) throw new Error(`source container ${info.Name.replace(/^\//, '')} runs again`);
    }

    // The source's port proxies are gone; whatever holds the ports now is the ingress (or nothing yet).
    const listeners = (await this.commands.run('ss', ['-H', '-l', '-t', '-u', '-n', '-p'])).stdout;
    const stale = ports.filter((p) =>
      listeners
        .split('\n')
        .some((l) => l.startsWith(p.protocol) && l.includes(`:${p.port} `) && l.includes('"docker-proxy"')),
    );

    if (stale.length)
      throw new Error(`docker-proxy still holds ${stale.map((p) => `${p.port}/${p.protocol}`).join(', ')}`);

    return { message: `handed over ${ports.length} port(s)` };
  }

  private async wipe(clusterId: string): Promise<Partial<ImportProgress>> {
    const identity = await this.state.identity();

    if (!clusterId || clusterId === identity?.clusterId)
      throw new Error('refusing to wipe the identity of the cluster this node belongs to');

    const archive = join(this.state.dir, `${FORMER_PREFIX}${clusterId}`);
    const entries = await readdir(this.state.dir).catch(() => [] as string[]);

    if (!entries.includes(`${FORMER_PREFIX}${clusterId}`))
      throw new Error(`no archived identity of cluster ${clusterId} (join --discover archives it)`);

    await rm(archive, { recursive: true, force: true });

    return { message: `identity and keys of cluster ${clusterId} discarded` };
  }
}
