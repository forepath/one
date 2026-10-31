import { randomUUID } from 'node:crypto';

import type { RequestWithUser } from '@forepath/identity/backend';
import {
  controlPlaneMessage,
  messageAllowed,
  type DiscoveryReport,
  type DiscoveryResult,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  buildJoinPlan,
  discoveredItems,
  type DiscoveredItem,
  type ImportClusterContext,
  type ImportSelections,
  type JoinPlan,
} from '@forepath/loadweaver/shared/util-import';
import {
  clusterSpecSchema,
  LOADWEAVER_API_VERSION,
  stringifyResourceDocuments,
  type Resource,
} from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import type { PlanResponseDto } from '../dto/plan.dto';
import { ClusterEntity } from '../entities/cluster.entity';
import { IMPORT_LIFECYCLES, NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { NodesService } from '../services/nodes.service';
import { PlansService } from '../services/plans.service';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import { sanitizeDiscovery } from './discovery-sanitize';
import { ImportSelectionEntity, NodeDiscoveryEntity, type ImportStatus, type ImportStepState } from './import.entities';

export interface ImportSummary {
  node: string;
  lifecycle: string;
  connected: boolean;
  hostname: string;
  discoveryId: string;
  discoveredAt: string;
  composeProjects: number;
  containers: number;
  volumes: number;
  former: 'none' | 'same-cluster' | 'other-cluster' | 'unknown-cluster';
  selection: { id: string; status: ImportStatus; planId: string | null } | null;
}

export interface ImportSelectionView {
  id: string;
  status: ImportStatus;
  discoveryId: string;
  selections: ImportSelections;
  joinPlan: JoinPlan;
  planId: string | null;
  steps: Record<string, ImportStepState>;
  released: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportDetail {
  node: string;
  lifecycle: string;
  connected: boolean;
  discovery: { id: string; source: string; receivedAt: string; requestedAt: string | null; report: DiscoveryReport };
  items: DiscoveredItem[];
  projects: string[];
  selection: ImportSelectionView | null;
}

const OPEN: ImportStatus[] = ['draft', 'planned', 'running'];

function selectionView(s: ImportSelectionEntity): ImportSelectionView {
  return {
    id: s.id,
    status: s.status,
    discoveryId: s.discoveryId,
    selections: s.selections,
    joinPlan: s.joinPlan,
    planId: s.planId,
    steps: s.steps ?? {},
    released: s.released ?? [],
    error: s.error,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * The import wizard's backend (3.21): discoveries of pending nodes, the selections per discovered item (import /
 * migrate / ignore, target project, hostnames, volume handling), the one join plan built from them (conflicts,
 * former installation, deployments, steps) and the plan it is turned into — a normal plan (`NodeImport` + the
 * imported deployments) with the usual approvals. Reading needs a cluster role; changing needs cluster admin or
 * infra operator.
 */
@Injectable()
export class ImportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly sessions: AgentSessionRegistry,
    private readonly plans: PlansService,
    private readonly planner: WorkloadPlannerService,
    private readonly nodes: NodesService,
    private readonly audit: AuditLogService,
  ) {}

  private async reader(req: RequestWithUser | undefined): Promise<void> {
    if (!(await this.access.caller(req)).clusterRole) throw new ForbiddenException('Missing cluster permission');
  }

  private async writer(req: RequestWithUser | undefined): Promise<string> {
    const caller = await this.access.caller(req);

    if (caller.clusterRole !== 'cluster-admin' && caller.clusterRole !== 'infra-operator')
      throw new ForbiddenException('cluster admin or infra operator role required');

    return caller.userId ?? 'api-key';
  }

  async list(req: RequestWithUser | undefined): Promise<ImportSummary[]> {
    await this.reader(req);

    const discoveries = await this.dataSource.getRepository(NodeDiscoveryEntity).find({ order: { node: 'ASC' } });
    const nodes = new Map(
      (
        await this.dataSource.getRepository(NodeEntity).find({ where: { name: In(discoveries.map((d) => d.node)) } })
      ).map((n) => [n.name, n]),
    );
    const selections = await this.dataSource
      .getRepository(ImportSelectionEntity)
      .find({ where: { node: In(discoveries.map((d) => d.node)) }, order: { createdAt: 'DESC' } });
    const clusterId = await this.clusterId();

    return discoveries
      .filter((d) => nodes.get(d.node) && nodes.get(d.node)?.lifecycle !== 'left')
      .map((d) => {
        const node = nodes.get(d.node) as NodeEntity;
        const selection = selections.find((s) => s.node === d.node);
        const former = d.report.former;

        return {
          node: d.node,
          lifecycle: node.lifecycle,
          connected: !!this.sessions.get(d.node),
          hostname: d.report.hostname,
          discoveryId: d.id,
          discoveredAt: d.receivedAt.toISOString(),
          composeProjects: d.report.composeProjects.length,
          containers: d.report.containers.length,
          volumes: d.report.volumes.length,
          former: !former
            ? 'none'
            : former.clusterId === clusterId
              ? 'same-cluster'
              : former.clusterId
                ? 'other-cluster'
                : 'unknown-cluster',
          selection: selection ? { id: selection.id, status: selection.status, planId: selection.planId } : null,
        };
      });
  }

  private async discovery(node: string): Promise<NodeDiscoveryEntity> {
    const discovery = await this.dataSource.getRepository(NodeDiscoveryEntity).findOne({ where: { node } });

    if (!discovery) throw new NotFoundException(`no discovery for node ${node}`);

    return discovery;
  }

  private async node(node: string): Promise<NodeEntity> {
    const entity = await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: node } });

    if (!entity || entity.lifecycle === 'left') throw new NotFoundException(`node ${node} is not part of the cluster`);

    return entity;
  }

  private async latestSelection(node: string): Promise<ImportSelectionEntity | null> {
    return await this.dataSource
      .getRepository(ImportSelectionEntity)
      .findOne({ where: { node }, order: { createdAt: 'DESC' } });
  }

  async get(req: RequestWithUser | undefined, node: string): Promise<ImportDetail> {
    await this.reader(req);

    const entity = await this.node(node);
    const discovery = await this.discovery(node);
    const context = await this.context(this.dataSource.manager, entity);
    const selection = await this.latestSelection(node);

    return {
      node,
      lifecycle: entity.lifecycle,
      connected: !!this.sessions.get(node),
      discovery: {
        id: discovery.id,
        source: discovery.source,
        receivedAt: discovery.receivedAt.toISOString(),
        requestedAt: discovery.requestedAt?.toISOString() ?? null,
        report: discovery.report,
      },
      items: discoveredItems(discovery.report, {
        skipManaged: discovery.report.former?.clusterId === context.clusterId,
      }),
      projects: context.projects,
      selection: selection ? selectionView(selection) : null,
    };
  }

  /** Asks the pending node to discover again (the answer replaces the stored report). */
  async requestDiscovery(req: RequestWithUser | undefined, node: string): Promise<{ request: string }> {
    await this.writer(req);

    const entity = await this.node(node);

    if (!IMPORT_LIFECYCLES.includes(entity.lifecycle) || entity.lifecycle === 'importing')
      throw new ConflictException(`node ${node} is not waiting for a join plan`);

    const session = this.sessions.get(node);

    if (!session) throw new ConflictException(`node ${node} is not connected`);

    if (!messageAllowed('discoveryRequest', session.protocol))
      throw new ConflictException(`the agent on ${node} does not support discovery (feature node-import)`);

    const request = randomUUID();

    await this.dataSource
      .getRepository(NodeDiscoveryEntity)
      .update({ node }, { requestId: request, requestedAt: new Date() });
    session.send(controlPlaneMessage('discoveryRequest', { request }));

    return { request };
  }

  /** A fresh report from the node: only the answer to the outstanding request counts. */
  async recordDiscovery(node: string, result: DiscoveryResult): Promise<boolean> {
    const repo = this.dataSource.getRepository(NodeDiscoveryEntity);
    const current = await repo.findOne({ where: { node } });

    if (!current || current.requestId !== result.request) return false;

    const updated = await repo
      .createQueryBuilder()
      .update()
      .set({
        id: randomUUID(),
        report: sanitizeDiscovery(result.report) as never,
        source: 'refresh',
        requestId: null,
        requestedAt: null,
        receivedAt: new Date(),
      })
      .where('node = :node AND request_id = :request', { node, request: result.request })
      .execute();

    return (updated.affected ?? 0) > 0;
  }

  /** What the plan builder needs to know about the cluster, from the current state. */
  async context(manager: EntityManager, node: NodeEntity): Promise<ImportClusterContext> {
    const resources = await manager.getRepository(ResourceEntity).find();
    const clusterResource = resources.find((r) => r.kind === 'Cluster' && !r.project);
    const network = clusterResource ? clusterSpecSchema.parse(clusterResource.spec).network : undefined;
    const parsed = this.planner.parse(resources).parsed;
    const forwardedPorts: Record<string, string> = {};
    const hostnames: Record<string, string> = {};

    for (const d of parsed)
      for (const s of d.compose.services) {
        for (const p of s.ports)
          forwardedPorts[`${p.protocol}/${p.publishedPort}`] = `${d.project}/${d.name}/${s.name}`;

        for (const h of s.http) hostnames[h.host] = `${d.project}/${d.name}/${s.name}`;
      }

    const volumes = await manager.getRepository(VolumePlacementEntity).find();

    return {
      clusterId: await this.clusterId(manager),
      node: node.name,
      network: {
        podPoolV4: network?.podPoolV4,
        podPoolV6: network?.podPoolV6,
        servicePoolV4: network?.servicePoolV4,
        servicePoolV6: network?.servicePoolV6,
        overlayPoolV4: network?.overlayPoolV4,
        overlayPoolV6: network?.overlayPoolV6,
      },
      nodeSubnets: [node.podSubnetV4, node.podSubnetV6].filter((s): s is string => !!s),
      projects: resources
        .filter((r) => r.kind === 'Project')
        .map((r) => r.name)
        .sort(),
      deployments: resources.filter((r) => r.kind === 'Deployment').map((r) => `${r.project}/${r.name}`),
      forwardedPorts,
      hostnames,
      volumes: volumes.map((v) => ({
        id: v.id,
        drbdMinor: v.drbdMinor,
        holders: [...new Set([v.primaryNode, ...v.syncReplicas, ...v.remoteReplicas])],
        sizeBytes: Number(v.sizeBytes),
      })),
    };
  }

  private async clusterId(manager: EntityManager = this.dataSource.manager): Promise<string> {
    return (await manager.getRepository(ClusterEntity).findOne({ where: {} }))?.clusterId ?? '';
  }

  /** Saves the wizard's selections and returns the join plan built from them (a preview: nothing is applied). */
  async saveSelections(
    req: RequestWithUser | undefined,
    node: string,
    selections: ImportSelections,
  ): Promise<ImportSelectionView> {
    const userId = await this.writer(req);

    return await this.dataSource.transaction(async (manager) => {
      const entity = await manager
        .getRepository(NodeEntity)
        .findOne({ where: { name: node }, lock: { mode: 'pessimistic_write' } });

      if (!entity || entity.lifecycle !== 'pending')
        throw new ConflictException(`node ${node} is not waiting for a join plan`);

      const discovery = await manager.getRepository(NodeDiscoveryEntity).findOne({ where: { node } });

      if (!discovery) throw new NotFoundException(`no discovery for node ${node}`);

      const joinPlan = buildJoinPlan(discovery.report, selections, await this.context(manager, entity));
      const repo = manager.getRepository(ImportSelectionEntity);
      const open = await repo.findOne({ where: { node, status: In(OPEN) } });

      if (open && open.status !== 'draft')
        throw new ConflictException(`the join plan of ${node} is ${open.status}; discard it to change the selection`);

      const saved = await repo.save(
        Object.assign(open ?? repo.create({ node, createdBy: userId }), {
          discoveryId: discovery.id,
          selections,
          joinPlan,
          status: 'draft' as ImportStatus,
          planId: null,
          steps: {},
          restartPolicies: {},
          released: [],
          error: null,
        }),
      );

      return selectionView(saved);
    });
  }

  /**
   * Turns the saved selections into one plan (3.21): the imported deployments and the node's `NodeImport` with the
   * join plan's steps, rebuilt from the current discovery. Refused while the join plan has errors.
   */
  async createPlan(req: RequestWithUser | undefined, node: string): Promise<PlanResponseDto> {
    await this.writer(req);

    const { selection, documents } = await this.dataSource.transaction(async (manager) => {
      const entity = await manager.getRepository(NodeEntity).findOne({ where: { name: node } });

      if (!entity || entity.lifecycle !== 'pending')
        throw new ConflictException(`node ${node} is not waiting for a join plan`);

      const repo = manager.getRepository(ImportSelectionEntity);
      const open = await repo.findOne({ where: { node, status: In(OPEN) }, lock: { mode: 'pessimistic_write' } });

      if (!open) throw new NotFoundException(`no import selection for node ${node}; save the wizard's selection first`);

      if (open.status !== 'draft') throw new ConflictException(`the join plan of ${node} is ${open.status} already`);

      const discovery = await manager.getRepository(NodeDiscoveryEntity).findOne({ where: { node } });

      if (!discovery) throw new NotFoundException(`no discovery for node ${node}`);

      const joinPlan = buildJoinPlan(discovery.report, open.selections, await this.context(manager, entity));

      if (joinPlan.errors.length)
        throw new BadRequestException({ message: 'the join plan has errors', errors: joinPlan.errors });

      const nodeImport: Resource<'NodeImport'> = {
        apiVersion: LOADWEAVER_API_VERSION,
        kind: 'NodeImport',
        metadata: { name: node },
        spec: {
          node,
          selection: open.id,
          discovery: discovery.id,
          steps: joinPlan.steps,
          wipeFormerIdentity: joinPlan.wipeFormerIdentity,
          reservedPorts: joinPlan.reservedPorts,
        },
      };

      Object.assign(open, { joinPlan, discoveryId: discovery.id });
      await repo.save(open);

      return {
        selection: open,
        documents: stringifyResourceDocuments([...joinPlan.deployments.map((d) => d.resource), nodeImport]),
      };
    });
    const plan = await this.plans.create({ documents }, req);

    await this.dataSource
      .getRepository(ImportSelectionEntity)
      .update({ id: selection.id, status: 'draft' }, { status: 'planned', planId: plan.id });

    return plan;
  }

  /** Discards the open import; a node still pending leaves the cluster (nothing on it was changed). */
  async discard(req: RequestWithUser | undefined, node: string): Promise<{ discarded: boolean; nodeLeft: boolean }> {
    await this.writer(req);

    const entity = await this.node(node);
    const repo = this.dataSource.getRepository(ImportSelectionEntity);
    const open = await repo.findOne({ where: { node, status: In(OPEN) } });

    if (open?.status === 'running') throw new ConflictException(`the join plan of ${node} is running`);

    if (open) await repo.update({ id: open.id }, { status: 'discarded' });

    let nodeLeft = false;

    if (entity.lifecycle === 'pending') {
      await this.nodes.leave(node, actorFromRequest(req));
      await this.dataSource.getRepository(NodeDiscoveryEntity).delete({ node });
      nodeLeft = true;
    }

    await this.dataSource.transaction(async (manager) =>
      this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'node.import-discard',
        target: `node/${node}`,
        details: { selection: open?.id ?? null, nodeLeft },
      }),
    );

    return { discarded: !!open, nodeLeft };
  }
}
