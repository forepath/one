import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from './docker.provider';

export const COMPONENT_LABEL = 'loadweaver.com/component';
export const SPEC_HASH_LABEL = 'loadweaver.com/spec-hash';
export const MANAGED_LABEL = 'loadweaver.com/managed';

/** A platform container the agent runs next to the workloads (control plane, object store, registry). */
export interface ManagedContainerSpec {
  name: string;
  image: string;
  cmd?: string[];
  env: Record<string, string>;
  binds: string[];
  memoryBytes: number;
  /** Hash over everything that requires a re-create when it changes. */
  hash: string;
  component: string;
  /** For components facing untrusted traffic (e.g. the ingress): fewer privileges. */
  hardening?: {
    capAdd?: string[];
    capDrop?: string[];
    readOnlyRootfs?: boolean;
    noNewPrivileges?: boolean;
    tmpfs?: string[];
  };
}

/**
 * Runs platform containers by spec hash: unchanged specs keep running, changed ones are re-created. Host
 * networking; components bind to the overlay or loopback themselves. Never touches containers it didn't create.
 */
@Injectable()
export class ManagedContainers {
  private readonly logger = new Logger(ManagedContainers.name);

  constructor(@Inject(DOCKER) private readonly docker: Docker) {}

  /** Returns true if the container was (re-)created or started. */
  async ensure(spec: ManagedContainerSpec): Promise<boolean> {
    const container = this.docker.getContainer(spec.name);
    let info: Docker.ContainerInspectInfo | null = null;

    try {
      info = await container.inspect();
    } catch {
      info = null;
    }

    if (info && info.Config.Labels?.[SPEC_HASH_LABEL] === spec.hash) {
      if (!info.State.Running) await container.start();

      return !info.State.Running;
    }

    if (info) await this.remove(spec.name);

    await this.pull(spec.image);

    const created = await this.docker.createContainer({
      name: spec.name,
      Image: spec.image,
      ...(spec.cmd ? { Cmd: spec.cmd } : {}),
      Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
      Labels: { [MANAGED_LABEL]: 'true', [COMPONENT_LABEL]: spec.component, [SPEC_HASH_LABEL]: spec.hash },
      HostConfig: {
        NetworkMode: 'host',
        Binds: spec.binds,
        RestartPolicy: { Name: 'unless-stopped' },
        Memory: spec.memoryBytes,
        ...(spec.hardening?.capAdd ? { CapAdd: spec.hardening.capAdd } : {}),
        ...(spec.hardening?.capDrop ? { CapDrop: spec.hardening.capDrop } : {}),
        ...(spec.hardening?.readOnlyRootfs ? { ReadonlyRootfs: true } : {}),
        ...(spec.hardening?.noNewPrivileges ? { SecurityOpt: ['no-new-privileges:true'] } : {}),
        ...(spec.hardening?.tmpfs
          ? { Tmpfs: Object.fromEntries(spec.hardening.tmpfs.map((path) => [path, 'rw,noexec,nosuid,size=64m'])) }
          : {}),
        LogConfig: { Type: 'json-file', Config: { 'max-size': '20m', 'max-file': '3' } },
      },
    });

    await created.start();
    this.logger.log(`Started ${spec.name} (${spec.hash})`);

    return true;
  }

  async pull(image: string): Promise<void> {
    const images = await this.docker.listImages({ filters: { reference: [image.split('@')[0]] } });

    if (images.some((i) => (i.RepoDigests ?? []).some((d) => image.endsWith(d.split('@')[1] ?? '__none__')))) return;

    const stream = await this.docker.pull(image);

    await new Promise<void>((resolve, reject) =>
      this.docker.modem.followProgress(stream, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  }

  /** Removes a container Loadweaver created; returns true if one was removed. */
  async remove(name: string): Promise<boolean> {
    const container = this.docker.getContainer(name);

    try {
      const info = await container.inspect();

      // Never touch containers Loadweaver didn't create (3.21).
      if (info.Config.Labels?.[MANAGED_LABEL] !== 'true') return false;

      await container.remove({ force: true });

      return true;
    } catch {
      return false;
    }
  }

  /** Sends a signal (e.g. `SIGHUP` to reload) to a running managed container; false if it isn't running. */
  async signal(name: string, signal: string): Promise<boolean> {
    try {
      await this.docker.getContainer(name).kill({ signal });

      return true;
    } catch {
      return false;
    }
  }

  /** Runs a short command in a throwaway, network-less container (config checks); returns exit code and output. */
  async runOnce(
    image: string,
    cmd: string[],
    binds: string[],
    options: { user?: string; network?: 'none' | 'bridge'; memoryBytes?: number } = {},
  ): Promise<{ exitCode: number; output: string }> {
    await this.pull(image);

    const container = await this.docker.createContainer({
      Image: image,
      Entrypoint: [cmd[0]],
      Cmd: cmd.slice(1),
      ...(options.user ? { User: options.user } : {}),
      HostConfig: {
        Binds: binds,
        NetworkMode: options.network ?? 'none',
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ...(options.memoryBytes ? { Memory: options.memoryBytes } : {}),
      },
    });

    try {
      await container.start();

      const { StatusCode } = (await container.wait()) as { StatusCode: number };
      const logs = await container.logs({ stdout: true, stderr: true });

      return { exitCode: StatusCode, output: Buffer.isBuffer(logs) ? logs.toString('utf8') : String(logs) };
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  /** Names of managed containers of one component. */
  async list(component: string): Promise<string[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${MANAGED_LABEL}=true`, `${COMPONENT_LABEL}=${component}`] },
    });

    return containers.flatMap((c) => c.Names.map((n) => n.replace(/^\//, '')));
  }
}
