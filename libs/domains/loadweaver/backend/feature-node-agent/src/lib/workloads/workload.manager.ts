import { mkdir, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RegistryClient, WorkloadSpec, WorkloadStatus } from '@forepath/loadweaver/shared/util-agent-protocol';
import { PRIVATE_REGISTRY_HOST } from '@forepath/loadweaver/shared/util-model';
import { cidrContainsIp, parseCidr, parseIp } from '@forepath/loadweaver/shared/util-network';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';
import { MigrationSessions } from '../migration/migration-sessions';
import { KeptAddressPlugin } from '../network/kept-address.plugin';
import { POD_NETWORK } from '../network/pod-network.manager';
import { RESTORED_LABEL, RestoredRuntime } from './restored-runtime';
import {
  containerName,
  containerOptions,
  MANAGED_LABEL,
  secretDir,
  WORKLOAD_HASH_LABEL,
  WORKLOAD_LABEL,
  workloadState,
} from './workload-container';
import { SecretBroker } from './secret-broker.service';
import { routedImage } from '../registry/image-routing';
import { blockedBy, ImageScanner } from '../images/image-scanner';

/** `statfs` type of tmpfs; secret files are only ever written there (3.22). */
const TMPFS_MAGIC = 0x01021994;

export function runtimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_RUNTIME_DIR'] || '/run/loadweaver';
}

/** Addresses outside this node's pod subnets: kept from another node by a live migration (3.10). */
export function keptAddressesOf(addresses: readonly string[], podSubnets: readonly string[]): string[] {
  return addresses.filter((address) => {
    const ip = parseIp(address);

    return !podSubnets.some((subnet) => {
      const cidr = parseCidr(subnet);

      return !!ip && !!cidr && cidrContainsIp(cidr, ip);
    });
  });
}

/** How often restored replicas (agent-managed, 3.10) are checked for an exited process. */
const RESTORED_WATCH_MS = 5_000;

/**
 * Runs the node's workloads through the Docker API (3.11): one container per replica, re-created when its spec
 * hash changes, removed when it is no longer desired. Containers Loadweaver didn't create are never touched.
 */
/** Docker sockets a workload binds to control the node's Docker (an acknowledged pin, 3.12). */
const DOCKER_SOCKETS = ['/var/run/docker.sock', '/run/docker.sock'];
/** Label prefixes of containers a Docker-socket workload starts itself (comma-separated), e.g. `io.agenstra.`. */
export const DELEGATES_LABEL = 'loadweaver.com/delegates';

@Injectable()
export class WorkloadManager implements OnModuleDestroy {
  private readonly logger = new Logger(WorkloadManager.name);

