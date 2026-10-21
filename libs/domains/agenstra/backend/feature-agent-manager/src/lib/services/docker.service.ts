import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { promisify } from 'util';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Docker = require('dockerode');
import { v4 as uuidv4 } from 'uuid';

import {
  AGENT_ENVIRONMENT_FILE_MAX_BYTES,
  AGENT_ENVIRONMENT_FILE_NAME,
  AGENT_ENVIRONMENT_FILE_PATH,
  AGENT_ENVIRONMENT_IMAGE_LABEL,
  AGENT_ENVIRONMENT_IMAGE_LABEL_VERSION,
  AGENT_ENVIRONMENT_MOUNT_TARGET,
  AGENT_ENVIRONMENT_VOLUME_LABEL,
  AGENT_ENVIRONMENT_VOLUME_PREFIX,
  assertValidEnvironmentVariableName,
  buildFlatTar,
  buildSingleFileTar,
  extractFirstFileFromTar,
  parseDockerEnvList,
  parseEnvironmentFile,
  serializeEnvironmentFile,
  toDockerEnvList,
} from '../utils/agent-environment-file.utils';
import {
  ISOLATION_PROBE_LABEL,
  ISOLATION_PROBE_NAME_PREFIX,
  IsolationReasonCode,
  resolveSandboxedIsolationRuntime,
  resolveSandboxedSharedNetnsIsolationRuntime,
} from '../constants/container-isolation.constants';
import { DockerPullProgressAggregator, type DockerPullProgressEvent } from '../utils/docker-pull-progress.utils';

const execAsync = promisify(exec);

/** How environment changes are applied to a container (see {@link DockerService.updateContainer}). */
export type EnvironmentApplyStrategy = 'restart' | 'recreate';

export interface DockerHostInfo {
  serverVersion: string | null;
  kernelVersion: string | null;
  defaultRuntime: string | null;
  /** Registered runtimes (name -> binary path / runtime type). */
  runtimes: Record<string, string | null>;
}

export interface IsolationProbeOptions {
  /** Runtime requested for the probe container; omitted = Docker's default runtime. */
  runtime?: string;
  /** Runtime the probe container must report (defaults to `runtime`). */
  expectedRuntime?: string;
  image: string;
  timeoutMs: number;
  /** Also verify the egress guard topology (joining a namespace owned by a default-runtime container). */
  sharedNetworkNamespace?: boolean;
  /** Runtime used for the shared-namespace member (defaults to `runtime`). */
  sharedNetworkNamespaceRuntime?: string;
}

export type IsolationProbeResult =
  | { ok: true; gvisorKernelDetected?: boolean }
  | { ok: false; reasonCode: IsolationReasonCode; reason: string };

