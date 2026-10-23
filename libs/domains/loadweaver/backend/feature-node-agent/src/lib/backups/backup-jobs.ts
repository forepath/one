import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';
import { COMPONENT_LABEL, MANAGED_LABEL, ManagedContainers } from '../host/managed-containers';

export const BACKUP_JOB_COMPONENT = 'backup-job';
/** Prefix of everything a backup / restore job creates on the host (LVs, mappings, mounts, containers, dirs). */
export const JOB_PREFIX = 'lw-bk-';
/** Output kept per stream of a job container (the tail). */
const MAX_OUTPUT = 1024 * 1024;

/** Host-wide name of a job's resources: `lw-bk-<first 16 hex digits of the id>`. */
export function jobName(id: string): string {
  return `${JOB_PREFIX}${id.replace(/-/g, '').slice(0, 16)}`;
}

export interface JobOutput {
  /** null: killed after its timeout. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr interleaved as written. */
  combined: string;
}

const tail = (value: string) => (value.length > MAX_OUTPUT ? value.slice(-MAX_OUTPUT) : value);

/** Splits Docker's multiplexed (non-TTY) log / exec stream into stdout and stderr (8-byte frame headers). */
export function demux(buffer: Buffer): Omit<JobOutput, 'exitCode'> {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const all: Buffer[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const type = buffer[offset];
    const length = buffer.readUInt32BE(offset + 4);
    const frame = buffer.subarray(offset + 8, offset + 8 + length);

    if (type !== 1 && type !== 2) {
      // Not multiplexed (TTY): the whole buffer is output.
      return { stdout: tail(buffer.toString('utf8')), stderr: '', combined: tail(buffer.toString('utf8')) };
    }

    (type === 1 ? out : err).push(frame);
    all.push(frame);
    offset += 8 + length;
  }

  return {
    stdout: tail(Buffer.concat(out).toString('utf8')),
    stderr: tail(Buffer.concat(err).toString('utf8')),
    combined: tail(Buffer.concat(all).toString('utf8')),
  };
}

export interface JobContainerSpec {
  name: string;
  image: string;
  /** Replaces the image's entrypoint. */
  entrypoint?: string[];
  cmd: string[];
  /** Secrets go here, never into `cmd`. */
  env?: Record<string, string>;
  binds: string[];
  /**
   * Host block devices passed through (`PathOnHost` = `PathInContainer`; VM disks, 3.35): `r` read-only, `rw` read /
   * write; never `m` (no device nodes created).
   */
  devices?: { path: string; permissions: 'r' | 'rw' }[];
  /** Container user (default: the image's). */
  user?: string;
  /** Root file system read-only. */
  readOnly?: boolean;
  network: 'host' | 'none';
  /** Everything else is dropped. */
  capAdd?: string[];
  memoryBytes?: number;
  timeoutMs: number;
  /** Cancels the job: the container is killed and removed, `run` rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Called with the job's stdout so far every `intervalMs` while it runs (progress output, e.g. `qemu-img -p`). */
  progress?: { intervalMs: number; stdout: (stdout: string) => void };
}

/** The reason of an aborted signal as an error. */
export function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;

  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'cancelled');
}

/**
 * One-shot containers of backup / restore jobs (Kopia client, check hooks) and `docker exec` for backup hooks.
 * Containers carry the managed label and the `backup-job` component, so leftovers of a crashed agent are found.
 */