  /** Workloads an image policy kept from starting, reported as failed. */
  private readonly blocked = new Map<string, { message: string; specHash: string }>();
  /** The last applied desired workloads (live migration looks specs up; restored replicas re-apply). */
  private last: { workloads: WorkloadSpec[]; dnsServers: string[]; registry?: RegistryClient } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private restoredWatch: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly secrets: SecretBroker,
    private readonly scanner: ImageScanner,
    @Optional() private readonly sessions?: MigrationSessions,
    @Optional() private readonly restored?: RestoredRuntime,
    @Optional() private readonly kept?: KeptAddressPlugin,
  ) {}

  onModuleDestroy(): void {
    if (this.restoredWatch) clearInterval(this.restoredWatch);

    this.restoredWatch = null;
  }

  /** The desired spec of a replica on this node (last applied state). */
  specOf(id: string): WorkloadSpec | undefined {
    return this.last?.workloads.find((w) => w.id === id);
  }

  /** The node-local resolvers workloads use (last applied state). */
  dnsServers(): string[] {
    return this.last?.dnsServers ?? [];
  }

  /** The managed container of a replica, if any. */
  async containerOf(id: string): Promise<Docker.ContainerInfo | undefined> {
    return (await this.managed()).find((c) => c.Labels[WORKLOAD_LABEL] === id);
  }

  /** Removes a replica's container (restored replicas: process tree + placeholder). */
  async removeContainer(containerId: string, workloadId: string): Promise<void> {
    await this.remove(containerId, workloadId);
  }

  async killContainer(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).kill();
  }

  async startContainer(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).start();
  }

  /** Creates and starts a replica through Docker as usual, outside a reconcile (a source resuming cold, 3.10). */
  async createReplica(spec: WorkloadSpec): Promise<void> {
    await this.create(spec, this.dnsServers(), this.last?.registry);
  }

  /** This node's pod subnets (the pod bridge's IPAM). */
  async podSubnets(): Promise<string[]> {
    const network = (await this.docker.listNetworks({ filters: { name: [POD_NETWORK] } })).find(
      (n) => n.Name === POD_NETWORK,
    );

    return (network?.IPAM?.Config ?? []).map((c) => c.Subnet).filter((s): s is string => !!s);
  }

  /**
   * Docker create options of a replica as this node runs it: the image (pulled through the cluster), secrets on
   * tmpfs, and the pod bridge or — for an address kept from another node's subnet (3.10) — a kept-address network.
   * Returns null when an image policy blocks the image.
   */
  async createOptions(
    spec: WorkloadSpec,
    dnsServers: string[],
    registry?: RegistryClient,
  ): Promise<Docker.ContainerCreateOptions | null> {
    const image = await this.pullThroughCluster(spec.image, registry);

    if (!(await this.allowedByPolicy(spec, image))) return null;

    const kept = spec.hostRoutes?.length ? spec.addresses : keptAddressesOf(spec.addresses, await this.podSubnets());
    const network = kept.length > 0 && this.kept ? await this.kept.ensureNetwork(spec.addresses) : undefined;
    const secretFiles = await this.writeSecrets(spec);

    return containerOptions({ ...spec, image }, { dnsServers, secretFiles, ...(network ? { network } : {}) });
  }

  /**
   * Containers without the Loadweaver label (3.8 drift): reported to the control plane, never touched. Those a
   * workload with the node's Docker socket started (a container carrying a label prefix the workload declares in
   * `loadweaver.com/delegates`, e.g. Agenstra's agent manager and `io.agenstra.`) are reported as delegated to it.
   */
  async foreign(): Promise<
    { id: string; name: string; image: string; state: string; ports: string[]; delegatedTo?: string }[]
  > {
    const all = await this.docker.listContainers({ all: true });
    const delegators = all
      .filter(
        (c) =>
          c.Labels?.[MANAGED_LABEL] === 'true' &&
          !!c.Labels?.[WORKLOAD_LABEL] &&
          (c.Mounts ?? []).some((m) => DOCKER_SOCKETS.includes(m.Source)),
      )
      .map((c) => ({
        replica: c.Labels[WORKLOAD_LABEL],
        prefixes: (c.Labels[DELEGATES_LABEL] ?? '')
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length >= 3),
      }));
    const delegatedTo = (labels: Record<string, string> | undefined) =>
      delegators.find((d) => Object.keys(labels ?? {}).some((key) => d.prefixes.some((p) => key.startsWith(p))))
        ?.replica;

    return all
      .filter((c) => c.Labels?.[MANAGED_LABEL] !== 'true')
      .slice(0, 200)
      .map((c) => ({
        ...(delegatedTo(c.Labels) ? { delegatedTo: (delegatedTo(c.Labels) as string).slice(0, 256) } : {}),
        id: c.Id.slice(0, 64),
        name: (c.Names?.[0] ?? '').replace(/^\//, '').slice(0, 128),
        image: (c.Image ?? '').slice(0, 512),
        state: (c.State ?? 'unknown').slice(0, 32),
        ports: (c.Ports ?? [])
          .filter((p) => p.PublicPort)
          .slice(0, 64)
          .map((p) => `${p.IP ?? ''}:${p.PublicPort}->${p.PrivatePort}/${p.Type}`.slice(0, 64)),
      }));
  }

  private async managed(): Promise<Docker.ContainerInfo[]> {
    return await this.docker.listContainers({
      all: true,
      filters: { label: [`${MANAGED_LABEL}=true`, WORKLOAD_LABEL] },
    });
  }

  /** Applies the desired workloads; returns true if anything changed. Applies are serialized. */
  apply(workloads: WorkloadSpec[], dnsServers: string[], registry?: RegistryClient): Promise<boolean> {
    const run = this.chain.then(() => this.applyNow(workloads, dnsServers, registry));

    this.chain = run.catch(() => undefined);

    return run;
  }

  /** Re-applies the last desired workloads (a restored replica's process ended: back to Docker). */
  async reapply(): Promise<boolean> {
    return this.last ? await this.apply(this.last.workloads, this.last.dnsServers, this.last.registry) : false;
  }

  private async applyNow(workloads: WorkloadSpec[], dnsServers: string[], registry?: RegistryClient): Promise<boolean> {
    this.last = { workloads, dnsServers, registry };

    const existing = await this.managed();
    const desired = new Map(workloads.map((w) => [w.id, w]));
    // Live migration (3.10): replicas under a session (frozen source, restored target) are never touched here.
    const untouchable = this.sessions?.protectedReplicas() ?? new Set<string>();
    const restoredProcesses = existing.some((c) => c.Labels[RESTORED_LABEL])
      ? ((await this.restored?.list()) ?? new Map<string, boolean>())
      : new Map<string, boolean>();

    for (const id of [...this.blocked.keys()]) if (!desired.has(id)) this.blocked.delete(id);
    let changed = false;

    for (const container of existing) {
      const id = container.Labels[WORKLOAD_LABEL];

      if (untouchable.has(id)) continue;

      if (!desired.has(id)) {
        this.blocked.delete(id);
        await this.remove(container.Id, id);
        changed = true;
      }
    }

    for (const spec of workloads) {
      if (this.sessions?.activeReplicas().has(spec.id)) continue;

      // A restored replica reached its desired state: the normal reconcile owns it from here.
      this.sessions?.adopted(spec.id);

      const current = existing.find((c) => c.Labels[WORKLOAD_LABEL] === spec.id);

      if (current?.Labels[RESTORED_LABEL] && current.Labels[WORKLOAD_HASH_LABEL] === spec.specHash) {
        // Agent-managed until its next restart (3.10): adopted while the restored process runs, else back to Docker.
        if (restoredProcesses.get(RestoredRuntime.runcName(current.Id))) {
          this.watchRestored();
          continue;
        }

        this.logger.log(`Restored replica ${spec.id} ended: back to Docker`);
        await this.remove(current.Id, spec.id);
        await this.create(spec, dnsServers, registry);
        changed = true;
        continue;
      }

      if (current && current.Labels[WORKLOAD_HASH_LABEL] === spec.specHash) {
        // Jobs run once per spec; services are kept running by Docker's restart policy.
        if (spec.kind === 'service' && current.State !== 'running' && spec.restart !== 'no') {
          await this.docker.getContainer(current.Id).start();
          changed = true;
        }

        continue;
      }

      await this.create(spec, dnsServers, registry, current?.Id);
      changed = true;
    }

    // Running images are rescanned daily (3.22).
    this.scanner.track(
      (await this.managed()).flatMap((c) => {
        const spec = workloads.find((w) => w.id === c.Labels[WORKLOAD_LABEL]);
        const digest = spec ? /@(sha256:[0-9a-f]{64})$/.exec(spec.image)?.[1] : undefined;

        return digest && c.Image ? [{ image: c.Image, digest }] : [];
      }),
    );

    return changed;
  }

  /** Pulls and checks the new image first: a blocked update keeps the running version instead of an outage. */
  private async create(
    spec: WorkloadSpec,
    dnsServers: string[],
    registry?: RegistryClient,
    replaces?: string,
  ): Promise<void> {
    const image = await this.pullThroughCluster(spec.image, registry);

    if (!(await this.allowedByPolicy(spec, image))) return;

    if (replaces) await this.remove(replaces, spec.id);

    const options = await this.createOptions(spec, dnsServers, registry);

    if (!options) return;

    const container = await this.docker.createContainer(options);

    await container.start();
    this.logger.log(`Started ${spec.id} (${containerName(spec.id)})`);
  }

  /**
   * Image policies (3.22): with vulnerability limits, the pulled image is scanned first; `enforce` keeps a violating
   * (or unscannable) image from starting, `monitor` only logs. Without limits the scan runs in the background, for the
   * report.
   */
  private async allowedByPolicy(spec: WorkloadSpec, image: string): Promise<boolean> {
    const digest = /@(sha256:[0-9a-f]{64})$/.exec(spec.image)?.[1];

    this.blocked.delete(spec.id);

    if (!digest) return true;

    if (!spec.imagePolicy) {
      void this.scanner.scan(image, digest).catch(() => undefined);

      return true;
    }

    const scan = await this.scanner.scan(image, digest).catch(() => null);
    // Each policy on its own: monitor rules only log, any violated enforce rule blocks.
    const violations = spec.imagePolicy.flatMap((rule) => {
      const blocked = scan ? blockedBy(scan, rule) : null;
      const reason =
        blocked === null
          ? `image ${spec.image} could not be scanned`
          : blocked > 0
            ? `image ${spec.image} has ${blocked} ${rule.block.join(' / ').toLowerCase()} vulnerabilities`
            : null;

      return reason ? [{ mode: rule.mode, reason }] : [];
    });

    for (const v of violations.filter((v) => v.mode === 'monitor'))
      this.logger.warn(`${spec.id}: ${v.reason} (image policy, monitor)`);

    const enforced = violations.find((v) => v.mode === 'enforce');

    if (!enforced) return true;

    this.logger.warn(`${spec.id}: not started, ${enforced.reason} (image policy)`);
    this.blocked.set(spec.id, { message: `blocked by image policy: ${enforced.reason}`, specHash: spec.specHash });

    return false;
  }

  private async writeSecrets(spec: WorkloadSpec): Promise<{ source: string; target: string }[]> {
    if (spec.secrets.length === 0) return [];

    const dir = secretDir(runtimeDir(), spec.id);

    await mkdir(dir, { recursive: true, mode: 0o700 });

    const fs = await statfs(dir);

    if (Number(fs.type) !== TMPFS_MAGIC) throw new Error(`refusing to write secrets: ${dir} is not on tmpfs`);

    const files: { source: string; target: string }[] = [];

    for (const [index, secret] of spec.secrets.entries()) {
      const value = await this.secrets.fetch(spec.id, secret.ref);
      const source = join(dir, String(index));

      await writeFile(source, value, { mode: secret.mode ?? 0o444 });
      value.fill(0);
      files.push({ source, target: secret.target });
    }

    return files;
  }

  /** Watches restored replicas: when a restored process exits, the replica goes back to Docker (3.10). */
  watchRestored(): void {
    if (this.restoredWatch || !this.restored) return;

    this.restoredWatch = setInterval(() => void this.checkRestored(), RESTORED_WATCH_MS);
    this.restoredWatch.unref?.();
  }

  private async checkRestored(): Promise<void> {
    const holders = (await this.managed().catch(() => [])).filter((c) => c.Labels[RESTORED_LABEL]);

    if (holders.length === 0) {
      this.onModuleDestroy();

      return;
    }

    const processes = (await this.restored?.list()) ?? new Map<string, boolean>();
    const untouchable = this.sessions?.protectedReplicas() ?? new Set<string>();

    if (
      holders.some((h) => !untouchable.has(h.Labels[WORKLOAD_LABEL]) && !processes.get(RestoredRuntime.runcName(h.Id)))
    )
      await this.reapply().catch((error: unknown) =>
        this.logger.warn(`Re-applying workloads failed: ${error instanceof Error ? error.message : String(error)}`),
      );
  }

  private async remove(containerId: string, workloadId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const info = await container.inspect().catch(() => null);

    // A restored replica: its process tree first (runc), then the placeholder container.
    if (info?.Config.Labels?.[RESTORED_LABEL] && this.restored) {
      const config = info.Config as { StopSignal?: string; StopTimeout?: number };

      await this.restored.stopReplica(info.Id, config.StopSignal ?? 'SIGTERM', (config.StopTimeout ?? 10) * 1000);
      await rm(secretDir(runtimeDir(), workloadId), { recursive: true, force: true });
      this.logger.log(`Removed restored ${workloadId}`);

      return;
    }

    try {
      await container.stop();
    } catch {
      // already stopped
    }

    await container.remove({ force: true });
    await rm(secretDir(runtimeDir(), workloadId), { recursive: true, force: true });
    this.logger.log(`Removed ${workloadId}`);
  }

  /**
   * Pulls through the built-in registry (3.22). If the cluster registry can't deliver a public image, the node pulls
   * it from upstream directly; private images only exist in the cluster.
   */
  private async pullThroughCluster(image: string, registry?: RegistryClient): Promise<string> {
    const routed = routedImage(image, registry);

    if (routed === image) {
      await this.pull(image);

      return image;
    }

    try {
      await this.pull(routed);

      return routed;
    } catch (error) {
      if (image.startsWith(`${PRIVATE_REGISTRY_HOST}/`)) throw error;

      this.logger.warn(
        `Cluster registry could not deliver ${image}, pulling from upstream: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.pull(image);

      return image;
    }
  }

  private async pull(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();

      return;
    } catch {
      // not present yet
    }

    const stream = await this.docker.pull(image);

    await new Promise<void>((resolve, reject) =>
      this.docker.modem.followProgress(stream, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  }

  /** Current state of every managed workload, reported to the control plane. */
  async status(): Promise<WorkloadStatus> {
    const result: WorkloadStatus['workloads'] = [];

    const managed = await this.managed();
    const processes = managed.some((c) => c.Labels[RESTORED_LABEL])
      ? ((await this.restored?.list()) ?? new Map<string, boolean>())
      : new Map<string, boolean>();

    for (const container of managed) {
      try {
        const info = await this.docker.getContainer(container.Id).inspect();
        const restoredEnded =
          !!container.Labels[RESTORED_LABEL] &&
          info.State.Running &&
          !processes.get(RestoredRuntime.runcName(container.Id));
        // Restored gVisor replicas: the agent's own health check (Docker's would probe the placeholder).
        const restoredHealth =
          container.Labels[RESTORED_LABEL] && info.State.Running
            ? this.restored?.healthOf(container.Id, container.Labels)
            : undefined;
        const state: ReturnType<typeof workloadState> & { message?: string } = restoredEnded
          ? { state: 'failed', message: 'restored process exited (the replica goes back to Docker)' }
          : restoredHealth
            ? { state: restoredHealth }
            : workloadState(info);

        result.push({
          id: container.Labels[WORKLOAD_LABEL],
          specHash: container.Labels[WORKLOAD_HASH_LABEL] ?? '',
          ...state,
        });
      } catch (error) {
        result.push({
          id: container.Labels[WORKLOAD_LABEL],
          specHash: '',
          state: 'failed',
          message: error instanceof Error ? error.message.slice(0, 500) : 'inspect failed',
        });
      }
    }

    for (const [id, blocked] of this.blocked) {
      const running = result.find((w) => w.id === id);

      // A blocked update keeps the old version running: it reports why the new one didn't start.
      if (running) running.message = blocked.message;
      else result.push({ id, specHash: blocked.specHash, state: 'failed', message: blocked.message });
    }

    return { workloads: result };
  }
}
