import { randomUUID } from 'node:crypto';

import type { RequestWithUser } from '@forepath/identity/backend';
import { controlPlaneMessage, messageAllowed } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  parseVmQuantity,
  virtualMachineSpecSchema,
  vmBootDisk,
  vmDiskVolumeId,
  vmReplicaId,
  VM_DEPLOYMENT_NAME,
  type VirtualMachineSpec,
} from '@forepath/loadweaver/shared/util-model';
import { getQueueRole, shouldRunApiHttp } from '@forepath/shared/backend';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, LessThan, Like, Not } from 'typeorm';

import { atLeast, canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import { projectUsage, quotaIssues } from '../access/plan-access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { placeScaleUp } from '../autoscaling/autoscale.utils';
import { BackupEntity } from '../backups/backup.entities';
import { BackupsService } from '../backups/backups.service';
import { ADVISORY_LOCK_PLACEMENT_ALLOCATION } from '../constants/control-plane.constants';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import {
  VmCommandEntity,
  VmPowerEntity,
  VmSnapshotEntity,
  type VmCommandType,
  type VmPowerState,
} from '../entities/virtual-machine.entities';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { serviceId, toSchedulerNodes, toSchedulerServices } from '../utils/workload-planning.utils';
import { addressFamiliesOf } from '../utils/vm-planning.utils';
import { loadVmOperationalState } from '../utils/vm-power.utils';
import {
  vmActionRefusal,
  vmAvailableActions,
  vmConsoles,
  vmDiskStatus,
  vmNicStatus,
  vmPhase,
  vmReport,
  vmShouldRun,
  vmSnapshotConsistency,
  vmSnapshotStatus,
  type VmAction,
  type VmConsoleAvailability,
  type VmDiskStatus,
  type VmNicStatus,
  type VmPhase,
} from '../utils/vm-status.utils';
import { AuditLogService, actorFromRequest } from './audit-log.service';
import { NetworkStateService } from './network-state.service';
import { kvmOptOutNodes, plannerNodes, WorkloadPlannerService } from './workload-planner.service';

const DISPATCH_MS = 5_000;
/** A command no replica could send (node offline) fails after this long. */
const COMMAND_TIMEOUT_MS = 2 * 60_000;
const RECENT_COMMANDS = 10;

export interface VirtualMachineSummaryDto {
  project: string;
  name: string;
  labels: Record<string, string>;
  description: string | null;
  image: string;
  /** The digest-pinned image of the last apply (null before it). */
  pinnedImage: string | null;
  runStrategy: VirtualMachineSpec['runStrategy'];
  /** Operational power (`Manual`), else what the run strategy implies. */
  power: VmPowerState;
  phase: VmPhase;
  node: string | null;
  vcpus: number;
  memoryBytes: number;
  diskBytes: number;
  disks: number;
  nics: number;
  addresses: string[];
  graphical: boolean;
  /** Invalid spec (the plan reports it): the VM is listed but has no status. */
  invalid?: string;
  /** The boot disk import's progress while the node reports one (F4: the list shows it). */
  importProgress?: { phase: string; bytes?: number; totalBytes?: number };
}

export interface VmCommandDto {
  id: string;
  type: VmCommandType;
  action: string;
  node: string;
  status: VmCommandEntity['status'];
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface VirtualMachineDto extends VirtualMachineSummaryDto {
  spec: VirtualMachineSpec | null;
  generation: number;
  updatedAt: string;
  status: {
    phase: VmPhase;
    node: string | null;
    /** The node's last report (`running`, `starting`, `exited`, ...). */
    state: string | null;
    /** Guest power from the launcher (`running`, `paused`, `shutting-down`, `shut-off`, `crashed`, ...). */
    guestPower: string | null;
    /** The boot disk is being written from its image. */
    importing: boolean;
    /** Progress of the boot disk import on the node (`queued` / `fetching` / `writing` / `failed`). */
    importProgress: { phase: string; bytes?: number; totalBytes?: number } | null;
    message: string | null;
    exitCode: number | null;
    reportedAt: string | null;
    /** When the node last reported the VM as running (approximates the last boot). */
    lastBoot: string | null;
    migration: { targetNode: string | null } | null;
  };
  power: VmPowerState;
  powerDetail: { graceful: boolean; changedBy: string | null; changedAt: string | null; instanceGeneration: number };
  nicStatus: VmNicStatus[];
  diskStatus: VmDiskStatus[];
  consoles: {
    replica: string;
    namespace: 'socket/consoles';
    serial: VmConsoleAvailability;
    vnc: VmConsoleAvailability;
  };
  /** What the VM's state and the caller's role allow. */
  actions: VmAction[];
  permissions: { power: boolean; snapshot: boolean; console: boolean; edit: boolean };
  commands: VmCommandDto[];
}

export interface VmSnapshotDto {
  id: string;
  project: string;
  name: string;
  description: string | null;
  consistency: 'crash' | 'application';
  status: 'running' | 'succeeded' | 'failed' | 'partial';
  createdBy: string | null;
  createdAt: string;
  disks: {
    disk: string;
    backupId: string;
    status: string | null;
    bytes: number | null;
    error: string | null;
    finishedAt: string | null;
  }[];
}

interface VmContext {
  row: ResourceEntity;
  spec: VirtualMachineSpec | null;
  invalid?: string;
  placement: WorkloadPlacementEntity | null;
  volumes: VolumePlacementEntity[];
  power: VmPowerEntity | null;
  pinnedImage: string | null;
  guestAgent: boolean | undefined;
}

function requester(req: RequestWithUser | undefined): string {
  const actor = actorFromRequest(req);

  return actor.type === 'api-key' ? 'api-key' : `user:${actor.id ?? 'unknown'}`;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Full virtual machines (3.35, M7.3): list and status (phase, NICs, disks, console availability), power actions
 * (`start` / `stop` / `force-off` change the operational power of `Manual` VMs — the replica is placed or drained
 * right away and the network recompiled; `reboot` / `reset` / `shutdown` go to the node as `vmPower`), `reimage`
 * (`vmImageImport` to the boot disk's primary), and snapshots (one Kopia backup per disk). Reads: project members;
 * power and consoles: operators and admins, developers when the project allows exec; snapshots / reimage: operators.
 * Every change is audited. Node commands are rows sent by whichever replica holds the node's session.
 */
@Injectable()
export class VirtualMachinesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VirtualMachinesService.name);
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly planner: WorkloadPlannerService,
    private readonly network: NetworkStateService,
    private readonly registry: AgentSessionRegistry,
    private readonly backups: BackupsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!shouldRunApiHttp(getQueueRole())) return;

    this.timer = setInterval(
      () =>
        void this.dispatch().catch((error: unknown) =>
          this.logger.warn(`VM commands: ${error instanceof Error ? error.message : String(error)}`),
        ),
      DISPATCH_MS,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------------------------------------ access

  private async mayExec(caller: AccessCaller, project: string): Promise<boolean> {
    const role = projectRole(caller, project);

    if (atLeast(role, 'operator')) return true;

    if (role !== 'developer') return false;

    return (await this.access.settings(this.dataSource.manager, project)).developerExec;
  }

  private async permissions(caller: AccessCaller, project: string): Promise<VirtualMachineDto['permissions']> {
    const exec = await this.mayExec(caller, project);
    const role = projectRole(caller, project);

    return { power: exec, snapshot: atLeast(role, 'operator'), console: exec, edit: atLeast(role, 'developer') };
  }

  // ------------------------------------------------------------------------------------------------- reads

  private async contexts(manager: EntityManager, projects: string[] | null, name?: string): Promise<VmContext[]> {
    const where = {
      kind: 'VirtualMachine',
      ...(projects ? { project: In(projects) } : { project: Not(IsNull()) }),
      ...(name ? { name } : {}),
    };
    const rows = await manager.getRepository(ResourceEntity).find({ where, order: { project: 'ASC', name: 'ASC' } });

    if (rows.length === 0) return [];

    const vmProjects = [...new Set(rows.map((r) => r.project as string))];
    const placements = await manager.getRepository(WorkloadPlacementEntity).find({
      where: vmProjects.map((p) => ({ project: p, deployment: VM_DEPLOYMENT_NAME, cronRun: IsNull() })),
    });
    const volumes = await manager
      .getRepository(VolumePlacementEntity)
      .find({ where: vmProjects.map((p) => ({ id: Like(`${p}/${VM_DEPLOYMENT_NAME}/%`) })) });
    const powers = await manager.getRepository(VmPowerEntity).find({ where: { project: In(vmProjects) } });
    const states = await manager
      .getRepository(DeploymentStateEntity)
      .find({ where: { id: In(vmProjects.map((p) => `${p}/${VM_DEPLOYMENT_NAME}`)) } });

    return rows.map((row) => {
      const project = row.project as string;
      const parsed = virtualMachineSpecSchema.safeParse(row.spec);
      const state = states.find((s) => s.id === `${project}/${VM_DEPLOYMENT_NAME}`);
      const spec = parsed.success ? parsed.data : null;
      const diskIds = new Set(spec?.disks.map((d) => vmDiskVolumeId(project, row.name, d.name)) ?? []);

      return {
        row,
        spec,
        ...(parsed.success ? {} : { invalid: parsed.error.issues.map((i) => i.message).join('; ') }),
        placement:
          placements.find((p) => p.project === project && p.id === vmReplicaId(project, row.name)) ??
          placements.find((p) => p.project === project && p.service === row.name) ??
          null,
        volumes: volumes.filter((v) => diskIds.has(v.id)),
        power: powers.find((p) => p.project === project && p.name === row.name) ?? null,
        pinnedImage: state?.images?.[row.name] ?? null,
        guestAgent: state?.imageConfigs?.[row.name]?.vmImage?.guestAgent,
      };
    });
  }

  private summary(ctx: VmContext): VirtualMachineSummaryDto {
    const { row, spec } = ctx;
    const project = row.project as string;
    const power = ctx.power?.desired;
    const shouldRun = spec ? vmShouldRun(spec, power) : false;
    const importProgress = vmReport(ctx.placement)?.vm?.importProgress;

    return {
      project,
      name: row.name,
      labels: row.labels ?? {},
      description: spec?.description ?? null,
      image: spec?.image ?? String((row.spec as { image?: unknown })?.image ?? ''),
      pinnedImage: ctx.pinnedImage,
      runStrategy: spec?.runStrategy ?? 'Always',
      power: shouldRun ? 'running' : 'stopped',
      phase: spec ? vmPhase(shouldRun, ctx.placement) : 'Failed',
      node: ctx.placement?.node ?? null,
      vcpus: spec?.cpu.vcpus ?? 0,
      memoryBytes: spec ? (parseVmQuantity(spec.memory) ?? 0) : 0,
      diskBytes: spec?.disks.reduce((sum, d) => sum + (parseVmQuantity(d.size) ?? 0), 0) ?? 0,
      disks: spec?.disks.length ?? 0,
      nics: spec?.nics.length ?? 0,
      addresses: ctx.placement?.addresses ?? [],
      graphical: spec?.console.graphical ?? false,
      ...(ctx.invalid ? { invalid: ctx.invalid } : {}),
      ...(importProgress ? { importProgress } : {}),
    };
  }

  /** VMs the caller may read, optionally of one project. */
  async list(req: RequestWithUser | undefined, project?: string): Promise<VirtualMachineSummaryDto[]> {
    const caller = await this.access.caller(req);

    if (project && !canReadProject(caller, project)) throw new NotFoundException('project not found');

    const contexts = await this.contexts(this.dataSource.manager, project ? [project] : null);

    return contexts.filter((c) => canReadProject(caller, c.row.project as string)).map((c) => this.summary(c));
  }

  private async context(caller: AccessCaller, project: string, name: string): Promise<VmContext> {
    if (!canReadProject(caller, project)) throw new NotFoundException('virtual machine not found');

    const [ctx] = await this.contexts(this.dataSource.manager, [project], name);

    if (!ctx) throw new NotFoundException('virtual machine not found');

    return ctx;
  }

  async get(req: RequestWithUser | undefined, project: string, name: string): Promise<VirtualMachineDto> {
    const caller = await this.access.caller(req);

    return await this.detail(caller, await this.context(caller, project, name));
  }

  private async detail(caller: AccessCaller, ctx: VmContext): Promise<VirtualMachineDto> {
    const summary = this.summary(ctx);
    const project = summary.project;
    const spec = ctx.spec;
    const report = vmReport(ctx.placement);
    const node = ctx.placement
      ? await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: ctx.placement.node } })
      : null;
    const permissions = await this.permissions(caller, project);
    const commands = await this.dataSource.getRepository(VmCommandEntity).find({
      where: { project, name: summary.name },
      order: { createdAt: 'DESC' },
      take: RECENT_COMMANDS,
    });
    const actions = spec
      ? vmAvailableActions(spec, summary.phase, ctx.power?.desired).filter((a) =>
          a === 'reimage' ? permissions.snapshot : permissions.power,
        )
      : [];
    const consoles = spec
      ? vmConsoles(spec, summary.phase, node, permissions.console)
      : {
          serial: { available: false, reason: 'invalid spec' },
          vnc: { available: false, reason: 'invalid spec' },
        };

    return {
      ...summary,
      spec,
      generation: ctx.row.generation,
      updatedAt: new Date(ctx.row.updatedAt).toISOString(),
      status: {
        phase: summary.phase,
        node: ctx.placement?.node ?? null,
        state: report?.state ?? null,
        guestPower: report?.vm?.power ?? null,
        importing: !!report?.vm?.importing,
        importProgress: report?.vm?.importProgress ?? null,
        message: report?.message ?? null,
        exitCode: report?.exitCode ?? null,
        reportedAt: report?.at ?? null,
        lastBoot: report && ['running', 'healthy', 'unhealthy'].includes(report.state) ? report.at : null,
        migration:
          ctx.placement?.migration || ctx.placement?.targetNode
            ? { targetNode: ctx.placement?.targetNode ?? null }
            : null,
      },
      powerDetail: {
        graceful: ctx.power?.graceful ?? true,
        changedBy: ctx.power?.changedBy ?? null,
        changedAt: iso(ctx.power?.changedAt),
        instanceGeneration: ctx.power?.instanceGeneration ?? 1,
      },
      nicStatus: spec ? vmNicStatus(project, summary.name, spec, ctx.placement?.addresses ?? []) : [],
      diskStatus: spec ? vmDiskStatus(project, summary.name, spec, ctx.volumes) : [],
      consoles: { replica: vmReplicaId(project, summary.name), namespace: 'socket/consoles', ...consoles },
      actions,
      permissions,
      commands: commands.map((c) => ({
        id: c.id,
        type: c.type,
        action: c.action,
        node: c.node,
        status: c.status,
        error: c.error,
        requestedBy: c.requestedBy,
        createdAt: new Date(c.createdAt).toISOString(),
        sentAt: iso(c.sentAt),
      })),
    };
  }

  // ----------------------------------------------------------------------------------------------- actions

  /** A lifecycle action (audited); returns the VM's new status. */
  async act(
    req: RequestWithUser | undefined,
    project: string,
    name: string,
    action: VmAction,
  ): Promise<VirtualMachineDto> {
    const caller = await this.access.caller(req);
    const ctx = await this.context(caller, project, name);
    const permissions = await this.permissions(caller, project);

    if (action === 'reimage' ? !permissions.snapshot : !permissions.power)
      throw new ForbiddenException(action === 'reimage' ? 'operator role required' : 'power actions not allowed');

    if (!ctx.spec) throw new ConflictException(`the virtual machine's spec is invalid: ${ctx.invalid}`);

    const phase = vmPhase(vmShouldRun(ctx.spec, ctx.power?.desired), ctx.placement);
    const refusal = vmActionRefusal(action, ctx.spec, phase, ctx.power?.desired);

    if (refusal) throw new ConflictException(refusal);

    switch (action) {
      case 'start':
        await this.start(req, ctx);
        break;
      case 'stop':
        await this.stop(req, ctx, true);
        break;
      case 'force-off':
        // Hard power-off on the node (`vmPower destroy`: no ACPI grace), then the replica drains like a stop. The
        // order on the node doesn't matter: a destroy during the launcher's stop grace ends that grace at once.
        if (ctx.placement?.node) await this.command(req, ctx, 'vmPower', 'destroy', undefined, false);
        await this.stop(req, ctx, false);
        break;
      case 'shutdown':
        // ACPI shutdown in the guest, and the VM stays off (its replica is removed after the launcher's grace).
        await this.command(req, ctx, 'vmPower', 'shutdown');
        await this.stop(req, ctx, true);
        break;
      case 'reboot':
      case 'reset':
        await this.command(req, ctx, 'vmPower', action);
        break;
      case 'reimage':
        await this.reimage(req, ctx);
        break;
    }

    void this.dispatch().catch(() => undefined);

    return await this.detail(caller, (await this.contexts(this.dataSource.manager, [project], name))[0] ?? ctx);
  }

  private async savePower(
    manager: EntityManager,
    ctx: VmContext,
    patch: Partial<Pick<VmPowerEntity, 'desired' | 'graceful' | 'instanceGeneration'>>,
    by: string,
  ): Promise<void> {
    const repo = manager.getRepository(VmPowerEntity);
    const current = await repo.findOne({ where: { project: ctx.row.project as string, name: ctx.row.name } });

    await repo.save(
      repo.create({
        project: ctx.row.project as string,
        name: ctx.row.name,
        desired: current?.desired ?? 'running',
        graceful: current?.graceful ?? true,
        instanceGeneration: current?.instanceGeneration ?? 1,
        ...patch,
        changedBy: by,
        changedAt: new Date(),
      }),
    );
  }

  /**
   * `start` of a `Manual` VM: quotas are checked with the VM running, then its replica is placed like an autoscaler
   * scale-up (the scheduler with the VM's disks, KVM and VM-support rules) and gets one address per NIC family.
   */
  private async start(req: RequestWithUser | undefined, ctx: VmContext): Promise<void> {
    const project = ctx.row.project as string;
    const name = ctx.row.name;
    const by = requester(req);

    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLACEMENT_ALLOCATION]);

      const resources = await manager.getRepository(ResourceEntity).find();
      const state = await loadVmOperationalState(manager);

      state.power.delete(`${project}/${name}`);

      const { parsed } = this.planner.parse(resources, state.power, state.generations);
      const issues = quotaIssues(projectUsage(parsed, resources), resources, [project]);

      if (issues.length > 0) throw new ConflictException(issues.join('; '));

      const placements = await manager
        .getRepository(WorkloadPlacementEntity)
        .find({ where: { cronRun: IsNull(), drainUntil: IsNull() } });
      const replica = vmReplicaId(project, name);
      const service = serviceId(project, VM_DEPLOYMENT_NAME, name);
      const draining = await manager.getRepository(WorkloadPlacementEntity).findOne({ where: { id: replica } });

      // A stop that is still draining is cancelled: the VM stays where it runs.
      if (draining?.drainUntil) {
        await manager.getRepository(WorkloadPlacementEntity).update({ id: replica }, { drainUntil: null });
      } else if (!placements.some((p) => p.id === replica)) {
        const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
        const volumes = await manager.getRepository(VolumePlacementEntity).find();
        const services = toSchedulerServices(parsed).map((s) => ({
          ...s,
          replicas:
            s.id === service
              ? 0
              : placements.filter((p) => serviceId(p.project, p.deployment, p.service) === s.id).length,
        }));
        const { added, issue } = placeScaleUp(
          {
            nodes: toSchedulerNodes(plannerNodes(nodes, Date.now(), undefined, kvmOptOutNodes(resources))),
            services,
            current: {
              replicas: placements.map((p) => ({
                service: serviceId(p.project, p.deployment, p.service),
                replica: p.id,
                node: p.node,
              })),
              volumes: volumes.map((v) => ({
                volume: v.id,
                primary: v.primaryNode,
                syncReplicas: v.syncReplicas,
                remoteReplicas: v.remoteReplicas,
              })),
            },
          },
          service,
          1,
        );
        const target = added[0];

        if (!target) throw new ConflictException(`the virtual machine can't be placed: ${issue ?? 'no eligible node'}`);

        if (draining) await manager.getRepository(WorkloadPlacementEntity).delete({ id: replica });

        const addresses = await this.planner.allocateOn(
          manager,
          replica,
          service,
          target.node,
          addressFamiliesOf(parsed),
        );
        const repo = manager.getRepository(WorkloadPlacementEntity);

        await repo.save(
          repo.create({
            id: replica,
            project,
            deployment: VM_DEPLOYMENT_NAME,
            service: name,
            node: target.node,
            addresses,
            targetNode: null,
            targetAddresses: [],
            migration: null,
            restored: null,
            gate: null,
            releasedSpec: null,
            cronRun: null,
            drainUntil: null,
            specHash: null,
            status: null,
          }),
        );
      }

      await this.savePower(manager, ctx, { desired: 'running', graceful: true }, by);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'vm.start',
        target: `virtual-machine/${project}/${name}`,
        project,
        details: {},
      });
    });

    this.network.requestRecompile(`vm ${project}/${name} started`);
  }

  /**
   * `stop` / `force-off` of a `Manual` VM: the replica drains now (the node stops the launcher: ACPI shutdown within
   * the VM's stop grace; `force-off` destroys the domain first through `vmPower destroy` and records
   * `graceful: false`). Disks stay.
   */
  private async stop(req: RequestWithUser | undefined, ctx: VmContext, graceful: boolean): Promise<void> {
    const project = ctx.row.project as string;
    const name = ctx.row.name;

    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLACEMENT_ALLOCATION]);
      await manager
        .getRepository(WorkloadPlacementEntity)
        .update({ id: vmReplicaId(project, name), drainUntil: IsNull() }, { drainUntil: new Date() });
      await this.savePower(manager, ctx, { desired: 'stopped', graceful }, requester(req));
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: graceful ? 'vm.stop' : 'vm.force-off',
        target: `virtual-machine/${project}/${name}`,
        project,
        details: { node: ctx.placement?.node ?? null },
      });
    });

    this.network.requestRecompile(`vm ${project}/${name} stopped`);
  }

  /** Queues a node command (`vmPower` to the VM's node, `vmImageImport` to the boot disk's primary). */
  private async command(
    req: RequestWithUser | undefined,
    ctx: VmContext,
    type: VmCommandType,
    action: string,
    build?: (manager: EntityManager) => Promise<{ node: string; payload: Record<string, unknown> }>,
    required = true,
  ): Promise<VmCommandEntity | null> {
    const project = ctx.row.project as string;
    const name = ctx.row.name;

    return await this.dataSource.transaction(async (manager) => {
      const target = build
        ? await build(manager)
        : { node: ctx.placement?.node as string, payload: { replica: vmReplicaId(project, name), action } };

      if (!target.node) throw new ConflictException('the virtual machine is not placed');

      const node = await manager.getRepository(NodeEntity).findOne({ where: { name: target.node } });

      if (!node?.protocolFeatures?.includes('virtual-machines')) {
        // Optional commands (force-off's destroy) are skipped: the drain still stops the VM, with its grace.
        if (!required) return null;

        throw new ConflictException(`node ${target.node} does not support virtual machines (update its agent)`);
      }

      const repo = manager.getRepository(VmCommandEntity);
      const row = await repo.save(
        repo.create({
          project,
          name,
          node: target.node,
          type,
          action,
          payload: target.payload,
          status: 'pending',
          error: null,
          requestedBy: requester(req),
          sentAt: null,
        }),
      );

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: `vm.${action}`,
        target: `virtual-machine/${project}/${name}`,
        project,
        details: { command: row.id, node: target.node },
      });

      return row;
    });
  }

  /**
   * `reimage`: the stopped VM's boot disk is written again from its pinned image on the disk's primary
   * (`vmImageImport`), and the cloud-init instance generation goes up (first-boot configuration runs again).
   */
  private async reimage(req: RequestWithUser | undefined, ctx: VmContext): Promise<void> {
    const spec = ctx.spec as VirtualMachineSpec;
    const project = ctx.row.project as string;
    const boot = vmBootDisk(spec);

    if (!boot) throw new ConflictException('the virtual machine has no boot disk');

    await this.command(req, ctx, 'vmImageImport', 'reimage', async (manager) => {
      const volume = vmDiskVolumeId(project, ctx.row.name, boot.name);
      const placed = await manager.getRepository(VolumePlacementEntity).findOne({ where: { id: volume } });
      const state = await manager
        .getRepository(DeploymentStateEntity)
        .findOne({ where: { id: `${project}/${VM_DEPLOYMENT_NAME}` } });
      const ref = state?.images?.[ctx.row.name];
      const image = state?.imageConfigs?.[ctx.row.name]?.vmImage;

      if (!placed) throw new ConflictException('the boot disk is not placed yet (apply the virtual machine first)');

      if (!ref || !image) throw new ConflictException('the image is not pinned yet (apply the virtual machine first)');

      const current = await manager.getRepository(VmPowerEntity).findOne({ where: { project, name: ctx.row.name } });

      await this.savePower(
        manager,
        ctx,
        { instanceGeneration: (current?.instanceGeneration ?? 1) + 1 },
        requester(req),
      );

      return {
        node: placed.primaryNode,
        payload: {
          import: randomUUID(),
          replica: vmReplicaId(project, ctx.row.name),
          volume,
          image: {
            ref,
            digest: ref.slice(ref.indexOf('@') + 1),
            format: image.format,
            layerDigest: image.layerDigest,
          },
        },
      };
    });
    this.network.requestRecompile(`vm ${project}/${ctx.row.name} reimaged`);
  }

  /**
   * Sends pending commands of nodes connected to this replica (each claimed by a conditional update, so exactly one
   * replica sends it); commands older than the timeout fail. Returns how many were sent.
   */
  async dispatch(now = new Date()): Promise<number> {
    if (this.dispatching) return 0;

    this.dispatching = true;

    try {
      const repo = this.dataSource.getRepository(VmCommandEntity);

      await repo.update(
        { status: 'pending', createdAt: LessThan(new Date(now.getTime() - COMMAND_TIMEOUT_MS)) },
        { status: 'failed', error: 'the node did not connect in time' },
      );

      let sent = 0;

      for (const row of await repo.find({ where: { status: 'pending' }, order: { createdAt: 'ASC' }, take: 100 })) {
        const session = this.registry.get(row.node);

        if (!session) continue;

        if (!messageAllowed(row.type, session.protocol)) {
          await repo.update(
            { id: row.id, status: 'pending' },
            { status: 'failed', error: `node ${row.node} does not support ${row.type}` },
          );
          continue;
        }

        const claimed = await repo.update({ id: row.id, status: 'pending' }, { status: 'sent', sentAt: now });

        if (!claimed.affected) continue;

        try {
          session.send(controlPlaneMessage(row.type, row.payload as never));
          sent++;
        } catch (error) {
          await repo.update(
            { id: row.id },
            { status: 'failed', error: error instanceof Error ? error.message : String(error) },
          );
        }
      }

      return sent;
    } finally {
      this.dispatching = false;
    }
  }

  // --------------------------------------------------------------------------------------------- snapshots

  async snapshots(req: RequestWithUser | undefined, project: string, name: string): Promise<VmSnapshotDto[]> {
    const caller = await this.access.caller(req);

    await this.context(caller, project, name);

    const rows = await this.dataSource
      .getRepository(VmSnapshotEntity)
      .find({ where: { project, name }, order: { createdAt: 'DESC' }, take: 200 });
    const ids = rows.flatMap((r) => Object.values(r.backups));
    const backups = ids.length
      ? await this.dataSource.getRepository(BackupEntity).find({ where: { id: In(ids) } })
      : [];

    return rows.map((r) => toSnapshotDto(r, backups));
  }

  /** Backs up every disk now (operators); the snapshot groups the backups. */
  async createSnapshot(
    req: RequestWithUser | undefined,
    project: string,
    name: string,
    description?: string,
  ): Promise<VmSnapshotDto> {
    const caller = await this.access.caller(req);
    const ctx = await this.context(caller, project, name);

    if (!atLeast(projectRole(caller, project), 'operator')) throw new ForbiddenException('operators take snapshots');

    if (!ctx.spec) throw new ConflictException(`the virtual machine's spec is invalid: ${ctx.invalid}`);

    const placed = new Set(ctx.volumes.map((v) => v.id));
    const disks = ctx.spec.disks.filter((d) => placed.has(vmDiskVolumeId(project, name, d.name)));

    if (disks.length === 0)
      throw new ConflictException('the disks are not placed yet (apply the virtual machine first)');

    const backups: Record<string, string> = {};

    for (const disk of disks) {
      const backup = await this.backups.backupNow(req, vmDiskVolumeId(project, name, disk.name));

      backups[disk.name] = backup.id;
    }

    const row = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(VmSnapshotEntity);
      const saved = await repo.save(
        repo.create({
          project,
          name,
          backups,
          consistency: vmSnapshotConsistency(ctx.guestAgent === undefined ? undefined : { guestAgent: ctx.guestAgent }),
          description: description?.slice(0, 1024) ?? null,
          createdBy: requester(req),
        }),
      );

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'vm.snapshot',
        target: `virtual-machine/${project}/${name}`,
        project,
        details: { snapshot: saved.id, backups, consistency: saved.consistency },
      });

      return saved;
    });
    const rows = await this.dataSource.getRepository(BackupEntity).find({ where: { id: In(Object.values(backups)) } });

    return toSnapshotDto(row, rows);
  }
}

export function toSnapshotDto(row: VmSnapshotEntity, backups: readonly BackupEntity[]): VmSnapshotDto {
  const disks = Object.entries(row.backups).map(([disk, backupId]) => {
    const b = backups.find((x) => x.id === backupId);

    return {
      disk,
      backupId,
      status: b?.status ?? null,
      bytes: b ? Number(b.bytes) : null,
      error: b?.error ?? null,
      finishedAt: iso(b?.finishedAt),
    };
  });

  return {
    id: row.id,
    project: row.project,
    name: row.name,
    description: row.description,
    consistency: row.consistency,
    status: vmSnapshotStatus(disks.map((d) => d.status ?? 'failed')),
    createdBy: row.createdBy,
    createdAt: new Date(row.createdAt).toISOString(),
    disks,
  };
}
