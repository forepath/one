import { chown, mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type RegistryClient,
  workloadIsolationLevel,
  type WorkloadSpec,
  type WorkloadStatus,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { PRIVATE_REGISTRY_HOST } from '@forepath/loadweaver/shared/util-model';
import { cidrContainsIp, parseCidr, parseIp } from '@forepath/loadweaver/shared/util-network';
import { MICROVM_VMM_UID } from '@forepath/shared/backend/util-microvm-bridge';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';
import { IsolationProbeService } from '../host/isolation-probe.service';
import { isProbeContainer } from '../host/managed-containers';
import { MigrationSessions } from '../migration/migration-sessions';
import { KeptAddressPlugin } from '../network/kept-address.plugin';
import { POD_NETWORK } from '../network/pod-network.manager';
import { GuestNetwork, guestNetConfig, guestNics, networkMtu, usesTapNetworking } from '../microvm/guest-network';
import { GuestVolumes } from '../microvm/guest-volumes';
import { bundledMigrationSupported } from '../microvm/microvm-migration';
import { guestLayers, RootfsCache } from '../microvm/rootfs-cache';
import { RESTORED_LABEL, RestoredRuntime } from './restored-runtime';
import {
  bootProcess,
  containerName,
  containerOptions,
  guestVolumeList,
  guestVolumesCmdline,
  type GuestVolume,
  MANAGED_LABEL,
  launcherKindOf,
  microvmKind,
  MICROVM_MIGRATION_SUBDIR,
  microvmRunDir,
  microvmVolumesDir,
  type MicrovmHostSide,
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
/** Reconnect delay of the Docker event stream (launcher starts → guest networking). */
const EVENTS_RETRY_MS = 5_000;

/**
 * Block devices of a full VM's disks in `vm.disks` order (`/dev/drbd<minor>`, promoted on this node), provided by the
 * node's VM support (3.35, M7.3); without it the agent refuses full VMs.
 */
export const VM_BLOCK_DEVICES = Symbol('VM_BLOCK_DEVICES');
export type VmBlockDevices = (spec: WorkloadSpec) => Promise<string[]>;
/** Writes a full VM's `vm.json` (and `seed/`) into its run directory (node's VM support, 3.35). */
export const VM_LAUNCH_FILES = Symbol('VM_LAUNCH_FILES');
export type VmLaunchFiles = (spec: WorkloadSpec, runDir: string, devices: string[]) => Promise<void>;
/**
 * Background work of full VMs outside the reconcile (boot disk imports, F3b): told the desired workloads of every
 * apply (jobs of replicas / disks no longer here are cancelled), and it tells when a job settled (a deferred launcher
 * can start now: the workloads are re-applied).
 */
export const VM_DISK_JOBS = Symbol('VM_DISK_JOBS');
export interface VmDiskJobs {
  desired(workloads: WorkloadSpec[]): void;
  onSettled(listener: () => void): void;
}

/**
 * Thrown by a launcher hook when a replica can't start yet (its boot disk is being written by a background job):
 * the reconcile skips the replica and goes on with the others; the job's settling re-applies.
 */
export class WorkloadDeferred extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkloadDeferred';
  }
}

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
  /** Docker `start` events of launcher containers (each start has a fresh network namespace: taps again). */
  private events: NodeJS.ReadableStream | null = null;
  private eventsRetry: NodeJS.Timeout | null = null;
  private destroyed = false;
  /** Generic microVMs created as a live migration's target: their volumes arrive with the hand-over (M7 W10b). */
  private readonly incoming = new Set<string>();

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly secrets: SecretBroker,
    private readonly scanner: ImageScanner,
    @Optional() private readonly sessions?: MigrationSessions,
    @Optional() private readonly restored?: RestoredRuntime,
    @Optional() private readonly kept?: KeptAddressPlugin,
    @Optional() private readonly rootfs?: RootfsCache,
    @Optional() private readonly guestNetwork?: GuestNetwork,
    @Optional() @Inject(VM_BLOCK_DEVICES) private readonly vmBlockDevices?: VmBlockDevices,
    @Optional() @Inject(VM_LAUNCH_FILES) private readonly vmLaunchFiles?: VmLaunchFiles,
    @Optional() private readonly isolation?: IsolationProbeService,
    @Optional() @Inject(VM_DISK_JOBS) private readonly vmDiskJobs?: VmDiskJobs,
    @Optional() private readonly guestVolumes?: GuestVolumes,
  ) {
    this.vmDiskJobs?.onSettled(() => {
      if (this.destroyed) return;

      void this.reapply().catch((error: unknown) =>
        this.logger.warn(`Re-applying workloads failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    });
  }

  onModuleDestroy(): void {
    if (this.restoredWatch) clearInterval(this.restoredWatch);

    this.restoredWatch = null;
    this.destroyed = true;
    this.stopEvents();
  }

  private stopEvents(): void {
    if (this.eventsRetry) clearTimeout(this.eventsRetry);

    this.eventsRetry = null;
    (this.events as (NodeJS.ReadableStream & { destroy?: () => void }) | null)?.destroy?.();
    this.events = null;
  }

  /** A microVM is about to be created as a live migration's target (its volumes are mounted later). */
  expectIncoming(id: string): void {
    this.incoming.add(id);
  }

  incomingDone(id: string): void {
    this.incoming.delete(id);
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

    if (!(await this.policyAllows(spec, image, registry))) return null;

    const kept = spec.hostRoutes?.length ? spec.addresses : keptAddressesOf(spec.addresses, await this.podSubnets());
    const network = kept.length > 0 && this.kept ? await this.kept.ensureNetwork(spec.addresses) : undefined;
    const microvm = microvmKind(spec)
      ? await this.prepareMicrovm(spec, network ?? POD_NETWORK, registry, image)
      : undefined;
    const secretFiles = await this.writeSecrets(spec);

    return containerOptions(
      { ...spec, image },
      { dnsServers, secretFiles, ...(network ? { network } : {}), ...(microvm ? { microvm } : {}) },
    );
  }

  /**
   * The node side of a launcher workload (3.35), before every start (idempotent): a generic microVM's image layers
   * unpacked and its guest root mounted, the run directory (`boot-process.json`, `net.json`, `stats/` writable by the
   * VMM user); a full VM's block devices and `vm.json` / `seed/` from the node's VM support; a bundled image whose
   * launcher migrates live its migration directory and volumes ({@link prepareBundled}). After a reboot the run
   * directory (tmpfs) and the overlay are gone and are recreated here. `image`: the pulled (routed) image reference.
   */
  async prepareMicrovm(
    spec: WorkloadSpec,
    network: string,
    registry?: RegistryClient,
    image: string = spec.image,
  ): Promise<MicrovmHostSide> {
    const kind = microvmKind(spec);

    if (!kind) return {};

    if (kind === 'bundled') return this.prepareBundled(spec, image);

    const runDir = microvmRunDir(runtimeDir(), spec.id);

    await mkdir(runDir, { recursive: true, mode: 0o711 });
    await mkdir(join(runDir, 'stats'), { recursive: true, mode: 0o755 });
    // The launcher daemon (VMM user, no capabilities) writes the guest stats.
    await chown(join(runDir, 'stats'), MICROVM_VMM_UID, MICROVM_VMM_UID);

    if (kind === 'vm') {
      // Live migration (M7.4): the incoming marker / relay socket; root-owned, the VMM user only traverses it.
      await mkdir(join(runDir, MICROVM_MIGRATION_SUBDIR), { recursive: true, mode: 0o711 });

      if (!this.vmBlockDevices || !this.vmLaunchFiles)
        throw new Error(`${spec.id}: full VMs are not supported by this node agent yet`);

      const blockDevices = await this.vmBlockDevices(spec);

      await this.vmLaunchFiles(spec, runDir, blockDevices);

      return { runDir, blockDevices };
    }

    const microvm = spec.microvm;

    const layers = microvm ? guestLayers(microvm) : [];

    if (!this.rootfs || !microvm?.guestImage || !layers.length)
      throw new Error(`${spec.id}: generic microVMs need the guest image, its layers and the node's unpack cache`);

    await this.rootfs.ensureLayers(microvm.guestImage, layers, registry);

    const merged = await this.rootfs.mountReplica(spec.id, layers, microvm.rootfsBytes);
    const [nic] = guestNics(spec);

    // Live migration (M7 W10b): the incoming marker and the source's relay socket.
    await mkdir(join(runDir, MICROVM_MIGRATION_SUBDIR), { recursive: true, mode: 0o711 });

    // Filesystem volumes: mounted by the agent below a shared directory (`/lwvol` in the launcher); a migration
    // target gets them with the hand-over during the freeze, the source still holds them.
    const volumes = guestVolumeList(spec);
    let volumesDir: string | undefined;

    if (volumes.length > 0) {
      if (!this.guestVolumes) throw new Error(`${spec.id}: this node agent can't mount microVM volumes`);

      volumesDir = microvmVolumesDir(runtimeDir(), spec.id);
      await this.guestVolumes.prepareDir(volumesDir, volumes);

      if (!this.incoming.has(spec.id)) for (const volume of volumes) await this.guestVolumes.attach(volumesDir, volume);
    }

    await writeFile(join(runDir, 'volumes.cmdline'), guestVolumesCmdline(volumes), { mode: 0o644 });
    await writeFile(join(runDir, 'volumes.json'), JSON.stringify(volumes), { mode: 0o600 });

    // The workload process may carry configuration values: root only (the launcher reads it as root).
    await writeFile(join(runDir, 'boot-process.json'), JSON.stringify(bootProcess(spec)), { mode: 0o600 });
    await writeFile(
      join(runDir, 'net.json'),
      JSON.stringify(guestNetConfig(nic, await networkMtu(this.docker, network))),
      { mode: 0o644 },
    );

    return { runDir, merged, ...(volumesDir ? { volumesDir } : {}) };
  }

  /**
   * Bundled images (M7 F5): when the image's launcher migrates live (label `io.forepath.microvm.migration` lists
   * `bundled`), the launcher runs in migration mode — the run directory's `migration/` (incoming marker, relay socket)
   * and the filesystem volumes mounted by the agent below a shared directory, each bound `rslave` at its target below
   * `/guest`, so a migration can hand them over (a target gets them during the freeze). Older bundled images run as
   * before (Docker volume mounts, no migration mode); as a migration target they are refused.
   */
  private async prepareBundled(spec: WorkloadSpec, image: string): Promise<MicrovmHostSide> {
    const labels = await this.docker
      .getImage(image)
      .inspect()
      .then((info) => info.Config?.Labels ?? {})
      .catch(() => ({}) as Record<string, string>);

    if (!bundledMigrationSupported(labels)) {
      if (this.incoming.has(spec.id))
        throw new Error(`${spec.id}: the bundled image's launcher has no live migration (no incoming mode)`);

      return {};
    }

    const runDir = microvmRunDir(runtimeDir(), spec.id);

    await mkdir(join(runDir, MICROVM_MIGRATION_SUBDIR), { recursive: true, mode: 0o711 });

    const volumes = guestVolumeList(spec);
    let volumesDir: string | undefined;

    if (volumes.length > 0) {
      if (!this.guestVolumes) throw new Error(`${spec.id}: this node agent can't mount microVM volumes`);

      volumesDir = microvmVolumesDir(runtimeDir(), spec.id);
      await this.guestVolumes.prepareDir(volumesDir, volumes);

      if (!this.incoming.has(spec.id)) for (const volume of volumes) await this.guestVolumes.attach(volumesDir, volume);
    }

    await writeFile(join(runDir, 'volumes.json'), JSON.stringify(volumes), { mode: 0o600 });

    return { runDir, bundledMigration: true, ...(volumesDir ? { volumesDir } : {}) };
  }

  /**
   * Further NICs of a full VM (3.35): one more container interface each, on a kept-address network of its own
   * (routed /32 + /128 with the link-local gateways, per-veth anti-spoofing), connected before the start.
   */
  private async connectExtraNics(containerId: string, spec: WorkloadSpec): Promise<void> {
    for (const nic of guestNics(spec).filter((n) => n.index > 0)) {
      if (!this.kept) throw new Error(`${spec.id}: further VM NICs need the kept-address network plugin`);

      const name = await this.kept.ensureNetwork(nic.addresses, nic.index);
      const v4 = nic.addresses.find((a) => !a.includes(':'));
      const v6 = nic.addresses.find((a) => a.includes(':'));

      await this.docker.getNetwork(name).connect({
        Container: containerId,
        EndpointConfig: { IPAMConfig: { ...(v4 ? { IPv4Address: v4 } : {}), ...(v6 ? { IPv6Address: v6 } : {}) } },
      });
    }
  }

  /**
   * Taps and tc redirects of a started launcher (3.35). Failures are logged: the launcher gives up after 30 s
   * (`E_MICROVM_NET`) and Docker's restart policy starts it again, in a fresh namespace.
   */
  private async attachGuestNetwork(containerId: string, spec: WorkloadSpec): Promise<void> {
    if (!usesTapNetworking(spec) || !this.guestNetwork) return;

    this.watchStarts();

    try {
      await this.guestNetwork.attach(containerId, spec);
    } catch (error) {
      this.logger.warn(
        `Guest network of ${spec.id} not connected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Follows Docker `start` events of launcher containers (restarts by Docker's restart policy). */
  watchStarts(): void {
    if (this.events || this.eventsRetry || this.destroyed || !this.guestNetwork) return;

    const retry = () => {
      this.events = null;

      if (this.destroyed || this.eventsRetry) return;

      this.eventsRetry = setTimeout(() => {
        this.eventsRetry = null;
        this.watchStarts();
      }, EVENTS_RETRY_MS);
      this.eventsRetry.unref?.();
    };

    this.docker
      // Every start (Docker ANDs label filters; launchers carry one of two labels): filtered by the spec below.
      .getEvents({ filters: { type: ['container'], event: ['start'] } })
      .then((stream) => {
        if (this.destroyed) return (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();

        this.events = stream;

        let buffer = '';

        stream.on('data', (chunk: Buffer | string) => {
          buffer += chunk.toString();

          const lines = buffer.split('\n');

          buffer = lines.pop() ?? '';

          for (const line of lines.filter((l) => l.trim())) void this.onStartEvent(line);
        });
        stream.on('error', retry);
        stream.on('end', retry);
      })
      .catch(retry);
  }

  private async onStartEvent(line: string): Promise<void> {
    try {
      const event = JSON.parse(line) as { id?: string; Actor?: { ID?: string; Attributes?: Record<string, string> } };
      const id = event.Actor?.ID ?? event.id;
      const spec = this.specOf(event.Actor?.Attributes?.[WORKLOAD_LABEL] ?? '');

      if (id && spec && usesTapNetworking(spec)) await this.attachGuestNetwork(id, spec);
    } catch {
      // not an event line
    }
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
      .filter((c) => c.Labels?.[MANAGED_LABEL] !== 'true' && !isProbeContainer(c.Labels))
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

    // Background VM jobs of replicas / disks that are no longer here are cancelled.
    this.vmDiskJobs?.desired(workloads);
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

      try {
        if (current && current.Labels[WORKLOAD_HASH_LABEL] === spec.specHash) {
          // Jobs run once per spec; services are kept running by Docker's restart policy.
          if (spec.kind === 'service' && current.State !== 'running' && spec.restart !== 'no') {
            // Launchers: guest root and run directory again (gone after a reboot) before the start.
            if (microvmKind(spec)) await this.prepareMicrovm(spec, this.networkOf(current), registry, current.Image);

            await this.docker.getContainer(current.Id).start();
            await this.attachGuestNetwork(current.Id, spec);
            changed = true;
          } else if (current.State === 'running') {
            // Idempotent: a start the event stream missed (agent restart) still gets its taps.
            await this.attachGuestNetwork(current.Id, spec);
          }

          continue;
        }

        await this.create(spec, dnsServers, registry, current?.Id);
        changed = true;
      } catch (error) {
        // Not startable yet (a VM's boot disk import runs in the background): the other replicas go on.
        if (!(error instanceof WorkloadDeferred)) throw error;
      }
    }

    // Running images are rescanned daily (3.22); generic microVMs: the guest image (what policies judge).
    this.scanner.track(
      (await this.managed()).flatMap((c) => {
        const spec = workloads.find((w) => w.id === c.Labels[WORKLOAD_LABEL]);
        const guest = spec?.microvm?.mode === 'generic' ? spec.microvm.guestImage : undefined;
        const digest = spec ? /@(sha256:[0-9a-f]{64})$/.exec(guest ?? spec.image)?.[1] : undefined;
        const image = guest ? routedImage(guest, registry) : c.Image;

        return digest && image ? [{ image, digest }] : [];
      }),
    );

    // The unpack cache keeps the desired layers; everything else is collected LRU when over its cap.
    if (this.rootfs) {
      this.rootfs.setDesired(
        workloads.flatMap((w) => {
          try {
            return w.microvm ? guestLayers(w.microvm) : [];
          } catch {
            return [];
          }
        }),
      );
      void this.rootfs
        .gc()
        .catch((error: unknown) =>
          this.logger.warn(`Unpack cache GC failed: ${error instanceof Error ? error.message : String(error)}`),
        );
    }

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

    if (!(await this.policyAllows(spec, image, registry))) return;

    if (replaces) await this.remove(replaces, spec.id);

    const level = workloadIsolationLevel(spec);
    let container: Docker.Container;

    try {
      const options = await this.createOptions(spec, dnsServers, registry);

      if (!options) return;

      container = await this.docker.createContainer(options);

      // Interfaces before the start: Docker sets up the namespace with all of them.
      if (spec.vm) await this.connectExtraNics(container.id, spec);

      await container.start();
    } catch (error) {
      // Three failures in a row on a level re-probe it (3.1): a broken runtime drops out of the capabilities.
      if (!(error instanceof WorkloadDeferred)) this.isolation?.recordStartFailure(level);

      throw error;
    }

    this.isolation?.recordStartSuccess(level);
    await this.attachGuestNetwork(container.id, spec);
    this.logger.log(`Started ${spec.id} (${containerName(spec.id)})`);
  }

  /** The Docker network a replica container is attached to (pod bridge or kept-address network). */
  private networkOf(container: Docker.ContainerInfo): string {
    return Object.keys(container.NetworkSettings?.Networks ?? {})[0] ?? POD_NETWORK;
  }

  /**
   * Image policy subject (3.35): a generic microVM's guest image (pulled through the cluster for the scan; the
   * launcher image itself is the platform's), else the container image. Bundled images and the launcher carry
   * `io.forepath.scan.nested-rootfs`, which the scanner follows.
   */
  private async policyAllows(spec: WorkloadSpec, image: string, registry?: RegistryClient): Promise<boolean> {
    const guest = spec.microvm?.mode === 'generic' ? spec.microvm.guestImage : undefined;

    if (!guest) return await this.allowedByPolicy(spec, image, spec.image);

    return await this.allowedByPolicy(spec, await this.pullThroughCluster(guest, registry), guest);
  }

  /**
   * Image policies (3.22): with vulnerability limits, the pulled image is scanned first; `enforce` keeps a violating
   * (or unscannable) image from starting, `monitor` only logs. Without limits the scan runs in the background, for the
   * report.
   */
  private async allowedByPolicy(spec: WorkloadSpec, image: string, reference: string): Promise<boolean> {
    const digest = /@(sha256:[0-9a-f]{64})$/.exec(reference)?.[1];

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
          ? `image ${reference} could not be scanned`
          : blocked > 0
            ? `image ${reference} has ${blocked} ${rule.block.join(' / ').toLowerCase()} vulnerabilities`
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

    // Launchers: the writable layer is discarded with the replica (a recreate starts from the image), not on restart.
    const kind = launcherKindOf(info?.Config.Labels);

    if (kind === 'generic' || kind === 'bundled') {
      // Volumes first (unmounted and demoted, as the volume plugin did at the container's end), then the guest root
      // (generic). Bundled images in migration mode keep their volume list too (none otherwise).
      const runDir = microvmRunDir(runtimeDir(), workloadId);
      const volumes = await readFile(join(runDir, 'volumes.json'), 'utf8')
        .then((raw) => JSON.parse(raw) as GuestVolume[])
        .catch(() => [] as GuestVolume[]);

      if (volumes.length > 0) await this.guestVolumes?.release(microvmVolumesDir(runtimeDir(), workloadId), volumes);

      if (kind === 'generic') await this.rootfs?.release(workloadId);
    }

    if (kind) await rm(microvmRunDir(runtimeDir(), workloadId), { recursive: true, force: true });

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
