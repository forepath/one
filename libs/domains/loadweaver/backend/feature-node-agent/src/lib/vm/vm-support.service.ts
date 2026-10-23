import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  agentMessage,
  VM_POWER_ACTIONS,
  vmImageImportSchema,
  vmPowerSchema,
  type AgentEvent,
  type Envelope,
  type WorkloadSpec,
  type WorkloadStatus,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { parseVmLaunchConfig, type VmLaunchConfig } from '@forepath/shared/backend/util-microvm-bridge';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';
import { MigrationSessions } from '../migration/migration-sessions';
import { launcherImage } from '../host/isolation-probe.service';
import { MANAGED_LABEL } from '../host/managed-containers';
import { VM_LABEL } from '../live/guest-target';
import { guestNics, networkMtu } from '../microvm/guest-network';
import { POD_NETWORK } from '../network/pod-network.manager';
import { routedImage } from '../registry/image-routing';
import { RegistryRouter } from '../registry/registry-router';
import { blockDevicePath, VolumeManager } from '../volumes/volume.manager';
import { WORKLOAD_LABEL } from '../workloads/workload-container';
import type { VmDiskJobs } from '../workloads/workload.manager';
import { BootDiskImports, type BootDiskImportEvent } from './boot-disk-imports';
import { CloudInitSeed } from './cloud-init-seed';
import { VmImageImporter } from './vm-image-import';
import { vmDiskPrefix, VmPower } from './vm-power';

export type VmMessageType = 'vmPower' | 'vmImageImport';

/** A VM's disks stay primary this long after they were promoted for a start, whatever destroy events say. */
const RECREATE_GRACE_MS = 120_000;

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

/**
 * `vm.json` of a full VM (the launcher's contract, validated with the launcher's own parser): disks in `vm.disks`
 * order with their DRBD devices, one tap per NIC (`lwtap<n>`, the taps the node agent creates in the launcher's
 * network namespace), the qemu-guest-agent channel always present (harmless without an agent in the guest; backups
 * fall back to crash-consistent snapshots then).
 */
export function vmLaunchConfig(spec: Pick<WorkloadSpec, 'id' | 'addresses' | 'vm'>, devices: string[]): VmLaunchConfig {
  const vm = spec.vm;

  if (!vm) throw new Error(`${spec.id} is no virtual machine`);

  if (devices.length !== vm.disks.length)
    throw new Error(`${spec.id}: ${devices.length} block devices for ${vm.disks.length} disks`);

  const nics = guestNics(spec);

  return parseVmLaunchConfig({
    uid: vm.uid,
    firmware: vm.firmware,
    cpuModel: vm.cpuModel,
    vcpus: vm.vcpus,
    memoryMiB: vm.memoryMiB,
    graphics: vm.graphics,
    guestAgent: true,
    disks: vm.disks.map((disk, i) => ({ name: disk.name, device: devices[i], cache: disk.cache, boot: disk.boot })),
    nics: vm.nics.map((nic, i) => ({ name: nic.name, mac: nic.mac, tap: nics[i].tap })),
  });
}

/**
 * The node side of full VMs (3.35, M7.3), behind the workload manager's launcher hooks (`VM_BLOCK_DEVICES`,
 * `VM_LAUNCH_FILES`, `VM_DISK_JOBS`): before every start the VM's disks are promoted here (the boot disk written from
 * its image first, once, by a background job — the launcher is deferred until it is done), `vm.json` and the
 * cloud-init seed go into the launcher's run directory; removed launchers demote their disks. It also carries out
 * `vmPower` / `vmImageImport` and adds the guests' power state and import progress to the workload status.
 */