@Injectable()
export class DockerService {
  private readonly logger = new Logger(DockerService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });
  private static readonly WORKSPACE_CONTEXT_BIND_SOURCE = '/opt/agents';
  private static readonly WORKSPACE_CONTEXT_BIND_TARGET = '/opt/workspace';
  private static readonly ENVIRONMENT_OVERLAY_CACHE_TTL_MS = 15_000;
  private readonly environmentOverlayCache = new Map<
    string,
    { env: Record<string, string> | null; expiresAt: number }
  >();
  private readonly environmentLocks = new Map<string, Promise<unknown>>();

  async createContainer(options: {
    image?: string;
    env?: Record<string, string | undefined>;
    volumes?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
    ports?: Array<{ containerPort: number; hostPort?: number; hostIp?: string; protocol?: 'tcp' | 'udp' }>;
    network?: string;
    /**
     * Join another container's network namespace (`container:<id>`, e.g. the egress guard).
     * Ports are published on (and `network` belongs to) the namespace owner instead.
     */
    sharedNetworkContainerId?: string;
    capDrop?: string[];
    /**
     * Docker runtime of the container (container isolation level, e.g. `runc` / `runsc-systrap`).
     * Always set explicitly so the effective isolation never depends on the daemon default.
     */
    runtime?: string;
    /** Container name (`agenstra-worker-<agentId>`); Docker generates one when omitted. */
    name?: string;
    labels?: Record<string, string>;
  }): Promise<string> {
    const { image, env, volumes = [], network, sharedNetworkContainerId, capDrop, runtime, name, labels } = options;
    // Docker rejects port publishing / exposing for containers sharing another network namespace.
    const ports = sharedNetworkContainerId ? [] : (options.ports ?? []);
    // Resolve image: explicit -> env -> default placeholder
    const resolvedImage = image || process.env.AGENT_DEFAULT_IMAGE || 'ghcr.io/forepath/agenstra-manager-worker:latest';
    // Build HostConfig.Binds from volumes
    const binds = volumes.map((v) => `${v.hostPath}:${v.containerPath}${v.readOnly ? ':ro' : ''}`);
    // Build ExposedPorts and PortBindings from ports
    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, Array<{ HostPort?: string; HostIp?: string }>> = {};

    for (const p of ports) {
      const key = `${p.containerPort}/${p.protocol ?? 'tcp'}`;

      exposedPorts[key] = {};

      if (!portBindings[key]) portBindings[key] = [];

      portBindings[key].push({
        HostPort: p.hostPort ? String(p.hostPort) : undefined,
        ...(p.hostIp ? { HostIp: p.hostIp } : {}),
      });
    }

    // Prefer a local image when present. An unconditional pull of a mutable tag (e.g. :latest)
    // would overwrite a locally rebuilt worker with a stale registry image and break OpenCode serve.
    await this.ensureImageExists(resolvedImage);

    const envMap = this.sanitizeEnvironment(
      Object.fromEntries(Object.entries(env ?? {}).map(([key, value]) => [key, value == null ? '' : String(value)])),
    );
    // Images implementing the environment-mount contract read agent env from a managed volume, so
    // later env updates only need a restart and secrets stay out of `docker inspect` Config.Env.
    const useEnvironmentMount = await this.imageSupportsEnvironmentMount(resolvedImage);
    const environmentVolumeName = useEnvironmentMount ? await this.createEnvironmentVolume() : undefined;

    try {
      const container = await this.docker.createContainer({
        ...(name ? { name } : {}),
        ...(labels && Object.keys(labels).length ? { Labels: labels } : {}),
        Image: resolvedImage,
        Env: useEnvironmentMount ? undefined : env ? toDockerEnvList(envMap) : undefined,
        ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined,
        HostConfig: {
          Binds: binds.length ? binds : undefined,
          Mounts: environmentVolumeName ? [this.buildEnvironmentMount(environmentVolumeName)] : undefined,
          PortBindings: Object.keys(portBindings).length ? portBindings : undefined,
          AutoRemove: false,
          RestartPolicy: {
            Name: 'unless-stopped',
          },
          NetworkMode: sharedNetworkContainerId
            ? `container:${sharedNetworkContainerId}`
            : network
              ? network
              : undefined,
          ...(capDrop?.length ? { CapDrop: capDrop } : {}),
          ...(runtime
            ? {
                Runtime: this.mapSandboxRuntimeForNetwork(
                  runtime,
                  this.needsKernelNetworkStack(
                    sharedNetworkContainerId ? `container:${sharedNetworkContainerId}` : network,
                  ),
                ),
              }
            : {}),
        },
      });

      if (environmentVolumeName) {
        await this.writeEnvironmentOverlay(container, envMap);
        this.cacheEnvironmentOverlay(container.id as unknown as string, envMap);
      }

      // Start container
      await container.start();

      return container.id as unknown as string;
    } catch (error) {
      if (environmentVolumeName) {
        await this.removeEnvironmentVolumeQuietly(environmentVolumeName);
      }

      throw error;
    }
  }

  /**
   * How {@link updateContainer} will apply environment changes to a container:
   * - `restart`: the container mounts the managed environment volume and its image implements the
   *   environment-mount contract, so the env file is rewritten and the container restarted in place
   *   (same container ID, writable layer preserved).
   * - `recreate`: legacy container (or custom image without the contract). It is recreated once;
   *   if the image supports the contract it is migrated to the mounted environment.
   * - A container whose runtime differs from `expectedRuntime` (its isolation level) is recreated.
   * @throws NotFoundException if container is not found
   */
  async getEnvironmentApplyStrategy(containerId: string, expectedRuntime?: string): Promise<EnvironmentApplyStrategy> {
    const inspectInfo = await this.inspectContainerOrThrow(containerId);
    const sharesNamespace = this.needsKernelNetworkStack(inspectInfo.HostConfig?.NetworkMode);

    // A runtime change cannot be applied in place (see updateContainer): the container is recreated.
    if (
      expectedRuntime &&
      this.hasRuntimeMismatch(inspectInfo, this.mapSandboxRuntimeForNetwork(expectedRuntime, sharesNamespace))
    ) {
      return 'recreate';
    }

    return this.resolveEnvironmentApplyStrategy(inspectInfo);
  }

  /**
   * Update a Docker container's environment variables.
   * Containers using the managed environment volume are restarted in place (never deleted): the
   * env file is rewritten and the entrypoint exports it on start. Legacy containers are recreated
   * once and, when the image supports it, migrated to the managed environment volume.
   * @param containerId - The ID of the container to update
   * @param options - Options for updating the container
   * @param options.env - Environment variables to set; `undefined` values remove the key
   * @returns The container ID (unchanged on restart, new ID when the container was recreated)
   * @throws NotFoundException if container is not found
   */
  async updateContainer(
    containerId: string,
    options: {
      env?: Record<string, string | undefined>;
      /**
       * Move the container into another container's network namespace (egress guard).
       * Always recreates the container (network mode is immutable).
       */
      sharedNetworkContainerId?: string;
      capDrop?: string[];
      /**
       * Docker runtime the container must run on (the environment's persisted isolation level).
       * A recreated container always gets it explicitly, so a sandboxed environment can never come
       * back on another runtime. Without it the runtime of the current container is preserved.
       */
      runtime?: string;
    },
  ): Promise<string> {
    const { env, sharedNetworkContainerId, capDrop, runtime } = options;

    try {
      const inspectInfo = await this.inspectContainerOrThrow(containerId);
      const currentlySharesNamespace = this.needsKernelNetworkStack(inspectInfo.HostConfig?.NetworkMode);
      const runtimeMismatch = this.hasRuntimeMismatch(
        inspectInfo,
        runtime ? this.mapSandboxRuntimeForNetwork(runtime, currentlySharesNamespace) : undefined,
      );

      if (sharedNetworkContainerId) {
        return await this.withEnvironmentLock(inspectInfo.Id, () =>
          this.recreateWithUpdatedEnvironment(
            containerId,
            inspectInfo,
            env,
            { sharedNetworkContainerId, capDrop },
            runtime,
          ),
        );
      }

      // A runtime change cannot be applied in place (HostConfig.Runtime is immutable): recreate.
      if (!runtimeMismatch && this.resolveEnvironmentApplyStrategy(inspectInfo) === 'restart') {
        return await this.withEnvironmentLock(inspectInfo.Id, () =>
          this.restartWithUpdatedEnvironment(containerId, inspectInfo, env),
        );
      }

      return await this.withEnvironmentLock(inspectInfo.Id, () =>
        this.recreateWithUpdatedEnvironment(containerId, inspectInfo, env, undefined, runtime),
      );
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error updating container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Effective environment of a container as seen by its processes: `Config.Env` overlaid with the
   * managed environment file (if mounted).
   */
  async getContainerEnvironmentMap(containerId: string): Promise<Record<string, string>> {
    const container = this.docker.getContainer(containerId);
    const inspectInfo = await container.inspect();
    const baseEnv = parseDockerEnvList(inspectInfo.Config?.Env);

    if (!this.findEnvironmentMount(inspectInfo)) {
      return baseEnv;
    }

    const overlay = await this.readEnvironmentOverlay(container);

    this.cacheEnvironmentOverlay(containerId, overlay);

    return { ...baseEnv, ...overlay };
  }

  private async restartWithUpdatedEnvironment(
    containerId: string,
    inspectInfo: Docker.ContainerInspectInfo,
    env: Record<string, string | undefined> | undefined,
  ): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const overlay = this.mergeEnvironment(await this.readEnvironmentOverlay(container), env);

    this.invalidateEnvironmentOverlayCache(containerId);
    await this.writeEnvironmentOverlay(container, overlay);
    this.cacheEnvironmentOverlay(containerId, overlay);

    try {
      await container.restart();
    } catch (error: unknown) {
      const restartError = error as { statusCode?: number };

      if (restartError.statusCode !== 409) {
        throw error;
      }

      await container.start();
    }

    this.logger.log(`Applied environment update to container ${containerId} (restarted in place)`);

    return containerId;
  }

  private async recreateWithUpdatedEnvironment(
    containerId: string,
    inspectInfo: Docker.ContainerInspectInfo,
    env: Record<string, string | undefined> | undefined,
    topology?: { sharedNetworkContainerId: string; capDrop?: string[] },
    runtime?: string,
  ): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const existingEnvironmentMount = this.findEnvironmentMount(inspectInfo);
    const existingOverlay = existingEnvironmentMount ? await this.readEnvironmentOverlay(container) : {};
    // Existing Config.Env values are carried over verbatim (no re-encoding on every update).
    const mergedEnv = this.mergeEnvironment(
      { ...parseDockerEnvList(inspectInfo.Config?.Env), ...existingOverlay },
      env,
    );
    const containerName = inspectInfo.Name.startsWith('/') ? inspectInfo.Name.slice(1) : inspectInfo.Name;
    const image = inspectInfo.Config?.Image || inspectInfo.Image;
    const inspectedHostConfig = inspectInfo.HostConfig || {};
    const targetNetworkMode = topology
      ? `container:${topology.sharedNetworkContainerId}`
      : (inspectedHostConfig.NetworkMode ?? undefined);
    const sharesNetworkNamespace = typeof targetNetworkMode === 'string' && targetNetworkMode.startsWith('container:');
    // Joining a shared namespace: ports / DNS / hosts belong to the namespace owner (Docker rejects them here).
    const hostConfig: Docker.HostConfig = sharesNetworkNamespace
      ? {
          ...inspectedHostConfig,
          NetworkMode: targetNetworkMode,
          PortBindings: undefined,
          PublishAllPorts: false,
          Dns: undefined,
          DnsOptions: undefined,
          DnsSearch: undefined,
          ExtraHosts: undefined,
          ...(topology?.capDrop?.length
            ? { CapDrop: [...new Set([...(inspectedHostConfig.CapDrop ?? []), ...topology.capDrop])] }
            : {}),
        }
      : inspectedHostConfig;
    const kernelNetworkStack = this.needsKernelNetworkStack(targetNetworkMode);
    const resolvedRuntime = this.resolveTargetRuntime(inspectInfo, runtime, kernelNetworkStack);
    const targetRuntime = resolvedRuntime
      ? this.mapSandboxRuntimeForNetwork(resolvedRuntime, kernelNetworkStack)
      : undefined;
    const exposedPorts = sharesNetworkNamespace ? {} : inspectInfo.Config?.ExposedPorts || {};
    const labels = inspectInfo.Config?.Labels || {};
    const networkSettings = inspectInfo.NetworkSettings;
    const mounts = inspectInfo.Mounts || [];

    // Ensure the image exists before touching the current container.
    await this.ensureImageExists(image);

    const imageInfo = await this.docker.getImage(image).inspect();
    const migrateToEnvironmentMount = this.labelsSupportEnvironmentMount(imageInfo.Config?.Labels);
    let containerEnv: string[];
    let overlay: Record<string, string> | undefined;

    if (migrateToEnvironmentMount) {
      // Image defaults stay in Config.Env; everything else moves into the managed env file.
      const imageEnv = parseDockerEnvList(imageInfo.Config?.Env);

      const migratedOverlay = Object.fromEntries(
        Object.entries(mergedEnv).filter(([key, value]) => imageEnv[key] !== value),
      );

      overlay = migratedOverlay;
      containerEnv = toDockerEnvList(
        Object.fromEntries(Object.entries(imageEnv).filter(([key]) => key in mergedEnv && !(key in migratedOverlay))),
      );
    } else {
      containerEnv = toDockerEnvList(mergedEnv);
    }

    const otherMounts = ((hostConfig as { Mounts?: Docker.MountSettings[] }).Mounts ?? []).filter(
      (mount) => mount.Target !== AGENT_ENVIRONMENT_MOUNT_TARGET,
    );
    const mountTargets = new Set([AGENT_ENVIRONMENT_MOUNT_TARGET, ...otherMounts.map((mount) => mount.Target)]);
    // Build volume binds from mounts; entries declared via HostConfig.Mounts (incl. the managed
    // environment volume) are re-attached through Mounts to avoid duplicate mount points.
    const binds = mounts
      .map((mount) => {
        if (mountTargets.has(mount.Destination)) {
          return null;
        }

        if (mount.Type === 'bind' || mount.Type === 'volume') {
          const source = mount.Type === 'volume' && mount.Name ? mount.Name : mount.Source;
          const readOnly = mount.RW === false ? ':ro' : '';

          return `${source}:${mount.Destination}${readOnly}`;
        }

        return null;
      })
      .filter((bind): bind is string => bind !== null);
    const hasWorkspaceContextBind = mounts.some(
      (mount) =>
        mount.Source === DockerService.WORKSPACE_CONTEXT_BIND_SOURCE &&
        mount.Destination === DockerService.WORKSPACE_CONTEXT_BIND_TARGET,
    );

    if (!hasWorkspaceContextBind) {
      binds.push(`${DockerService.WORKSPACE_CONTEXT_BIND_SOURCE}:${DockerService.WORKSPACE_CONTEXT_BIND_TARGET}:ro`);
    }

    const reusedVolumeName = existingEnvironmentMount?.Name;
    const environmentVolumeName = migrateToEnvironmentMount
      ? (reusedVolumeName ?? (await this.createEnvironmentVolume()))
      : undefined;
    const hostMounts = environmentVolumeName
      ? [...otherMounts, this.buildEnvironmentMount(environmentVolumeName)]
      : otherMounts;
    let newContainer: Docker.Container | undefined;
    let previousStopped = false;

    try {
      // Create the replacement (unnamed) and seed its env file before the old container is removed,
      // so a failure here leaves the current container untouched.
      newContainer = await this.docker.createContainer({
        Image: image,
        Env: containerEnv,
        ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined,
        HostConfig: {
          ...hostConfig,
          Binds: binds.length ? binds : undefined,
          Mounts: hostMounts.length ? hostMounts : undefined,
          AutoRemove: hostConfig.AutoRemove ?? false,
          ...(targetRuntime ? { Runtime: targetRuntime } : {}),
        },
        Labels: Object.keys(labels).length ? labels : undefined,
      });

      if (overlay) {
        await this.writeEnvironmentOverlay(newContainer, overlay);
      }

      // Stop and remove the current container; already stopped (304) / gone (404) is fine.
      try {
        await container.stop();
        previousStopped = inspectInfo.State?.Running === true;
      } catch (stopError: unknown) {
        const err = stopError as { statusCode?: number };

        if (err.statusCode !== 304 && err.statusCode !== 404) {
          throw stopError;
        }
      }

      try {
        await container.remove({ force: true });
      } catch (removeError: unknown) {
        const err = removeError as { statusCode?: number };

        if (err.statusCode !== 404) {
          throw removeError;
        }
      }
    } catch (error) {
      // The current container is still in place (or already gone): discard the unused replacement.
      if (previousStopped) {
        await container.start().catch(() => undefined);
      }

      if (newContainer) {
        await newContainer.remove({ force: true }).catch(() => undefined);
      }

      if (environmentVolumeName && environmentVolumeName !== reusedVolumeName) {
        await this.removeEnvironmentVolumeQuietly(environmentVolumeName);
      }

      throw error;
    }

    this.invalidateEnvironmentOverlayCache(containerId);

    if (existingEnvironmentMount?.Name && existingEnvironmentMount.Name !== environmentVolumeName) {
      await this.removeEnvironmentVolumeQuietly(existingEnvironmentMount.Name);
    }

    await newContainer.rename({ name: containerName });

    // Reconnect to networks if the container was connected to any (never for a shared namespace:
    // the namespace owner — e.g. the egress guard — holds the network attachments).
    const networks = sharesNetworkNamespace ? undefined : networkSettings?.Networks;

    if (networks) {
      for (const networkName of Object.keys(networks)) {
        try {
          const network = this.docker.getNetwork(networkName);

          await network.connect({ Container: newContainer.id });
        } catch (networkError: unknown) {
          // Log but don't fail if network connection fails (network might not exist)
          this.logger.warn(`Failed to connect container to network ${networkName}: ${(networkError as Error).message}`);
        }
      }
    }

    // Start the new container
    await newContainer.start();

    const newContainerId = newContainer.id as unknown as string;

    if (overlay) {
      this.cacheEnvironmentOverlay(newContainerId, overlay);
    }

    this.logger.log(
      `Successfully updated container ${containerId} (recreated as ${newContainerId}${
        migrateToEnvironmentMount ? ', migrated to managed environment volume' : ''
      })`,
    );

    return newContainerId;
  }

  /**
   * Runtime a recreated container must use: the expected (persisted) runtime wins; otherwise the
   * current container's runtime is carried over so recreation never changes the isolation level.
   */
  private resolveTargetRuntime(
    inspectInfo: Docker.ContainerInspectInfo,
    expected?: string,
    sharesNetworkNamespace = false,
  ): string | undefined {
    const current = (inspectInfo.HostConfig as { Runtime?: string } | undefined)?.Runtime || undefined;

    if (expected && current && current !== this.mapSandboxRuntimeForNetwork(expected, sharesNetworkNamespace)) {
      this.logger.warn(
        `Container ${inspectInfo.Id} runs on runtime '${current}' but its environment expects '${expected}'; recreating on '${expected}'`,
      );
    }

    return expected || current;
  }

  /**
   * Whether a sandboxed container with this network mode needs gVisor's kernel network stack variant
   * (`--network=host`, i.e. the container namespace's stack instead of Netstack):
   * - `container:<id>` (egress guard namespace): Netstack would take over the guard's interfaces and
   *   bypass its netfilter rules and loopback proxy;
   * - user-defined networks: Docker's embedded DNS (127.0.0.11) relies on netfilter rules inside the
   *   container namespace, which Netstack bypasses (no name resolution at all).
   * Only the default bridge (resolv.conf points at the host's resolvers) works with Netstack.
   */
  private needsKernelNetworkStack(networkMode: string | null | undefined): boolean {
    const mode = (networkMode ?? '').trim();

    return mode !== '' && !['default', 'bridge', 'host', 'none'].includes(mode);
  }

  /**
   * Map a sandbox runtime to the variant required by the container's network (see
   * {@link needsKernelNetworkStack}). Other runtimes are returned unchanged.
   */
  private mapSandboxRuntimeForNetwork(runtime: string, sharesNetworkNamespace: boolean): string {
    const netstack = resolveSandboxedIsolationRuntime();
    const sharedNetns = resolveSandboxedSharedNetnsIsolationRuntime();

    if (runtime !== netstack && runtime !== sharedNetns) {
      return runtime;
    }

    return sharesNetworkNamespace ? sharedNetns : netstack;
  }

  private hasRuntimeMismatch(inspectInfo: Docker.ContainerInspectInfo, expected?: string): boolean {
    if (!expected) {
      return false;
    }

    const current = (inspectInfo.HostConfig as { Runtime?: string } | undefined)?.Runtime || 'runc';

    return current !== expected;
  }

  private async inspectContainerOrThrow(containerId: string): Promise<Docker.ContainerInspectInfo> {
    try {
      return await this.docker.getContainer(containerId).inspect();
    } catch (inspectError: unknown) {
      const err = inspectError as { statusCode?: number };

      if (err.statusCode === 404) {
        throw new NotFoundException(`Container with ID '${containerId}' not found`);
      }

      throw inspectError;
    }
  }

  private resolveEnvironmentApplyStrategy(inspectInfo: Docker.ContainerInspectInfo): EnvironmentApplyStrategy {
    return this.labelsSupportEnvironmentMount(inspectInfo.Config?.Labels) && this.findEnvironmentMount(inspectInfo)
      ? 'restart'
      : 'recreate';
  }

  private labelsSupportEnvironmentMount(labels: Record<string, string> | null | undefined): boolean {
    return labels?.[AGENT_ENVIRONMENT_IMAGE_LABEL] === AGENT_ENVIRONMENT_IMAGE_LABEL_VERSION;
  }

  private async imageSupportsEnvironmentMount(image: string): Promise<boolean> {
    try {
      const imageInfo = await this.docker.getImage(image).inspect();

      return this.labelsSupportEnvironmentMount(imageInfo.Config?.Labels);
    } catch (error: unknown) {
      this.logger.warn(`Failed to inspect image ${image} for environment mount support: ${(error as Error).message}`);

      return false;
    }
  }

  private findEnvironmentMount(
    inspectInfo: Pick<Docker.ContainerInspectInfo, 'Mounts'>,
  ): Docker.ContainerInspectInfo['Mounts'][number] | undefined {
    return (inspectInfo.Mounts ?? []).find(
      (mount) => mount.Type === 'volume' && mount.Destination === AGENT_ENVIRONMENT_MOUNT_TARGET && !!mount.Name,
    );
  }

  private buildEnvironmentMount(volumeName: string): Docker.MountSettings {
    // Writable so the manager can putArchive into it; the image keeps the directory root-only (0700)
    // and the file is written root-owned 0600, so the unprivileged agent user cannot read or modify it.
    return { Type: 'volume', Source: volumeName, Target: AGENT_ENVIRONMENT_MOUNT_TARGET, ReadOnly: false };
  }

  private async createEnvironmentVolume(): Promise<string> {
    const name = `${AGENT_ENVIRONMENT_VOLUME_PREFIX}${uuidv4()}`;

    await this.docker.createVolume({ Name: name, Labels: { [AGENT_ENVIRONMENT_VOLUME_LABEL]: 'true' } });

    return name;
  }

  private async removeEnvironmentVolumeQuietly(volumeName: string): Promise<void> {
    if (!volumeName.startsWith(AGENT_ENVIRONMENT_VOLUME_PREFIX)) {
      return;
    }

    try {
      await this.docker.getVolume(volumeName).remove();
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message?: string };

      if (err.statusCode !== 404) {
        this.logger.warn(`Failed to remove environment volume ${volumeName}: ${err.message}`);
      }
    }
  }

  /**
   * Drop entries that cannot be represented safely (invalid names, NUL in values) instead of failing
   * the whole update; the worker entrypoint would ignore them anyway.
   */
  private sanitizeEnvironment(env: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      try {
        assertValidEnvironmentVariableName(key);
      } catch {
        this.logger.warn('Skipping environment variable with an invalid name');
        continue;
      }

      if (value.includes('\0')) {
        this.logger.warn(`Skipping environment variable ${key}: value contains a NUL character`);
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized;
  }

  private mergeEnvironment(
    current: Record<string, string>,
    changes: Record<string, string | undefined> | undefined,
  ): Record<string, string> {
    const merged: Record<string, string> = { ...current };

    for (const [key, value] of Object.entries(changes ?? {})) {
      if (value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value == null ? '' : String(value);
      }
    }

    return this.sanitizeEnvironment(merged);
  }

  private async readEnvironmentOverlay(container: Docker.Container): Promise<Record<string, string>> {
    let archiveStream: NodeJS.ReadableStream;

    try {
      archiveStream = await container.getArchive({ path: AGENT_ENVIRONMENT_FILE_PATH });
    } catch (error: unknown) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return {};
      }

      throw error;
    }

    const archive = await this.readStreamWithLimit(archiveStream, AGENT_ENVIRONMENT_FILE_MAX_BYTES + 64 * 1024);

    return parseEnvironmentFile(extractFirstFileFromTar(archive));
  }

  private async writeEnvironmentOverlay(container: Docker.Container, env: Record<string, string>): Promise<void> {
    const content = serializeEnvironmentFile(env);

    if (content.length > AGENT_ENVIRONMENT_FILE_MAX_BYTES) {
      throw new Error(`Agent environment exceeds ${AGENT_ENVIRONMENT_FILE_MAX_BYTES} bytes`);
    }

    await container.putArchive(buildSingleFileTar(AGENT_ENVIRONMENT_FILE_NAME, content), {
      path: AGENT_ENVIRONMENT_MOUNT_TARGET,
    });
  }

  private readStreamWithLimit(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
          reject(error);
        }
      };

      stream.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

        total += buffer.length;

        if (total > maxBytes) {
          fail(new Error(`Archive exceeds ${maxBytes} bytes`));

          return;
        }

        chunks.push(buffer);
      });
      stream.on('error', (error: Error) => fail(error));
      stream.on('end', () => {
        if (!settled) {
          settled = true;
          resolve(Buffer.concat(chunks));
        }
      });
    });
  }

  private cacheEnvironmentOverlay(containerId: string, env: Record<string, string> | null): void {
    this.environmentOverlayCache.set(containerId, {
      env,
      expiresAt: Date.now() + DockerService.ENVIRONMENT_OVERLAY_CACHE_TTL_MS,
    });
  }

  private invalidateEnvironmentOverlayCache(containerId: string): void {
    for (const key of this.environmentOverlayCache.keys()) {
      if (key === containerId || key.startsWith(containerId) || containerId.startsWith(key)) {
        this.environmentOverlayCache.delete(key);
      }
    }
  }

  /**
   * `docker exec` only inherits `Config.Env`, so processes spawned via exec receive the managed
   * environment explicitly (passed via exec `Env`, never via argv).
   */
  private async getExecEnvironmentOptions(containerId: string, user?: string): Promise<{ Env?: string[] }> {
    if (!user || user === '0') {
      return {};
    }

    try {
      const cached = this.environmentOverlayCache.get(containerId);
      let overlay: Record<string, string> | null;

      if (cached && cached.expiresAt > Date.now()) {
        overlay = cached.env;
      } else {
        const container = this.docker.getContainer(containerId);
        const inspectInfo = await container.inspect();

        overlay = this.findEnvironmentMount(inspectInfo) ? await this.readEnvironmentOverlay(container) : null;
        this.cacheEnvironmentOverlay(containerId, overlay);
      }

      return overlay && Object.keys(overlay).length > 0 ? { Env: toDockerEnvList(overlay) } : {};
    } catch (error: unknown) {
      this.logger.debug(
        `Could not resolve managed environment for exec in ${containerId}: ${(error as Error).message}`,
      );

      return {};
    }
  }

  private async withEnvironmentLock<T>(containerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.environmentLocks.get(containerId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);

    this.environmentLocks.set(containerId, tail);

    try {
      return await run;
    } finally {
      if (this.environmentLocks.get(containerId) === tail) {
        this.environmentLocks.delete(containerId);
      }
    }
  }

  /**
   * Delete a Docker container by ID.
   * Stops the container if it's running, then removes it.
   * @param containerId - The ID of the container to delete
   * @throws NotFoundException if container is not found
   */
  async deleteContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      // Check if container exists and get its state
      let containerInfo;

      try {
        containerInfo = await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Stop the container if it's running
      if (containerInfo.State?.Running) {
        try {
          await container.stop();
        } catch (error: unknown) {
          const stopError = error as { statusCode?: number; message?: string };

          // Ignore error if container is already stopped (409 Conflict)
          if (stopError.statusCode !== 409) {
            this.logger.warn(`Failed to stop container ${containerId}: ${stopError.message}`, stopError);
            // Continue with removal attempt even if stop failed
          }
        }
      }

      // Remove the container
      try {
        await container.remove();
      } catch (error: unknown) {
        const removeError = error as { statusCode?: number; message?: string };

        // If container doesn't exist (404), consider it already deleted
        if (removeError.statusCode === 404) {
          this.logger.debug(`Container ${containerId} was already removed`);
        } else if (removeError.statusCode === 409) {
          // If container is still running (409), try force removal
          this.logger.warn(`Container ${containerId} is still running, attempting force removal`);

          try {
            await container.remove({ force: true });
          } catch (forceError: unknown) {
            const forceErr = forceError as { message?: string; stack?: string };

            this.logger.error(`Failed to force remove container ${containerId}: ${forceErr.message}`, forceErr.stack);
            throw forceError;
          }
        } else {
          const err = removeError as { message?: string; stack?: string };

          this.logger.error(`Failed to remove container ${containerId}: ${err.message}`, err.stack);
          throw error;
        }
      }

      this.invalidateEnvironmentOverlayCache(containerId);

      const environmentVolumeName = this.findEnvironmentMount(containerInfo)?.Name;

      if (environmentVolumeName) {
        await this.removeEnvironmentVolumeQuietly(environmentVolumeName);
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error deleting container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Start a Docker container by ID.
   * @param containerId - The ID of the container to start
   * @throws NotFoundException if container is not found
   */
  async startContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      try {
        await container.start();
        this.logger.log(`Started container ${containerId}`);
      } catch (error: unknown) {
        const startError = error as { statusCode?: number; message?: string };

        if (startError.statusCode === 304) {
          this.logger.debug(`Container ${containerId} is already running`);

          return;
        }

        const err = startError as { message?: string; stack?: string };

        this.logger.error(`Failed to start container ${containerId}: ${err.message}`, err.stack);
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error starting container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Stop a Docker container by ID.
   * @param containerId - The ID of the container to stop
   * @throws NotFoundException if container is not found
   */
  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      try {
        await container.stop();
        this.logger.log(`Stopped container ${containerId}`);
      } catch (error: unknown) {
        const stopError = error as { statusCode?: number; message?: string };

        if (stopError.statusCode === 304) {
          this.logger.debug(`Container ${containerId} is already stopped`);

          return;
        }

        const err = stopError as { message?: string; stack?: string };

        this.logger.error(`Failed to stop container ${containerId}: ${err.message}`, err.stack);
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error stopping container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Restart a Docker container by ID.
   * Stops the container if it's running, then starts it again.
   * @param containerId - The ID of the container to restart
   * @throws NotFoundException if container is not found
   */
  async restartContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Restart the container
      try {
        await container.restart();
        this.logger.log(`Restarted container ${containerId}`);
      } catch (error: unknown) {
        const restartError = error as { statusCode?: number; message?: string };

        // If container is not running (409 Conflict), try to start it
        if (restartError.statusCode === 409) {
          this.logger.debug(`Container ${containerId} is not running, attempting to start it`);

          try {
            await container.start();
            this.logger.log(`Started container ${containerId}`);
          } catch (startError: unknown) {
            const startErr = startError as { message?: string; stack?: string };

            this.logger.error(`Failed to start container ${containerId}: ${startErr.message}`, startErr.stack);
            throw startError;
          }
        } else {
          const err = restartError as { message?: string; stack?: string };

          this.logger.error(`Failed to restart container ${containerId}: ${err.message}`, err.stack);
          throw error;
        }
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error restarting container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Ensure a Docker network exists by name (create if missing).
   * Idempotent: concurrent creates that race to 409 Conflict are treated as success.
   */
  async ensureNetworkExists(name: string, driver = 'bridge'): Promise<void> {
    try {
      await this.docker.getNetwork(name).inspect();

      return;
    } catch (error: unknown) {
      const dockerError = error as { statusCode?: number };

      if (dockerError.statusCode !== 404) {
        throw error;
      }
    }

    try {
      await this.createNetwork({ name, driver });
    } catch (error: unknown) {
      const dockerError = error as { statusCode?: number; message?: string };

      // Another process created the network between inspect and create.
      if (dockerError.statusCode === 409) {
        this.logger.debug(`Network ${name} already exists (create race)`);

        return;
      }

      throw error;
    }
  }

  /**
   * Create a Docker network and optionally attach containers to it.
   * @param options - Network creation options
   * @param options.name - The name of the network
   * @param options.driver - Network driver (default: 'bridge')
   * @param options.containerIds - Optional list of container IDs to attach to the network
   * @returns The network ID
   */
  async createNetwork(options: { name?: string; driver?: string; containerIds?: string[] }): Promise<string> {
    try {
      const { name = uuidv4(), driver = 'bridge', containerIds = [] } = options;
      // Create the network
      const network = await this.docker.createNetwork({
        Name: name,
        Driver: driver,
      });
      const networkId = network.id as unknown as string;

      // Attach containers if provided
      if (containerIds.length > 0) {
        for (const containerId of containerIds) {
          try {
            await network.connect({ Container: containerId });
            this.logger.debug(`Attached container ${containerId} to network ${name}`);
          } catch (error: unknown) {
            const connectError = error as { statusCode?: number; message?: string };

            // Log warning but continue attaching other containers
            this.logger.warn(`Failed to attach container ${containerId} to network ${name}: ${connectError.message}`);
          }
        }
      }

      this.logger.log(`Created network ${name} with ID ${networkId}`);

      return networkId;
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error creating network: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Delete a Docker network by ID.
   * Automatically disconnects all containers from the network before deletion.
   * @param networkId - The ID of the network to delete
   * @throws NotFoundException if network is not found
   */
  async deleteNetwork(networkId: string): Promise<void> {
    try {
      const network = this.docker.getNetwork(networkId);
      // Check if network exists and get its info
      let networkInfo;

      try {
        networkInfo = await network.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Network with ID '${networkId}' not found`);
        }

        throw error;
      }

      // Disconnect all containers from the network
      const containers = networkInfo.Containers || {};
      const containerIds = Object.keys(containers);

      if (containerIds.length > 0) {
        this.logger.debug(`Disconnecting ${containerIds.length} containers from network ${networkId}`);

        for (const containerId of containerIds) {
          try {
            await network.disconnect({ Container: containerId });
            this.logger.debug(`Disconnected container ${containerId} from network ${networkId}`);
          } catch (error: unknown) {
            const disconnectError = error as { statusCode?: number; message?: string };

            // Log warning but continue disconnecting other containers
            // Ignore 404 errors (container already disconnected or doesn't exist)
            if (disconnectError.statusCode !== 404) {
              this.logger.warn(
                `Failed to disconnect container ${containerId} from network ${networkId}: ${disconnectError.message}`,
              );
            }
          }
        }
      }

      // Remove the network
      try {
        await network.remove();
        this.logger.log(`Deleted network ${networkId}`);
      } catch (error: unknown) {
        const removeError = error as { statusCode?: number; message?: string };

        // If network doesn't exist (404), consider it already deleted
        if (removeError.statusCode === 404) {
          this.logger.debug(`Network ${networkId} was already removed`);

          return;
        }

        const err = removeError as { message?: string; stack?: string };

        this.logger.error(`Failed to remove network ${networkId}: ${err.message}`, err.stack);
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error deleting network: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Stop and remove containers whose image name contains any of the given substrings.
   * Used to clean up legacy SSH/VNC sidecars after feature removal.
   * @returns Number of containers removed
   */
  async removeContainersByImageNameSubstring(imageSubstrings: string[]): Promise<number> {
    if (imageSubstrings.length === 0) {
      return 0;
    }

    const containers = await this.docker.listContainers({ all: true });
    let removed = 0;

    for (const summary of containers) {
      const image = summary.Image || '';
      const matches = imageSubstrings.some((substring) => image.includes(substring));

      if (!matches) {
        continue;
      }

      try {
        await this.deleteContainer(summary.Id);
        removed += 1;
        this.logger.log(`Removed legacy sidecar container ${summary.Id} (image: ${image})`);
      } catch (error: unknown) {
        const err = error as { message?: string };

        this.logger.warn(`Failed to remove legacy sidecar container ${summary.Id}: ${err.message}`);
      }
    }

    return removed;
  }

  /**
   * Get container logs as a stream of lines.
   * First returns historical logs, then tails live logs.
   * @param containerId - The ID of the container
   * @returns An async iterable that yields log lines
   * @throws NotFoundException if container is not found
   */
  async *getContainerLogs(containerId: string): AsyncIterable<string> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // First, get historical logs
      const historicalLogs = await container.logs({
        stdout: true,
        stderr: true,
        tail: 100, // Get last 100 lines of historical logs
        timestamps: false,
      });
      // Parse historical logs and yield each line
      const historicalBuffer = Buffer.isBuffer(historicalLogs) ? historicalLogs : Buffer.from(historicalLogs);
      const historicalLines = historicalBuffer.toString('utf-8').split('\n');

      for (const line of historicalLines) {
        if (line.trim()) {
          yield line;
        }
      }

      // Then, tail live logs
      // When follow: true, dockerode returns a stream directly (not a promise)
      const logStream = (await container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail: 0, // Start from now (no historical logs, we already got them)
        timestamps: false,
      })) as NodeJS.ReadableStream;
      // Process live log stream
      let buffer = '';

      try {
        for await (const chunk of logStream) {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');

          // Keep the last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              yield line;
            }
          }
        }

        // Yield any remaining buffer content
        if (buffer.trim()) {
          yield buffer;
        }
      } catch (streamError: unknown) {
        // Stream ended or error occurred
        const err = streamError as { code?: string; message?: string; stack?: string };

        if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
          this.logger.error(`Error reading log stream: ${err.message}`, err.stack);
          throw streamError;
        }
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error getting container logs: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Parse a shell command string into an array of arguments.
   * Handles single quotes, double quotes, escaped characters, and spaces.
   * @param command - The command string to parse
   * @returns Array of parsed arguments
   * @example
   * parseShellCommand("git clone 'https://url' /app") // ['git', 'clone', 'https://url', '/app']
   * parseShellCommand('echo "hello world"') // ['echo', 'hello world']
   * parseShellCommand('ls -la /tmp\\ with\\ spaces') // ['ls', '-la', '/tmp with spaces']
   */
  private parseShellCommand(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let i = 0;

    while (i < command.length) {
      const char = command[i];
      const nextChar = i + 1 < command.length ? command[i + 1] : null;

      if (inSingleQuote) {
        // Inside single quotes: everything is literal except the closing quote
        if (char === "'") {
          inSingleQuote = false;
        } else {
          current += char;
        }
      } else if (inDoubleQuote) {
        // Inside double quotes: backslash escapes next character
        if (char === '\\' && nextChar !== null) {
          current += nextChar;
          i++; // Skip next character as it's escaped
        } else if (char === '"') {
          inDoubleQuote = false;
        } else {
          current += char;
        }
      } else {
        // Not in quotes
        if (char === '\\' && nextChar !== null) {
          // Escaped character
          current += nextChar;
          i++; // Skip next character as it's escaped
        } else if (char === "'") {
          inSingleQuote = true;
        } else if (char === '"') {
          inDoubleQuote = true;
        } else if (/\s/.test(char)) {
          // Whitespace: end current argument
          if (current.length > 0) {
            args.push(current);
            current = '';
          }

          // Skip additional whitespace
          while (i + 1 < command.length && /\s/.test(command[i + 1])) {
            i++;
          }
        } else {
          current += char;
        }
      }

      i++;
    }

    // Add final argument if any
    if (current.length > 0) {
      args.push(current);
    }

    return args;
  }

  /**
   * Send a command or keystrokes to a container.
   * Executes a command in the container and optionally sends input/keystrokes to stdin.
   * @param containerId - The ID of the container
   * @param command - Shell string (parsed) or argv array passed straight to Docker exec
   * @param input - Optional input/keystrokes to send to stdin (string or array of strings)
   * @param checkExitCode - If true, check exit code and throw error if non-zero (default: false)
   * @param options.user - Optional container user for the exec (e.g. `'0'` or `agenstra`)
   * @param options.env - Optional `NAME=value` entries appended to the exec environment (override earlier entries)
   * @returns The command output (stdout and stderr combined)
   * @throws NotFoundException if container is not found
   * @throws Error if checkExitCode is true and command exits with non-zero code
   */
  async sendCommandToContainer(
    containerId: string,
    command: string | string[],
    input?: string | string[],
    checkExitCode = false,
    options?: { user?: string; env?: string[] },
  ): Promise<string> {
    try {
      this.logger.debug(
        `Sending command to container ${containerId}: ${Array.isArray(command) ? command.join(' ') : command}`,
      );

      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Argv arrays skip parseShellCommand (needed for `sh -c` scripts with spaced paths).
      const commandParts = Array.isArray(command) ? command : this.parseShellCommand(command.trim());
      const executable = commandParts[0];
      const args = commandParts.slice(1);
      // Create exec instance with stdin enabled for keystrokes.
      // Optional User (e.g. '0') runs as that container UID — used for absolute paths outside /app.
      const environmentOptions = await this.getExecEnvironmentOptions(containerId, options?.user);
      const execInstance = await container.exec({
        ...(options?.env?.length ? { Env: [...(environmentOptions.Env ?? []), ...options.env] } : environmentOptions),
        Cmd: [executable, ...args],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false, // Disable TTY to properly capture output
        ...(options?.user ? { User: options.user } : {}),
      });
      // Start the exec
      const stream = (await execInstance.start({
        hijack: true,
        stdin: true,
      })) as NodeJS.ReadWriteStream;
      // Collect output from stdout and stderr
      const outputChunks: Buffer[] = [];
      const decodeOutput = (): string => {
        const buffer = Buffer.concat(outputChunks);
        const chunks: Buffer[] = [];
        let offset = 0;

        while (offset < buffer.length) {
          if (
            offset + 8 > buffer.length ||
            (buffer[offset] !== 1 && buffer[offset] !== 2) ||
            buffer[offset + 1] !== 0 ||
            buffer[offset + 2] !== 0 ||
            buffer[offset + 3] !== 0
          ) {
            chunks.push(buffer.subarray(offset));
            break;
          }

          const end = offset + 8 + buffer.readUInt32BE(offset + 4);

          if (end > buffer.length) {
            throw new Error('Incomplete Docker exec output frame');
          }

          chunks.push(buffer.subarray(offset + 8, end));
          offset = end;
        }

        return Buffer.concat(chunks).toString('utf-8').trim();
      };

      stream.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      // Send input/keystrokes if provided
      if (input !== undefined) {
        // Normalize input: convert literal \n strings to actual newlines
        // This handles cases where \n is passed as literal "\\n" over websocket connections
        let inputArray: string[];

        if (Array.isArray(input)) {
          // For arrays: normalize each element, then split each element if it contains newlines
          inputArray = input.flatMap((line) => {
            const normalized = line.replace(/\\n/g, '\n');

            return normalized.split(/\r?\n/);
          });
        } else {
          // For strings: normalize, then split
          const normalized = input.replace(/\\n/g, '\n');

          inputArray = normalized.split(/\r?\n/);
        }

        // Send each line separately
        for (const inputLine of inputArray) {
          // Add newline if not present (simulates Enter key)
          const lineToSend = inputLine.endsWith('\n') ? inputLine : `${inputLine}\n`;

          stream.write(lineToSend);
        }
      }

      // Close stdin to signal end of input
      stream.end();

      // Wait for the stream to finish and collect output
      const output = await new Promise<string>((resolve, reject) => {
        let resolved = false;
        let extractedOutput = ''; // Declare outside event handlers for scope
        const resolveOnce = (result: string) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(commandTimeout);
            resolve(result);
          }
        };
        const rejectOnce = (error: unknown) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(commandTimeout);
            reject(error);
          }
        };
        const commandTimeout = setTimeout(() => {
          if (!resolved) {
            const combinedBuffer = Buffer.concat(outputChunks);
            const timeoutOutput = combinedBuffer.toString('utf-8').trim();

            rejectOnce(
              new Error(`Command timed out after 24 hours${timeoutOutput ? `\nOutput: ${timeoutOutput}` : ''}`),
            );
          }
        }, 86400000);

        stream.on('end', () => {
          try {
            extractedOutput = decodeOutput();
          } catch (error) {
            rejectOnce(error);
            return;
          }

          // If exit code checking is disabled, resolve immediately (backward compatible)
          // Otherwise, wait for close event to check exit code
          if (!checkExitCode) {
            resolveOnce(extractedOutput.trim());
          }
        });

        stream.on('close', () => {
          if (resolved) return;

          // Extract output if not already extracted
          let finalOutput: string;

          try {
            finalOutput = decodeOutput();
          } catch (error) {
            rejectOnce(error);
            return;
          }

          // If exit code checking is enabled, check the exit code
          if (checkExitCode) {
            this.inspectExecUntilExited(execInstance)
              .then((execInspect) => {
                const exitCode = execInspect.ExitCode;

                if (exitCode !== 0 && exitCode !== null) {
                  // Command failed - reject with error including output
                  const errorMessage = finalOutput || `Command failed with exit code ${exitCode}`;

                  this.logger.error(`Command failed with exit code ${exitCode}: ${errorMessage}`);
                  rejectOnce(new Error(errorMessage));
                } else {
                  // Command succeeded
                  resolveOnce(finalOutput);
                }
              })
              .catch((inspectError) => {
                // If we can't inspect, log warning but resolve with output
                const err = inspectError as { message?: string };

                this.logger.warn(`Failed to inspect exec exit code: ${err.message}`);
                resolveOnce(finalOutput);
              });
          } else {
            // No exit code checking - resolve with output (backward compatible behavior)
            resolveOnce(finalOutput);
          }
        });

        stream.on('error', (error: unknown) => {
          const err = error as { code?: string; message?: string };

          // Ignore EPIPE errors (stdin closed) - this is expected when stdin ends
          if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
            rejectOnce(error);
          } else {
            // For EPIPE/ECONNRESET, resolve with collected output
            try {
              resolveOnce(decodeOutput());
            } catch (decodeError) {
              rejectOnce(decodeError);
            }
          }
        });
      });

      return output;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error sending command to container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Start a long-lived exec that streams demultiplexed stdout/stderr lines until stopped.
   * Used for inotifywait and similar watchers. Does not wait for process exit.
   */
  async startStreamingExec(
    containerId: string,
    command: string[],
    onLine: (line: string) => void,
  ): Promise<{ stop: () => Promise<void> }> {
    const container = this.docker.getContainer(containerId);

    try {
      await container.inspect();
    } catch (error: unknown) {
      const dockerError = error as { statusCode?: number };

      if (dockerError.statusCode === 404) {
        throw new NotFoundException(`Container with ID '${containerId}' not found`);
      }

      throw error;
    }

    const execInstance = await container.exec({
      ...(await this.getExecEnvironmentOptions(containerId, 'agenstra')),
      Cmd: command,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: 'agenstra',
    });
    const stream = (await execInstance.start({
      hijack: true,
      stdin: false,
    })) as NodeJS.ReadableStream;

    let frameBuffer = Buffer.alloc(0);
    let lineLeftover = '';
    let stopped = false;

    const onData = (chunk: Buffer): void => {
      if (stopped) {
        return;
      }

      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      let offset = 0;
      let demuxed = '';

      while (offset + 5 <= frameBuffer.length) {
        const streamType = frameBuffer[offset];
        const dataLength = frameBuffer.readUInt32BE(offset + 1);
        const dataStart = offset + 5;
        const dataEnd = dataStart + dataLength;

        if (dataEnd > frameBuffer.length) {
          break;
        }

        if (streamType === 1 || streamType === 2) {
          demuxed += frameBuffer.subarray(dataStart, dataEnd).toString('utf-8');
        }

        offset = dataEnd;
      }

      frameBuffer = frameBuffer.subarray(offset);

      if (!demuxed) {
        return;
      }

      const combined = lineLeftover + demuxed;
      const parts = combined.split(/\r?\n/);

      lineLeftover = parts.pop() ?? '';

      for (const part of parts) {
        const line = part.trim();

        if (line) {
          onLine(line);
        }
      }
    };

    stream.on('data', onData);

    return {
      stop: async () => {
        stopped = true;

        try {
          (stream as { destroy?: () => void }).destroy?.();
        } catch {
          // ignore
        }
      },
    };
  }

  /**
   * Execute a command in a container and stream demuxed stdout/stderr chunks as they arrive.
   *
   * Intended for provider-level streaming (e.g. JSONL agent outputs). This uses dockerode's
   * `demuxStream` to avoid multiplexing artifacts.
   */
  async *execCommandStream(
    containerId: string,
    command: string,
    input?: string | string[],
  ): AsyncIterable<{ stream: 'stdout' | 'stderr'; chunk: string }> {
    this.logger.debug(`Streaming command from container ${containerId}: ${command}`);

    const container = this.docker.getContainer(containerId);

    // Check if container exists
    try {
      await container.inspect();
    } catch (error: unknown) {
      const dockerError = error as { statusCode?: number };

      if (dockerError.statusCode === 404) {
        throw new NotFoundException(`Container with ID '${containerId}' not found`);
      }

      throw error;
    }

    const commandParts = this.parseShellCommand(command.trim());
    const executable = commandParts[0];
    const args = commandParts.slice(1);
    const execInstance = await container.exec({
      ...(await this.getExecEnvironmentOptions(containerId, 'agenstra')),
      Cmd: [executable, ...args],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: 'agenstra',
    });
    const stream = (await execInstance.start({
      hijack: true,
      stdin: true,
    })) as NodeJS.ReadWriteStream;
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    type QueueItem = { stream: 'stdout' | 'stderr'; chunk: string };
    const queue: QueueItem[] = [];
    let done = false;
    let error: unknown | null = null;
    const notify = (() => {
      let resolve: (() => void) | null = null;
      const wait = () =>
        new Promise<void>((r) => {
          resolve = r;
        });
      const signal = () => {
        resolve?.();
        resolve = null;
      };

      return { wait, signal };
    })();
    const onData = (which: 'stdout' | 'stderr') => (chunk: Buffer) => {
      queue.push({ stream: which, chunk: chunk.toString('utf-8') });
      notify.signal();
    };
    const onError = (err: unknown) => {
      error = err;
      done = true;
      notify.signal();
    };
    const tryFinish = () => {
      if (stdoutStream.readableEnded && stderrStream.readableEnded) {
        done = true;
        notify.signal();
      }
    };

    stdoutStream.on('data', onData('stdout'));
    stderrStream.on('data', onData('stderr'));
    stdoutStream.on('error', onError);
    stderrStream.on('error', onError);
    stdoutStream.on('end', tryFinish);
    stderrStream.on('end', tryFinish);
    stream.on('error', onError);

    if (input !== undefined) {
      let inputArray: string[];

      if (Array.isArray(input)) {
        inputArray = input.flatMap((line) => line.replace(/\\n/g, '\n').split(/\r?\n/));
      } else {
        inputArray = input.replace(/\\n/g, '\n').split(/\r?\n/);
      }

      for (const inputLine of inputArray) {
        const lineToSend = inputLine.endsWith('\n') ? inputLine : `${inputLine}\n`;

        stream.write(lineToSend);
      }
    }

    stream.end();

    while (!done || queue.length > 0) {
      if (error) {
        throw error;
      }

      const item = queue.shift();

      if (item) {
        yield item;
        continue;
      }

      if (done) {
        break;
      }

      await notify.wait();
    }
  }

  /**
   * Read file content from container using demuxStream for proper stream handling.
   * This method uses Docker's built-in demuxStream to properly separate stdout/stderr,
   * which eliminates null byte artifacts that can occur with manual parsing.
   * @param containerId - The container ID
   * @param filePath - The absolute path to the file in the container
   * @returns The file content as a string
   * @throws NotFoundException if container is not found
   */
  async readFileFromContainer(containerId: string, filePath: string): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Escape file path for shell usage
      const escapedPath = filePath.replace(/'/g, "'\\''");
      const safePath = `'${escapedPath}'`;
      // Create exec instance to read file
      const exec = await container.exec({
        ...(await this.getExecEnvironmentOptions(containerId, 'agenstra')),
        Cmd: ['sh', '-c', `cat ${safePath}`],
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        User: 'agenstra',
      });
      // Start the exec
      const stream = (await exec.start({
        hijack: true,
        stdin: false,
      })) as NodeJS.ReadWriteStream;
      // Use PassThrough streams and demuxStream to properly handle Docker's multiplexed format
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      let stdoutData = '';
      let stderrData = '';

      // Collect data from stdout
      stdoutStream.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf8');
      });

      // Collect data from stderr (for error messages)
      stderrStream.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString('utf8');
      });

      // Use Docker's built-in demuxStream to properly separate stdout and stderr
      container.modem.demuxStream(stream, stdoutStream, stderrStream);

      // Wait for the stream to finish
      const output = await new Promise<string>((resolve, reject) => {
        let resolved = false;
        const resolveOnce = (result: string) => {
          if (!resolved) {
            resolved = true;
            resolve(result);
          }
        };
        const rejectOnce = (error: unknown) => {
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        };

        stream.on('end', () => {
          // End the PassThrough streams
          stdoutStream.end();
          stderrStream.end();

          // If there's stderr output, it might be an error
          if (stderrData.trim()) {
            // Check if it's a file not found error
            if (stderrData.includes('No such file') || stderrData.includes('not found')) {
              rejectOnce(new Error(`File not found: ${filePath}`));
            } else {
              // Log stderr but still return stdout (some commands write to stderr)
              this.logger.debug(`Stderr output from file read: ${stderrData}`);
              resolveOnce(stdoutData);
            }
          } else {
            resolveOnce(stdoutData);
          }
        });

        stream.on('close', () => {
          if (!resolved) {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        });

        stream.on('error', (error: unknown) => {
          const err = error as { code?: string; message?: string };

          // Ignore EPIPE errors (stdin closed) - this is expected
          if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
            rejectOnce(error);
          } else {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        });

        // Set a timeout to prevent hanging (fallback safety)
        setTimeout(() => {
          if (!resolved) {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        }, 60000);
      });

      return output.trim();
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error reading file from container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Inspect an exec until Docker reports it finished (the output stream can end before the exit code is set).
   * Bounded to ~5s; callers decide how to treat a still-unknown exit code.
   */
  private async inspectExecUntilExited(exec: Docker.Exec): Promise<Docker.ExecInspectInfo> {
    let execInfo = await exec.inspect();

    for (let attempt = 0; (execInfo.Running || execInfo.ExitCode === null) && attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      execInfo = await exec.inspect();
    }

    return execInfo;
  }

  /**
   * Read raw file bytes from a container via `cat` executed as the given (non-root) user.
   * Unlike `getArchive` (daemon privileges), path resolution and permission checks happen with
   * the exec user's rights, so symlinks cannot be used to read files that user cannot read.
   * @param containerId - The container ID
   * @param filePath - Absolute path inside the container
   * @param options.user - Container user for the exec (e.g. `agenstra`)
   * @param options.maxBytes - Abort and reject when the file exceeds this many bytes
   * @returns File content as a Buffer
   * @throws NotFoundException if the container or file is not found
   */
  async readFileBytesFromContainer(
    containerId: string,
    filePath: string,
    options: { user: string; maxBytes: number },
  ): Promise<Buffer> {
    const container = this.docker.getContainer(containerId);

    try {
      await container.inspect();
    } catch (error: unknown) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        throw new NotFoundException(`Container with ID '${containerId}' not found`);
      }

      throw error;
    }

    const exec = await container.exec({
      ...(await this.getExecEnvironmentOptions(containerId, options.user)),
      // Regular files only: `cat` on a FIFO would block the exec until the timeout.
      Cmd: [
        'sh',
        '-c',
        'if [ ! -e "$1" ]; then echo "cat: $1: No such file or directory" >&2; exit 1; fi; ' +
          'if [ ! -f "$1" ]; then echo "cat: $1: Not a regular file" >&2; exit 1; fi; ' +
          'exec cat -- "$1"',
        'sh',
        filePath,
      ],
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: options.user,
    });
    const stream = (await exec.start({
      hijack: true,
      stdin: false,
    })) as NodeJS.ReadWriteStream;
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrData = '';

    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let pendingStreams = 2;
      const settle = (error?: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const finishSource = () => {
        // Flush demuxed output; resolve once both demux targets have drained.
        stdoutStream.end();
        stderrStream.end();
      };
      const onDemuxedEnd = () => {
        pendingStreams -= 1;

        if (pendingStreams === 0) {
          settle();
        }
      };
      const timeout = setTimeout(() => {
        (stream as NodeJS.ReadWriteStream & { destroy?: () => void }).destroy?.();
        settle(new Error(`Timed out reading file: ${filePath}`));
      }, 300000);

      stdoutStream.on('data', (chunk: Buffer) => {
        if (settled) {
          return;
        }

        stdoutBytes += chunk.length;

        if (stdoutBytes > options.maxBytes) {
          (stream as NodeJS.ReadWriteStream & { destroy?: () => void }).destroy?.();
          settle(new BadRequestException(`File size exceeds maximum allowed size of ${options.maxBytes} bytes`));

          return;
        }

        stdoutChunks.push(chunk);
      });
      stderrStream.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString('utf8');
      });
      stdoutStream.on('end', onDemuxedEnd);
      stderrStream.on('end', onDemuxedEnd);
      stream.on('end', finishSource);
      stream.on('close', finishSource);
      stream.on('error', (error: unknown) => {
        const err = error as { code?: string };

        if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
          finishSource();
        } else {
          settle(error);
        }
      });
    });

    // The stream can end before Docker records the exit code; never treat an unknown exit as success.
    const { ExitCode: exitCode } = await this.inspectExecUntilExited(exec);

    if (exitCode !== 0) {
      if (stderrData.includes('No such file') || stderrData.includes('not found')) {
        throw new NotFoundException(`File not found: ${filePath}`);
      }

      throw new Error(stderrData.trim() || `Reading ${filePath} failed with exit code ${exitCode}`);
    }

    return Buffer.concat(stdoutChunks, stdoutBytes);
  }

  /**
   * Resolve the container user's home directory (for tilde expansion in provider config paths).
   * @param containerId - Docker container ID
   * @returns Trimmed HOME path, or `/home/agenstra` when empty
   */
  async getContainerHomeDirectory(containerId: string): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);

      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      const exec = await container.exec({
        ...(await this.getExecEnvironmentOptions(containerId, 'agenstra')),
        Cmd: ['sh', '-c', 'printf %s "${HOME:-/home/agenstra}"'],
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        User: 'agenstra',
      });
      const stream = (await exec.start({
        hijack: true,
        stdin: false,
      })) as NodeJS.ReadWriteStream;
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      let stdoutData = '';

      container.modem.demuxStream(stream, stdoutStream, stderrStream);
      stdoutStream.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf8');
      });

      const output = await new Promise<string>((resolve, reject) => {
        let resolved = false;
        const resolveOnce = (v: string) => {
          if (!resolved) {
            resolved = true;
            resolve(v);
          }
        };
        const rejectOnce = (err: unknown) => {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        };

        stream.on('end', () => {
          stdoutStream.end();
          stderrStream.end();
          resolveOnce(stdoutData);
        });
        stream.on('close', () => {
          if (!resolved) {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        });
        stream.on('error', (err: unknown) => {
          stdoutStream.end();
          stderrStream.end();
          rejectOnce(err);
        });
        setTimeout(() => {
          if (!resolved) {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        }, 60000);
      });
      const home = output.trim() || '/home/agenstra';

      return home;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error resolving HOME in container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Copy a file from container to host filesystem using docker cp (via getArchive).
   * This method uses Docker's getArchive API to copy files reliably, especially for binary files.
   * @param containerId - The container ID
   * @param containerPath - The absolute path to the file in the container
   * @param hostPath - The path on the host filesystem where the file should be copied
   * @throws NotFoundException if container or file is not found
   */
  async copyFileFromContainer(containerId: string, containerPath: string, hostPath: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Get the file as a tar archive stream
      const tarStream = await container.getArchive({ path: containerPath });
      // Create directory for the host path if it doesn't exist
      const hostDir = path.dirname(hostPath);

      if (!fs.existsSync(hostDir)) {
        fs.mkdirSync(hostDir, { recursive: true });
      }

      // Use a fixed archive name under a temp dir so host filenames with spaces never break shell tools
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-cp-'));
      const tempTarPath = path.join(workDir, 'archive.tar');
      const extractDir = path.join(workDir, 'extract');
      const writeStream = fs.createWriteStream(tempTarPath);

      fs.mkdirSync(extractDir);
      tarStream.pipe(writeStream);

      // Wait for the tar file to be written
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        tarStream.on('error', reject);
      });

      // Extract the file from the tar archive
      // The tar archive from getArchive contains the file at the specified path
      // We need to extract it to the host path
      try {
        // Quote paths for shell: unquoted paths with spaces (e.g. "sdf f.txt.tar") make tar fail
        const quoteShell = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
        const extractCommand = `tar -xf ${quoteShell(tempTarPath)} -C ${quoteShell(extractDir)} 2>&1`;
        const { stderr: extractStderr } = await execAsync(extractCommand);

        // Check for extraction errors
        if (extractStderr && !extractStderr.includes('Removing leading')) {
          this.logger.warn(`Tar extraction warnings: ${extractStderr}`);
        }

        // Walk extractDir in Node so spaced filenames do not break `find`
        const extractedFilePath = this.findFirstFileRecursive(extractDir);

        if (!extractedFilePath || !fs.existsSync(extractedFilePath)) {
          // Try alternative: the file might be at the root of extractDir if path was stripped
          const fileName = path.basename(containerPath);
          const alternativePath = path.join(extractDir, fileName);

          if (fs.existsSync(alternativePath)) {
            fs.copyFileSync(alternativePath, hostPath);
          } else {
            throw new NotFoundException(`File not found in container: ${containerPath}`);
          }
        } else {
          // Copy the extracted file to the final host path
          fs.copyFileSync(extractedFilePath, hostPath);
        }

        // Clean up work directory (archive + extract tree)
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch (extractError: unknown) {
        // Clean up work directory on error
        if (fs.existsSync(workDir)) {
          try {
            fs.rmSync(workDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }

        const err = extractError as { message?: string; code?: string };

        if (err.code === 'ENOENT' || err.message?.includes('No such file') || err.message?.includes('not found')) {
          throw new NotFoundException(`File not found in container: ${containerPath}`);
        }

        throw extractError;
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error copying file from container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Resolve an HTTP base URL for a container TCP port.
   *
   * Order of preference:
   * 1. IP on `AGENT_DOCKER_NETWORK` (manager and workers share this bridge)
   * 2. Published host port via `DOCKER_HOST_GATEWAY` / loopback (local/dev without shared network)
   * 3. Any attached Docker network IP
   * 4. Legacy top-level bridge IP
   *
   * Preferring the agent network first avoids picking a secondary Docker network IP that the
   * manager cannot route to after `createNetwork` attaches the worker to a second network.
   */
  async resolveContainerHttpBaseUrl(containerId: string, containerPort: number, depth = 0): Promise<string> {
    const container = this.docker.getContainer(containerId);
    let inspectInfo: Docker.ContainerInspectInfo;

    try {
      inspectInfo = await container.inspect();
    } catch (error: unknown) {
      const err = error as { statusCode?: number };

      if (err.statusCode === 404) {
        throw new NotFoundException(`Container with ID '${containerId}' not found`);
      }

      throw error;
    }

    // Agents behind an egress guard share the guard's network namespace: their listeners are
    // reachable on the guard's IP / published ports.
    const networkMode = inspectInfo.HostConfig?.NetworkMode ?? '';

    if (networkMode.startsWith('container:') && depth === 0) {
      return await this.resolveContainerHttpBaseUrl(networkMode.slice('container:'.length), containerPort, depth + 1);
    }

    const networks = inspectInfo.NetworkSettings?.Networks || {};
    const preferredNetwork = process.env.AGENT_DOCKER_NETWORK?.trim();

    if (preferredNetwork) {
      const preferredIp = networks[preferredNetwork]?.IPAddress;

      if (preferredIp) {
        return `http://${preferredIp}:${containerPort}`;
      }
    }

    const portKey = `${containerPort}/tcp`;
    const bindings = inspectInfo.NetworkSettings?.Ports?.[portKey];
    const hostPort = bindings?.[0]?.HostPort;
    const gatewayHost = process.env.DOCKER_HOST_GATEWAY || '127.0.0.1';

    if (hostPort) {
      return `http://${gatewayHost}:${hostPort}`;
    }

    for (const network of Object.values(networks)) {
      const ip = network?.IPAddress;

      if (ip) {
        return `http://${ip}:${containerPort}`;
      }
    }

    const bridgeIp = inspectInfo.NetworkSettings?.IPAddress;

    if (bridgeIp) {
      return `http://${bridgeIp}:${containerPort}`;
    }

    throw new Error(`Unable to resolve HTTP endpoint for container ${containerId} port ${containerPort}`);
  }

  /**
   * Get container run status (whether it is started or stopped).
   * @param containerId - The container ID
   * @returns Object with running boolean
   * @throws NotFoundException if container is not found
   */
  async getContainerStatus(containerId: string): Promise<{ running: boolean }> {
    try {
      const container = this.docker.getContainer(containerId);
      let inspectInfo: Docker.ContainerInspectInfo;

      try {
        inspectInfo = await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      const running = inspectInfo.State?.Running ?? false;

      return { running };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error getting container status: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get container statistics (CPU, memory, network, etc.).
   * Returns a single snapshot of current container stats.
   * @param containerId - The container ID
   * @returns Container stats object
   * @throws NotFoundException if container is not found
   */
  async getContainerStats(containerId: string): Promise<Docker.ContainerStats> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Get stats (stream: false to get a single snapshot)
      // dockerode's stats() with stream: false uses callback pattern
      const stats = await new Promise<Docker.ContainerStats>((resolve, reject) => {
        container.stats({ stream: false }, (err: unknown, statsData: Docker.ContainerStats) => {
          if (err) {
            reject(err);
          } else {
            resolve(statsData);
          }
        });
      });

      return stats;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error getting container stats: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Ensure a Docker image exists locally. Pulls only when the image is missing.
   * Does not refresh an existing tag from the registry (avoids clobbering local rebuilds).
   * @param onProgress - Optional callback receiving the overall pull fraction (0..1) derived from layer byte progress
   */
  async ensureImageExists(image: string, onProgress?: (fraction: number) => void): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();

      return;
    } catch (error: unknown) {
      const err = error as { statusCode?: number };

      if (err.statusCode !== 404) {
        throw error;
      }
    }

    this.logger.log(`Pulling missing Docker image ${image}`);

    await new Promise<void>((resolve, reject) => {
      this.docker.pull(image, (pullErr: unknown, stream: NodeJS.ReadableStream) => {
        if (pullErr) {
          reject(pullErr);

          return;
        }

        type FollowProgress = (
          s: NodeJS.ReadableStream,
          cb: (err?: unknown) => void,
          onEvent?: (event: DockerPullProgressEvent) => void,
        ) => void;
        const modem: { followProgress: FollowProgress } = (
          this.docker as unknown as {
            modem: { followProgress: FollowProgress };
          }
        ).modem;
        const tracker = onProgress ? new DockerPullProgressAggregator() : null;

        modem.followProgress(
          stream,
          (followErr?: unknown) => (followErr ? reject(followErr) : resolve()),
          tracker && onProgress
            ? (event: DockerPullProgressEvent) => {
                const fraction = tracker.apply(event);

                if (fraction !== null) {
                  try {
                    onProgress(fraction);
                  } catch {
                    // Progress reporting must never break the pull
                  }
                }
              }
            : undefined,
        );
      });
    });
  }

  /**
   * Create and start an egress guard sidecar. The guard owns the agent's network namespace, so it is
   * attached to the agent network (or publishes the agent's ports on loopback when no network is set).
   * Only the guard receives CAP_NET_ADMIN; every other capability is dropped except those Squid /
   * dnsmasq need to drop privileges. IPv6 is disabled in the namespace (IPv4 is fully filtered).
   */
  async createEgressGuardContainer(options: {
    name: string;
    image: string;
    labels: Record<string, string>;
    network?: string;
    publishPorts?: readonly number[];
    memoryBytes?: number;
  }): Promise<string> {
    const { name, image, labels, network, publishPorts = [], memoryBytes } = options;

    await this.ensureImageExists(image);

    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, Array<{ HostPort?: string; HostIp?: string }>> = {};

    if (!network) {
      for (const port of publishPorts) {
        exposedPorts[`${port}/tcp`] = {};
        portBindings[`${port}/tcp`] = [{ HostIp: '127.0.0.1' }];
      }
    }

    const container = await this.docker.createContainer({
      name,
      Image: image,
      Tty: true,
      Labels: labels,
      ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined,
      HostConfig: {
        NetworkMode: network || undefined,
        PortBindings: Object.keys(portBindings).length ? portBindings : undefined,
        RestartPolicy: { Name: 'unless-stopped' },
        CapDrop: ['ALL'],
        // NET_RAW: iptables talks to the ipset subsystem (Git SSH sets) through a raw socket. The agent
        // sharing this namespace keeps NET_RAW dropped (capabilities are per process).
        CapAdd: [
          'NET_ADMIN',
          'NET_RAW',
          'NET_BIND_SERVICE',
          'SETUID',
          'SETGID',
          'CHOWN',
          'DAC_OVERRIDE',
          'FOWNER',
          'KILL',
        ],
        SecurityOpt: ['no-new-privileges'],
        Sysctls: {
          'net.ipv6.conf.all.disable_ipv6': '1',
          'net.ipv6.conf.default.disable_ipv6': '1',
        },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '2' } },
        ...(memoryBytes ? { Memory: memoryBytes } : {}),
        PidsLimit: 256,
      },
    });

    try {
      await container.start();
    } catch (error) {
      await container.remove({ force: true }).catch(() => undefined);

      throw error;
    }

    return container.id as unknown as string;
  }

  /** Upload flat files into an existing directory of a container (root-owned; permissions fixed by the caller). */
  async putFilesIntoContainer(
    containerId: string,
    targetDirectory: string,
    files: ReadonlyArray<{ name: string; content: string | Buffer; mode?: number }>,
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);

    await container.putArchive(
      buildFlatTar(
        files.map((file) => ({
          name: file.name,
          content: Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf-8'),
          mode: file.mode ?? 0o640,
        })),
      ),
      { path: targetDirectory },
    );
  }

  /**
   * Read a TTY container's logs since a UNIX timestamp (seconds), with Docker RFC 3339 nano timestamps.
   * Output is capped at `maxBytes` (newest content kept).
   */
  async getContainerLogsSince(containerId: string, sinceSeconds: number, maxBytes = 8 * 1024 * 1024): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const raw = (await container.logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      follow: false,
      since: Math.max(0, Math.floor(sinceSeconds)),
    })) as unknown as Buffer | string;
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf-8');
    if (buffer.length <= maxBytes) {
      return buffer.toString('utf-8');
    }

    // Keep the newest content and drop the partial first line of the truncated window.
    const tail = buffer.subarray(buffer.length - maxBytes).toString('utf-8');
    const firstNewline = tail.indexOf('\n');

    return firstNewline === -1 ? '' : tail.slice(firstNewline + 1);
  }

  /**
   * Rename a container unless it already has the name. Returns `conflict` when another container
   * holds the name and `missing` when the container does not exist (both leave everything unchanged).
   */
  async renameContainerIfNeeded(
    containerId: string,
    name: string,
  ): Promise<'renamed' | 'unchanged' | 'conflict' | 'missing'> {
    const container = this.docker.getContainer(containerId);
    let currentName: string;

    try {
      currentName = ((await container.inspect()).Name ?? '').replace(/^\//, '');
    } catch (error: unknown) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return 'missing';
      }

      throw error;
    }

    if (currentName === name) {
      return 'unchanged';
    }

    try {
      await container.rename({ name });

      return 'renamed';
    } catch (error: unknown) {
      if ((error as { statusCode?: number }).statusCode === 409) {
        return 'conflict';
      }

      throw error;
    }
  }

  /** Lightweight inspect (null when the container does not exist). */
  async inspectContainerSummary(containerId: string): Promise<{
    id: string;
    running: boolean;
    startedAt: Date | null;
    networkMode: string | null;
    labels: Record<string, string>;
  } | null> {
    try {
      const info = await this.docker.getContainer(containerId).inspect();
      const startedAt = info.State?.StartedAt ? new Date(info.State.StartedAt) : null;

      return {
        id: info.Id,
        running: info.State?.Running === true,
        startedAt: startedAt && !Number.isNaN(startedAt.getTime()) && startedAt.getTime() > 0 ? startedAt : null,
        networkMode: info.HostConfig?.NetworkMode ?? null,
        labels: info.Config?.Labels ?? {},
      };
    } catch (error: unknown) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return null;
      }

      throw error;
    }
  }

  /** List containers (running or not) carrying a label. */
  async listContainersByLabel(
    label: string,
  ): Promise<Array<{ id: string; labels: Record<string, string>; createdAt: Date }>> {
    const containers = await this.docker.listContainers({ all: true, filters: { label: [label] } });

    return containers.map((summary) => ({
      id: summary.Id,
      labels: summary.Labels ?? {},
      createdAt: new Date((summary.Created ?? 0) * 1000),
    }));
  }

  /**
   * Docker daemon facts relevant for container isolation (registered runtimes, versions).
   */
  async getDockerHostInfo(): Promise<DockerHostInfo> {
    const info = (await this.docker.info()) as {
      ServerVersion?: string;
      KernelVersion?: string;
      DefaultRuntime?: string;
      Runtimes?: Record<string, { path?: string; runtimeType?: string } | null>;
    };
    const runtimes: Record<string, string | null> = {};

    for (const [name, definition] of Object.entries(info.Runtimes ?? {})) {
      runtimes[name] = definition?.path ?? definition?.runtimeType ?? null;
    }

    return {
      serverVersion: info.ServerVersion ?? null,
      kernelVersion: info.KernelVersion ?? null,
      defaultRuntime: info.DefaultRuntime ?? null,
      runtimes,
    };
  }

  /** Image id of a local image (`null` when it does not exist locally). */
  async getImageId(image: string): Promise<string | null> {
    try {
      const info = await this.docker.getImage(image).inspect();

      return info.Id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Exercise a Docker runtime with the worker image contract: start, runtime identity, non-root and
   * root exec with exit codes, file create / fsync / rename / readback on a volume, stdout/stderr
   * logs, SIGTERM stop and removal. Optionally joins a runc-owned network namespace the way agents
   * join their egress guard. Probe containers are always removed, also on failure or timeout.
   */
  async runIsolationProbe(options: IsolationProbeOptions): Promise<IsolationProbeResult> {
    const probeId = uuidv4().slice(0, 12);
    const created: string[] = [];
    const volumeName = `${ISOLATION_PROBE_NAME_PREFIX}${probeId}`;
    let volumeCreated = false;
    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    // Idempotent cleanup: runs when the probe settles (or times out) and again once a timed-out probe
    // run finally settles, so containers created after a timeout are removed as well.
    const cleanup = async (): Promise<void> => {
      for (const id of created.splice(0).reverse()) {
        await this.docker
          .getContainer(id)
          .remove({ force: true, v: true })
          .catch(() => undefined);
      }

      if (volumeCreated) {
        await this.docker
          .getVolume(volumeName)
          .remove({ force: true })
          .then(() => (volumeCreated = false))
          .catch(() => undefined);
      }
    };
    const track = (container: Docker.Container): void => {
      created.push(container.id as unknown as string);

      if (finished) {
        throw new Error('Isolation probe aborted');
      }
    };

    const run = async (): Promise<IsolationProbeResult> => {
      await this.docker.createVolume({ Name: volumeName, Labels: { [ISOLATION_PROBE_LABEL]: '1' } });
      volumeCreated = true;

      let container: Docker.Container;

      try {
        container = await this.createProbeContainer(options, `${volumeName}-main`, {
          Binds: [`${volumeName}:/probe`],
        });
        track(container);
        await container.start();
      } catch (error) {
        return this.probeFailure(IsolationReasonCode.PROBE_START_FAILED, 'Probe container failed to start', error);
      }

      const inspect = await container.inspect();
      const actualRuntime = (inspect.HostConfig as { Runtime?: string } | undefined)?.Runtime || 'runc';

      const expectedRuntime = options.expectedRuntime ?? options.runtime ?? 'runc';

      if (actualRuntime !== expectedRuntime || inspect.State?.Running !== true) {
        return {
          ok: false,
          reasonCode: IsolationReasonCode.PROBE_RUNTIME_MISMATCH,
          reason: `Probe container runs on '${actualRuntime}' instead of '${expectedRuntime}'`,
        };
      }

      const fileCheck = await this.execProbeCommand(
        container,
        'set -e; printf agenstra > /probe/probe.tmp; sync; mv /probe/probe.tmp /probe/probe.txt; test "$(cat /probe/probe.txt)" = agenstra; rm /probe/probe.txt',
      );

      if (fileCheck.exitCode !== 0) {
        return {
          ok: false,
          reasonCode: IsolationReasonCode.PROBE_FILESYSTEM_FAILED,
          reason: 'Volume file operations failed',
        };
      }

      const exitCodeCheck = await this.execProbeCommand(container, 'exit 7');
      const nonRootCheck = await this.execProbeCommand(container, 'id -u', '65534');

      if (exitCodeCheck.exitCode !== 7 || nonRootCheck.exitCode !== 0 || nonRootCheck.output.trim() !== '65534') {
        return {
          ok: false,
          reasonCode: IsolationReasonCode.PROBE_EXEC_FAILED,
          reason: 'Exec exit codes or non-root exec failed',
        };
      }

      const logs = await this.readProbeLogs(container);

      if (!logs.includes('agenstra-probe-stdout') || !logs.includes('agenstra-probe-stderr')) {
        return {
          ok: false,
          reasonCode: IsolationReasonCode.PROBE_LOGS_FAILED,
          reason: 'Container logs were not captured',
        };
      }

      const kernel = await this.execProbeCommand(container, 'dmesg 2>/dev/null | head -n 5 || true');

      await container.stop({ t: 5 });

      if (options.sharedNetworkNamespace) {
        const namespaceResult = await this.probeSharedNetworkNamespace(options, volumeName, track);

        if (!namespaceResult.ok) {
          return namespaceResult;
        }
      }

      return { ok: true, gvisorKernelDetected: /gvisor/i.test(kernel.output) };
    };

    try {
      // Pulling a large worker image must not count against the probe timeout.
      await this.ensureImageExists(options.image);
    } catch (error) {
      return this.probeFailure(IsolationReasonCode.PROBE_IMAGE_UNAVAILABLE, 'Probe image is not available', error);
    }

    const running = run();

    // A timed-out run keeps going until its current Docker call returns: clean up again afterwards.
    void running.catch(() => undefined).finally(() => (finished ? cleanup() : undefined));

    try {
      return await Promise.race([
        running,
        new Promise<IsolationProbeResult>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                ok: false,
                reasonCode: IsolationReasonCode.PROBE_TIMEOUT,
                reason: `Probe did not finish within ${options.timeoutMs} ms`,
              }),
            options.timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } catch (error) {
      return this.probeFailure(IsolationReasonCode.PROBE_START_FAILED, 'Runtime probe failed', error);
    } finally {
      finished = true;

      if (timer) {
        clearTimeout(timer);
      }

      await cleanup();
    }
  }

  /** Remove probe containers / volumes left behind by an interrupted manager process. */
  async removeStaleIsolationProbes(): Promise<number> {
    let removed = 0;
    const containers = await this.docker.listContainers({ all: true, filters: { label: [ISOLATION_PROBE_LABEL] } });

    for (const summary of containers) {
      await this.docker
        .getContainer(summary.Id)
        .remove({ force: true, v: true })
        .then(() => (removed += 1))
        .catch(() => undefined);
    }

    const volumes = await this.docker.listVolumes({ filters: { label: [ISOLATION_PROBE_LABEL] } }).catch(() => null);

    for (const volume of volumes?.Volumes ?? []) {
      await this.docker
        .getVolume(volume.Name)
        .remove({ force: true })
        .catch(() => undefined);
    }

    return removed;
  }

  private async createProbeContainer(
    options: IsolationProbeOptions,
    name: string,
    hostConfig: Docker.HostConfig,
    runtime: string | null | undefined = options.runtime,
    cmd: string[] = [
      'echo agenstra-probe-stdout; echo agenstra-probe-stderr 1>&2; trap "exit 0" TERM INT; while :; do sleep 1; done',
    ],
  ): Promise<Docker.Container> {
    return this.docker.createContainer({
      Image: options.image,
      name,
      Labels: { [ISOLATION_PROBE_LABEL]: '1' },
      Entrypoint: ['/bin/sh', '-c'],
      Cmd: cmd,
      Tty: false,
      HostConfig: {
        AutoRemove: false,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        PidsLimit: 128,
        Memory: 256 * 1024 * 1024,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '1m', 'max-file': '1' } },
        ...hostConfig,
        ...(runtime ? { Runtime: runtime } : {}),
      },
    });
  }

  /**
   * Agents behind an egress guard join the guard's network namespace and reach its proxy on the
   * namespace's loopback. Verify the shared-namespace sandbox runtime can do exactly that: the owner
   * (Docker's default runtime, like the guard) serves on 127.0.0.1 and keeps its interface address
   * while the sandboxed member runs (gVisor's Netstack would take the interfaces over instead).
   */
  private async probeSharedNetworkNamespace(
    options: IsolationProbeOptions,
    volumeName: string,
    track: (container: Docker.Container) => void,
  ): Promise<IsolationProbeResult> {
    const sharedRuntime = options.sharedNetworkNamespaceRuntime ?? options.runtime;

    try {
      // Like the guard, the owner joins the agent network when one is configured.
      const ownerNetwork = process.env.AGENT_DOCKER_NETWORK?.trim();
      const owner = await this.createProbeContainer(
        options,
        `${volumeName}-netns-owner`,
        ownerNetwork ? { NetworkMode: ownerNetwork } : {},
        null,
        [
          'mkdir -p /tmp/agenstra-probe && echo agenstra-netns-ok > /tmp/agenstra-probe/index.html && ' +
            'exec python3 -m http.server 18765 --bind 127.0.0.1 --directory /tmp/agenstra-probe',
        ],
      );

      track(owner);
      await owner.start();

      const member = await this.createProbeContainer(
        options,
        `${volumeName}-netns-member`,
        { NetworkMode: `container:${owner.id as unknown as string}` },
        sharedRuntime,
      );

      track(member);
      await member.start();

      // Workers attached directly to the agent network resolve names via Docker's embedded DNS.
      if (ownerNetwork) {
        const networkMember = await this.createProbeContainer(
          options,
          `${volumeName}-net-member`,
          { NetworkMode: ownerNetwork },
          sharedRuntime,
        );

        track(networkMember);
        await networkMember.start();

        const resolved = await this.execProbeCommand(
          networkMember,
          `python3 -c "import socket; socket.gethostbyname('${volumeName}-netns-owner')"`,
        );

        if (resolved.exitCode !== 0) {
          return {
            ok: false,
            reasonCode: IsolationReasonCode.SHARED_NETNS_FAILED,
            reason: `Sandboxed workers cannot resolve names on the agent network '${ownerNetwork}'`,
          };
        }

        await networkMember.stop({ t: 5 });
      }

      const fetchScript =
        'for i in 1 2 3 4 5 6 7 8 9 10; do ' +
        'python3 -c "import urllib.request,sys; sys.stdout.write(urllib.request.urlopen(\'http://127.0.0.1:18765/\', timeout=3).read().decode())" ' +
        '2>/dev/null && exit 0; sleep 1; done; exit 1';
      const fetched = await this.execProbeCommand(member, fetchScript);
      // The owner must keep a non-loopback interface (Netstack would take it over).
      const ownerRoutes = await this.execProbeCommand(owner, 'awk \'NR>1 && $1!="lo"\' /proc/net/route | grep -q .');

      if (fetched.exitCode !== 0 || !fetched.output.includes('agenstra-netns-ok') || ownerRoutes.exitCode !== 0) {
        return {
          ok: false,
          reasonCode: IsolationReasonCode.SHARED_NETNS_FAILED,
          reason: 'Sandboxed workers cannot use the egress guard network namespace (loopback proxy or interfaces)',
        };
      }

      await member.stop({ t: 5 });
      await owner.stop({ t: 5 });

      return { ok: true };
    } catch (error) {
      return this.probeFailure(
        IsolationReasonCode.SHARED_NETNS_FAILED,
        'Runtime could not join a shared network namespace',
        error,
      );
    }
  }

  private async execProbeCommand(
    container: Docker.Container,
    script: string,
    user?: string,
  ): Promise<{ exitCode: number | null; output: string }> {
    const execInstance = await container.exec({
      Cmd: ['/bin/sh', '-c', script],
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      ...(user ? { User: user } : {}),
    });
    const stream = (await execInstance.start({ hijack: true, stdin: false, Tty: true })) as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve) => {
      stream.on('data', (chunk: Buffer | string) => {
        if (chunks.reduce((total, c) => total + c.length, 0) < 64 * 1024) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', () => resolve());
    });

    const info = await this.inspectExecUntilExited(execInstance);

    return { exitCode: info.ExitCode ?? null, output: Buffer.concat(chunks).toString('utf-8') };
  }

  private async readProbeLogs(container: Docker.Container): Promise<string> {
    const raw = (await container.logs({ stdout: true, stderr: true, follow: false })) as unknown as Buffer | string;

    return (Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf-8')).toString('utf-8');
  }

  private probeFailure(reasonCode: IsolationReasonCode, reason: string, error: unknown): IsolationProbeResult {
    const message = (error as { message?: string })?.message;

    this.logger.warn(`${reason}: ${message ?? 'unknown error'}`);

    return { ok: false, reasonCode, reason };
  }

  /**
   * Return the first regular file under dir (depth-first). Avoids shell `find` so spaced names work.
   */
  private findFirstFileRecursive(dir: string): string | null {
    if (!fs.existsSync(dir)) {
      return null;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile()) {
        return fullPath;
      }

      if (entry.isDirectory()) {
        const nested = this.findFirstFileRecursive(fullPath);

        if (nested) {
          return nested;
        }
      }
    }

    return null;
  }
}