@Injectable()
export class BackupJobs {
  private readonly logger = new Logger(BackupJobs.name);

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly containers: ManagedContainers,
  ) {}

  async run(spec: JobContainerSpec): Promise<JobOutput> {
    if (spec.signal?.aborted) throw abortError(spec.signal);

    const image = await this.containers.pull(spec.image);

    if (spec.signal?.aborted) throw abortError(spec.signal);

    await this.docker
      .getContainer(spec.name)
      .remove({ force: true })
      .catch(() => undefined);

    const container = await this.docker.createContainer({
      name: spec.name,
      Image: image,
      ...(spec.entrypoint ? { Entrypoint: spec.entrypoint } : {}),
      Cmd: spec.cmd,
      Env: Object.entries(spec.env ?? {}).map(([k, v]) => `${k}=${v}`),
      ...(spec.user ? { User: spec.user } : {}),
      Labels: { [MANAGED_LABEL]: 'true', [COMPONENT_LABEL]: BACKUP_JOB_COMPONENT },
      HostConfig: {
        Binds: spec.binds,
        ...(spec.devices?.length
          ? {
              Devices: spec.devices.map((d) => ({
                PathOnHost: d.path,
                PathInContainer: d.path,
                CgroupPermissions: d.permissions,
              })),
            }
          : {}),
        ...(spec.readOnly ? { ReadonlyRootfs: true } : {}),
        NetworkMode: spec.network,
        CapDrop: ['ALL'],
        ...(spec.capAdd?.length ? { CapAdd: spec.capAdd } : {}),
        SecurityOpt: ['no-new-privileges:true'],
        ...(spec.memoryBytes ? { Memory: spec.memoryBytes } : {}),
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '1' } },
      },
    });

    let poll: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    try {
      await container.start();

      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), spec.timeoutMs);
      });
      const aborted = new Promise<'aborted'>((resolve) => {
        if (!spec.signal) return;

        onAbort = () => resolve('aborted');

        if (spec.signal.aborted) onAbort();
        else spec.signal.addEventListener('abort', onAbort, { once: true });
      });
      const progress = spec.progress;

      if (progress)
        poll = setInterval(() => {
          void (container.logs({ stdout: true, stderr: false, follow: false }) as Promise<unknown>)
            .then((logs) => progress.stdout(demux(Buffer.isBuffer(logs) ? logs : Buffer.from(String(logs))).stdout))
            .catch(() => undefined);
        }, progress.intervalMs);

      const result = await Promise.race([
        (container.wait() as Promise<{ StatusCode: number }>).then((r) => r.StatusCode),
        timedOut,
        aborted,
      ]);

      clearTimeout(timer);

      if (result === 'aborted') {
        await container.kill().catch(() => undefined);
        throw abortError(spec.signal as AbortSignal);
      }

      if (result === null) await container.kill().catch(() => undefined);

      const logs = (await container.logs({ stdout: true, stderr: true, follow: false })) as unknown as Buffer;

      return { exitCode: result, ...demux(Buffer.isBuffer(logs) ? logs : Buffer.from(String(logs))) };
    } finally {
      if (poll) clearInterval(poll);

      if (onAbort) spec.signal?.removeEventListener('abort', onAbort);

      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  /** Pulls an image (release images fall back to the cluster registry's copy). */
  async pull(image: string): Promise<string> {
    return await this.containers.pull(image);
  }

  /** `docker exec` of a hook in a running container; non-TTY, output demultiplexed. */
  async exec(containerId: string, command: string[], timeoutMs: number): Promise<JobOutput> {
    const exec = await this.docker
      .getContainer(containerId)
      .exec({ Cmd: command, AttachStdout: true, AttachStderr: true, AttachStdin: false, Tty: false });
    const stream = (await exec.start({ hijack: true, stdin: false })) as unknown as NodeJS.ReadableStream & {
      destroy?: () => void;
    };
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      new Promise<boolean>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(true));
        stream.on('close', () => resolve(true));
        stream.on('error', reject);
      }),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);

    clearTimeout(timer);

    const output = demux(Buffer.concat(chunks));

    if (!finished) {
      stream.destroy?.();

      return { exitCode: null, ...output };
    }

    const info = await exec.inspect();

    return { exitCode: info.ExitCode ?? null, ...output };
  }

  /** Removes job containers of a previous agent process. */
  async removeLeftovers(): Promise<number> {
    const leftovers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${MANAGED_LABEL}=true`, `${COMPONENT_LABEL}=${BACKUP_JOB_COMPONENT}`] },
    });

    for (const c of leftovers) {
      await this.docker
        .getContainer(c.Id)
        .remove({ force: true })
        .catch((error: unknown) => this.logger.warn(`Removing ${c.Names[0]} failed: ${String(error)}`));
    }

    return leftovers.length;
  }

  /** Running containers that mount a Docker volume. */
  async usersOf(dockerName: string): Promise<Docker.ContainerInfo[]> {
    return await this.docker.listContainers({ filters: { volume: [dockerName], status: ['running'] } });
  }

  async stop(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).stop({ t: 30 });
  }

  async start(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).start();
  }
}