@Injectable()
export class VmSupport implements OnModuleDestroy, VmDiskJobs {
  private readonly logger = new Logger(VmSupport.name);
  /** Replicas whose disks are being promoted right now (a destroy event must not demote them meanwhile). */
  private readonly preparing = new Set<string>();
  /** First imports of boot disks, in the background (F3b). */
  readonly imports: BootDiskImports;
  /** When a replica's disks were last promoted for a start (a recreate's destroy event must not demote them). */
  private readonly prepared = new Map<string, number>();
  /**
   * Replicas this node receives by QEMU live migration (M7.4): their launcher starts in incoming mode on disks the
   * migration promotes itself (dual-primary window), never initialized from the image.
   */
  private readonly incoming = new Set<string>();
  private events: NodeJS.ReadableStream | null = null;
  private send: ((envelope: Envelope) => unknown) | null = null;

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly volumes: VolumeManager,
    private readonly importer: VmImageImporter,
    private readonly seed: CloudInitSeed,
    private readonly power: VmPower,
    @Optional() private readonly router?: RegistryRouter,
    @Optional() private readonly sessions?: MigrationSessions,
  ) {
    this.imports = new BootDiskImports(importer, volumes, (event: BootDiskImportEvent) =>
      this.event(event.level, event.message, event.labels),
    );
  }

  /** The desired workloads of an apply: imports of replicas / disks that left the node are cancelled. */
  desired(workloads: WorkloadSpec[]): void {
    this.imports.desired(workloads);
  }

  /** A boot disk import settled: the workload manager re-applies (the launcher starts or the failure shows). */
  onSettled(listener: () => void): void {
    this.imports.onSettled(listener);
  }

  /** A live migration target prepares this replica's launcher (incoming mode, M7.4). */
  expectIncoming(replica: string): void {
    this.incoming.add(replica);
  }

  /** The migration ended (committed or aborted): the next start is an ordinary one. */
  incomingDone(replica: string): void {
    this.incoming.delete(replica);
  }

  attach(send: (envelope: Envelope) => unknown): void {
    this.send = send;
  }

  onModuleDestroy(): void {
    (this.events as (NodeJS.ReadableStream & { destroy?: () => void }) | null)?.destroy?.();
    this.events = null;
  }

  /**
   * The DRBD devices of a VM's disks in `vm.disks` order, promoted on this node (the control plane placed the VM with
   * its disks' primaries). The boot disk comes first: when it never held data its image is written by a background
   * job and `WorkloadDeferred` is thrown (the reconcile goes on; the job's end re-applies).
   */
  async blockDevices(spec: WorkloadSpec): Promise<string[]> {
    const vm = spec.vm;

    if (!vm) throw new Error(`${spec.id} is no virtual machine`);

    for (const disk of vm.disks) {
      const volume = this.volumes.assignment(disk.volume);

      if (!volume) throw new Error(`${spec.id}: disk ${disk.name} (${disk.volume}) has no replica on this node`);

      if (volume.mode !== 'block') throw new Error(`${spec.id}: disk ${disk.name} (${disk.volume}) is no block volume`);
    }

    // Incoming live migration: the disks hold the running guest's data; the migration promotes them (dual-primary).
    if (this.incoming.has(spec.id))
      return vm.disks.map((disk) => blockDevicePath(this.volumes.assignment(disk.volume) as { minor: number }));

    this.preparing.add(spec.id);

    try {
      const devices = new Map<string, string>();
      const launcher = routedImage(spec.image, this.router?.registryClient ?? undefined);

      // The boot disk first: while its image is written nothing else is promoted.
      for (const disk of vm.disks.filter((d) => d.boot))
        devices.set(
          disk.name,
          await this.imports.ensure({ replica: spec.id, specHash: spec.specHash }, disk.volume, vm.image, launcher),
        );

      for (const disk of vm.disks.filter((d) => !d.boot))
        devices.set(disk.name, (await this.volumes.promoteBlock(disk.volume)).device);

      this.prepared.set(spec.id, Date.now());

      return vm.disks.map((disk) => devices.get(disk.name) as string);
    } finally {
      this.preparing.delete(spec.id);
    }
  }

  /** `vm.json` and the cloud-init seed in the launcher's run directory (tmpfs), before every start. */
  async launchFiles(spec: WorkloadSpec, runDir: string, devices: string[]): Promise<void> {
    const config = vmLaunchConfig(spec, devices);

    await writeFile(join(runDir, 'vm.json'), JSON.stringify(config), { mode: 0o600 });
    await this.seed.write(spec, runDir, {
      dnsServers: await this.podGateways(),
      mtu: await networkMtu(this.docker, POD_NETWORK),
    });
  }

  /** The node-local resolvers (the pod bridge's gateways), which `${LW_DNS}` in a VM's network config becomes. */
  private async podGateways(): Promise<string[]> {
    const info = (await this.docker
      .getNetwork(POD_NETWORK)
      .inspect()
      .catch(() => null)) as { IPAM?: { Config?: { Gateway?: string }[] } } | null;

    return (info?.IPAM?.Config ?? []).map((c) => c.Gateway).filter((g): g is string => !!g);
  }

  /** Follows removed VM launchers (agent start): their disks are demoted, so another node can promote them. */
  async watch(): Promise<void> {
    if (this.events) return;

    try {
      this.events = await this.docker.getEvents({
        filters: { type: ['container'], event: ['destroy'], label: [`${MANAGED_LABEL}=true`, VM_LABEL] },
      });
      createInterface({ input: this.events }).on('line', (line) => {
        try {
          const event = JSON.parse(line) as { Actor?: { Attributes?: Record<string, string> } };
          const replica = event.Actor?.Attributes?.[WORKLOAD_LABEL];

          if (replica) void this.released(replica);
        } catch {
          // not an event line
        }
      });
    } catch (error) {
      this.logger.warn(`Docker events for VM disks: ${messageOf(error)}`);
    }
  }

  /**
   * A VM's launcher is gone: its disks go back to secondary (still held open → retried by the volume reconcile).
   * Skipped while the replica migrates (M7.4).
   */
  async released(replica: string): Promise<void> {
    const prefix = vmDiskPrefix(replica);

    if (!prefix || this.preparing.has(replica)) return;

    // Its boot disk is being written (no launcher yet): the import job holds the disk.
    if (this.imports.holds(replica)) return;

    // A live migration's source or target (M7.4): its commit / abort decides about the disks, never a destroy event.
    if (this.sessions?.activeReplicas().has(replica)) return;

    // A recreate (new spec): the old launcher's destroy event can arrive after the new one's disks were promoted.
    if (Date.now() - (this.prepared.get(replica) ?? 0) < RECREATE_GRACE_MS) return;

    const present = await this.docker
      .listContainers({ all: true, filters: { label: [`${MANAGED_LABEL}=true`, `${WORKLOAD_LABEL}=${replica}`] } })
      .catch(() => [] as Docker.ContainerInfo[]);

    if (present.length) return;

    this.prepared.delete(replica);

    for (const volume of this.volumes.blockAssignments().filter((v) => v.id.startsWith(prefix))) {
      await this.volumes
        .demoteBlock(volume.id)
        .catch((error: unknown) => this.logger.warn(`Demoting VM disk ${volume.id}: ${messageOf(error)}`));
    }
  }

  /**
   * Adds the VM view to the workload status: the guest power state of running launchers, and replicas whose boot
   * disk is being written from the image (`pending`, `vm.importing` + progress) or whose import failed (`failed`
   * until the retry) — instead of a stopped launcher's entry, or added when there is no container.
   */
  async annotate(status: WorkloadStatus): Promise<WorkloadStatus> {
    const running = await this.docker
      .listContainers({ filters: { label: [`${MANAGED_LABEL}=true`, VM_LABEL], status: ['running'] } })
      .catch(() => [] as Docker.ContainerInfo[]);
    const launchers = new Map(running.map((c) => [c.Labels?.[WORKLOAD_LABEL], c.Id]));
    const workloads: WorkloadStatus['workloads'] = [];

    for (const entry of status.workloads) {
      const id = launchers.get(entry.id);

      workloads.push(id ? { ...entry, vm: { power: await this.power.state(id) } } : entry);
    }

    for (const job of this.imports.reportable()) {
      if (launchers.has(job.replica)) continue;

      const failed = job.phase === 'failed';
      const entry: WorkloadStatus['workloads'][number] = {
        id: job.replica,
        specHash: job.specHash,
        state: failed ? 'failed' : 'pending',
        message: this.imports.describe(job).slice(0, 2048),
        vm: { importing: !failed, importProgress: BootDiskImports.progress(job) },
      };
      const index = workloads.findIndex((w) => w.id === job.replica);

      if (index >= 0) workloads[index] = entry;
      else workloads.push(entry);
    }

    return { workloads };
  }

  /** `vmPower` / `vmImageImport` from the control plane; the outcome is reported as an event. */
  async handle(type: VmMessageType, payload: unknown): Promise<void> {
    try {
      if (type === 'vmPower') {
        const message = vmPowerSchema.parse(payload);

        await this.power.power(message);
        this.event(
          'info',
          `virtual machine ${message.replica}: ${message.action}`,
          { replica: message.replica, action: message.action, result: 'done' },
          { type, action: message.action },
        );

        return;
      }

      const message = vmImageImportSchema.parse(payload);
      const command = { type, importId: message.import };

      this.event(
        'info',
        `re-imaging ${message.volume} from ${message.image.ref}`,
        { import: message.import, replica: message.replica, result: 'running' },
        command,
      );
      await this.reimage(message.replica, message.volume, message.image);
      this.event(
        'info',
        `${message.volume} re-imaged from ${message.image.ref}`,
        { import: message.import, replica: message.replica, result: 'done' },
        command,
      );
    } catch (error) {
      const raw = payload as { replica?: unknown; import?: unknown; action?: unknown } | null;
      const replica = typeof raw?.replica === 'string' ? raw.replica.slice(0, 256) : undefined;
      const importId =
        type === 'vmImageImport' && typeof raw?.import === 'string' ? raw.import.slice(0, 64) : undefined;
      // Only a known action is named (an invalid one is the failure's reason).
      const action =
        type === 'vmPower' &&
        typeof raw?.action === 'string' &&
        (VM_POWER_ACTIONS as readonly string[]).includes(raw.action)
          ? raw.action
          : undefined;

      this.logger.warn(`${type} failed: ${messageOf(error)}`);
      this.event(
        'error',
        `${type} failed: ${messageOf(error)}`,
        {
          ...(replica ? { replica } : {}),
          ...(importId ? { import: importId } : {}),
          ...(action ? { action } : {}),
          result: 'failed',
        },
        { type, ...(action ? { action } : {}), ...(importId ? { importId } : {}) },
      );
    }
  }

  private async reimage(
    replica: string,
    volumeId: string,
    image: Parameters<VmImageImporter['reimage']>[1],
  ): Promise<void> {
    const prefix = vmDiskPrefix(replica);

    if (!prefix || !volumeId.startsWith(prefix)) throw new Error(`volume ${volumeId} is no disk of ${replica}`);

    if (await this.power.launcherOf(replica)) throw new Error(`stop virtual machine ${replica} before re-imaging it`);

    if (this.imports.active(volumeId))
      throw new Error(`the first import of ${volumeId} is still running; re-image it once it finished`);

    const launcher = launcherImage();

    if (!launcher) throw new Error('this release pins no microVM launcher image');

    await this.importer.reimage(volumeId, image, routedImage(launcher, this.router?.registryClient ?? undefined));
  }

  private event(
    level: AgentEvent['level'],
    message: string,
    labels: Record<string, string>,
    vmCommand?: AgentEvent['vmCommand'],
  ): void {
    this.send?.(
      agentMessage('event', {
        source: 'storage',
        level,
        message: message.slice(0, 8192),
        at: new Date().toISOString(),
        labels: { kind: 'virtual-machine', ...labels },
        ...(vmCommand ? { vmCommand } : {}),
      }),
    );
  }
}
