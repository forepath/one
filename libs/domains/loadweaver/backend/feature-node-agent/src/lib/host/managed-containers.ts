import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { clusterImageFor } from '../updates/release-images';
import { DOCKER } from './docker.provider';

export const COMPONENT_LABEL = 'loadweaver.com/component';
export const SPEC_HASH_LABEL = 'loadweaver.com/spec-hash';
export const MANAGED_LABEL = 'loadweaver.com/managed';

/** A platform container the agent runs next to the workloads (control plane, object store, registry). */
export interface ManagedContainerSpec {
  name: string;
  image: string;
  /** Replaces the image's entrypoint (e.g. a shell for images whose entrypoint is the program itself). */
  entrypoint?: string[];
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
/**
 * What differs between a running managed container and its new spec — names only (environment keys, `image`, `cmd`,
 * `binds`, …), never values (secrets). Logged when the container is re-created, so a spec that flips between two
 * versions shows what flips.
 */
export function changedSpecFields(
  info: Pick<Docker.ContainerInspectInfo, 'Config' | 'HostConfig'>,
  spec: Pick<ManagedContainerSpec, 'env' | 'cmd' | 'binds' | 'memoryBytes'>,
): string[] {
  const running = new Map(
    (info.Config.Env ?? []).map((e) => {
      const at = e.indexOf('=');

      return [e.slice(0, at), e.slice(at + 1)] as const;
    }),
  );
  const changed = Object.entries(spec.env)
    .filter(([k, v]) => running.get(k) !== v)
    .map(([k]) => `env.${k}`);

  // Keys only the old container had (image defaults also appear here; only those the spec dropped matter).
  for (const key of running.keys())
    if (!(key in spec.env) && (info.Config.Labels?.['loadweaver.com/env-keys'] ?? '').split(',').includes(key))
      changed.push(`env.${key} (removed)`);

  if (spec.cmd && JSON.stringify(info.Config.Cmd ?? []) !== JSON.stringify(spec.cmd)) changed.push('cmd');

  if (JSON.stringify(info.HostConfig?.Binds ?? []) !== JSON.stringify(spec.binds)) changed.push('binds');

  if ((info.HostConfig?.Memory ?? 0) !== (spec.memoryBytes ?? 0)) changed.push('memory');

  return changed.sort();
}

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

    const changed = info ? changedSpecFields(info, spec) : [];
    // The image first: a pull that fails (registry outage, unreachable release copy) must leave the running container
    // in place instead of tearing down the control plane / etcd / Postgres with nothing to replace it.
    const image = await this.pull(spec.image);

    if (info) await this.remove(spec.name);

    const created = await this.docker.createContainer({
      name: spec.name,
      Image: image,
      ...(spec.entrypoint ? { Entrypoint: spec.entrypoint } : {}),
      ...(spec.cmd ? { Cmd: spec.cmd } : {}),
      Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
      Labels: {
        [MANAGED_LABEL]: 'true',
        [COMPONENT_LABEL]: spec.component,
        [SPEC_HASH_LABEL]: spec.hash,
        // The spec's environment keys (names only), for `changedSpecFields` on the next re-create.
        'loadweaver.com/env-keys': Object.keys(spec.env).sort().join(','),
      },
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
    this.logger.log(
      `Started ${spec.name} (${spec.hash})${info ? `; re-created, changed: ${changed.join(', ') || 'unknown'}` : ''}`,
    );

    return true;
  }

  /**
   * Pulls an image and returns the reference to create containers from. A release image the upstream registry can't
   * deliver (air-gapped clusters) comes from its copy in the cluster registry, by the same digest (3.26).
   */
  async pull(image: string): Promise<string> {
    if (await this.present(image)) return image;

    try {
      await this.fetch(image);

      return image;
    } catch (error) {
      const cluster = clusterImageFor(image);

      if (!cluster) throw error;

      if (!(await this.present(cluster))) {
        this.logger.warn(`${image} not reachable upstream, pulling the release's copy from the cluster registry`);
        await this.fetch(cluster);
      }

      return cluster;
    }
  }

  private async present(image: string): Promise<boolean> {
    const images = await this.docker.listImages({ filters: { reference: [image.split('@')[0]] } });

    // A reference without a digest (a locally built or loaded image, e.g. labs) is present by its tag.
    if (!image.includes('@')) return images.length > 0;

    return images.some((i) => (i.RepoDigests ?? []).some((d) => image.endsWith(d.split('@')[1] ?? '__none__')));
  }

  private async fetch(image: string): Promise<void> {
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
    const local = await this.pull(image);

    const container = await this.docker.createContainer({
      Image: local,
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
