import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { compileNetwork, diffCompilation } from '@forepath/loadweaver/shared/util-policy-compiler';
import { parseImageReference } from '@forepath/loadweaver/shared/util-compose';
import {
  clusterSpecSchema,
  nodeGroupSpecSchema,
  policySpecSchema,
  imagePolicySpecSchema,
  projectSpecSchema,
  siteSpecSchema,
  parseResourceDocuments,
  PRIVATE_REGISTRY_HOST,
  RESOURCE_KINDS,
  VM_DEPLOYMENT_NAME,
  type ClusterSpec,
  type Resource,
  type ResourceKind,
} from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not } from 'typeorm';

import {
  DRY_RUN_PLAN_ID,
  planUserIds,
  toPlanResponse,
  type CreatePlanDto,
  type PlanResponseDto,
  type ResourceRefDto,
} from '../dto/plan.dto';
import { ClusterEntity } from '../entities/cluster.entity';
import { NodeEntity } from '../entities/node.entity';
import { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { PlanEntity, type PlanResourceChange, type PlanSource, type PlanStatus } from '../entities/plan.entity';
import { GitScopeService } from '../git/git-scope.service';
import { ChangeEventsService } from './change-events.service';
import { ResourceEntity } from '../entities/resource.entity';
import { ResourcesRepository } from '../repositories/resources.repository';
import { canonicalJson } from '../utils/canonical-json.utils';
import { ADDRESS_KINDS, NETWORK_KINDS, WORKLOAD_KINDS } from '../plans/plan-kinds';
import { ApplyOperationService, initialProgress, lockTable } from '../plans/apply-operation.service';
import { lockConflicts, lockScopes } from '../plans/apply-tracking.utils';
import { syncNode } from '../plans/node-sync';
import { syncNodeImport } from '../import/node-import-sync';
import { computeControlPlaneMembership } from '../utils/control-plane-membership.utils';
import { actorFromRequest, AuditLogService, ON_BEHALF_OF_SCOPE } from './audit-log.service';
import { samePerson } from '../fleet-identity/approval-persons';
import { userEmails } from '../fleet-identity/user-emails';
import {
  assertFleetApprovalIdentity,
  assertNotLegacyFleetItem,
  fleetIdentityOf,
} from '../fleet-identity/fleet-identity.utils';
import { ClusterAccessService } from './cluster-access.service';
import { ProjectAccessService } from '../access/project-access.service';
import {
  approvalNeeded,
  atLeast,
  planVisibleTo,
  planRequirements,
  projectRole,
  validApproval,
  type AccessCaller,
} from '../access/access.utils';
import {
  PlanApprovalEntity,
  PolicyAcceptanceEntity,
  ProjectMemberEntity,
  type ProjectRole,
} from '../entities/project-access.entity';
import {
  crossProjectReferences,
  exposureIssues,
  planRisk,
  poolRightIssues,
  projectUsage,
  quotaIssues,
} from '../access/plan-access.utils';
import { BackupKeyEntity } from '../backups/backup.entities';
import { backupPins, deletionDelayMs } from '../backups/backup.utils';
import { platformPlanWarnings } from '../backups/platform/platform-dr.utils';
import { backupBytesByProject } from '../backups/backup-usage';
import {
  buildCompilerInput,
  ingressNodesOf,
  NetworkStateService,
  objectStoreHolderSet,
  type WorkloadContext,
} from './network-state.service';
import { collectExposures, statusPageHosts } from '../ingress/ingress-state.utils';
import { normalizeResource, ResourceStoreService } from './resource-store.service';
import { ImageResolverService } from './image-resolver.service';
import { SecretsService } from './secrets.service';
import { RegistryTokenService } from './registry-token.service';
import { PublicAddressService } from '../ipam/public-address.service';
import { DnsService, dnsProviders, dnsZones } from '../dns/dns.service';
import { dnssecPlanSteps } from '../dns/dnssec.utils';
import { dnsFailovers, failoverPlanNotes } from '../dns/dns-failover.utils';
import { InstallService } from './install.service';
import { ImagePolicyService } from '../images/image-policy.service';
import type { RepositoryReader } from '../images/image-signature';
import { holderNodes } from '../ipam/public-address-state.utils';
import { chooseHolder, egressGateways, holderCandidates, poolWarnings } from '../ipam/public-ipam.utils';
import { bind9Nodes, nameServerWarnings } from '../dns/hosted-zones.utils';
import { bgpResources, bgpWarnings, validateBgp } from '../bgp/bgp-state.utils';
import { RpkiCheckService } from '../bgp/rpki-check.service';
import { DnsFailoverStateEntity } from '../entities/dns-failover.entity';
import { DnsZoneStatusEntity } from '../entities/dns-zone-status.entity';
import { DnssecKeyEntity } from '../entities/dnssec-key.entity';
import { ipPools } from '../ipam/public-address.service';
import { PublicAddressEntity } from '../entities/public-address.entity';
import { nodeAddress } from './object-store-controller.service';
import { REGISTRY_PRIVATE_PORT } from '../object-store/registry-state.utils';
import { podSubnetsOf, WorkloadPlannerService, type WorkloadPlan } from './workload-planner.service';
import { isCheckpointMethod } from './migration-records';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import {
  allocateServiceAddresses,
  allocateWorkloadAddresses,
  serviceId,
  volumeHoldersChanged,
  workloadLabels,
  type VolumeCopyChange,
} from '../utils/workload-planning.utils';
import { ServiceAddressEntity } from '../entities/service-address.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { VpnClientEntity } from '../entities/vpn-client.entity';
import {
  clientValid,
  remoteAccessInput,
  remoteAccessIssues,
  VPN_ADDRESS_OWNER,
} from '../remote-access/remote-access.utils';
import { volumeNodeWarnings } from '../utils/drbd-volumes.utils';
import { forgetVmOperationalState } from '../utils/vm-power.utils';
import { inspectImageArchitectures, inspectVmImage } from './image-resolver.service';
import { microvmIssues, type ImageInspection } from '../utils/microvm-planning.utils';
import { addressFamiliesOf, pinVmSecrets, vmImageIssues } from '../utils/vm-planning.utils';
import { autoscalePlanNotes } from '../autoscaling/autoscale.utils';

const RESERVED_PROJECT_NAMES = new Set(['cluster']);

/**
 * Names users can't take (3.17, 3.35): the project `cluster` (the cluster-wide scope) and the deployment `lw-vm` (a
 * project's virtual machines).
 */
export function reservedNameIssue(resources: readonly Pick<Resource, 'kind' | 'metadata'>[]): string | null {
  if (resources.some((r) => r.kind === 'Project' && RESERVED_PROJECT_NAMES.has(r.metadata.name)))
    return `project names ${[...RESERVED_PROJECT_NAMES].join(', ')} are reserved`;

  if (resources.some((r) => r.kind === 'Deployment' && r.metadata.name === VM_DEPLOYMENT_NAME))
    return `the deployment name ${VM_DEPLOYMENT_NAME} is reserved for virtual machines`;

  return null;
}

/** The architecture images are pinned for (3.35): arm64 only when every workload node is arm64. */
export function workloadArch(nodes: readonly Pick<NodeEntity, 'os' | 'witness'>[]): 'amd64' | 'arm64' {
  const arches = nodes
    .filter((n) => !n.witness)
    .map((n) => (n.os?.arch === 'arm64' || n.os?.arch === 'aarch64' ? 'arm64' : 'amd64'));

  return arches.length > 0 && arches.every((a) => a === 'arm64') ? 'arm64' : 'amd64';
}

/**
 * Every architecture of the cluster's workload nodes (3.35, mixed-arch clusters), `amd64` first; nodes without a
 * reported architecture count as amd64 (as in `workloadArch`). MicroVM guest images are inspected for each.
 */
export function workloadArches(nodes: readonly Pick<NodeEntity, 'os' | 'witness'>[]): ('amd64' | 'arm64')[] {
  const arches = new Set(
    nodes
      .filter((n) => !n.witness)
      .map((n) => (n.os?.arch === 'arm64' || n.os?.arch === 'aarch64' ? 'arm64' : 'amd64')),
  );

  return (['amd64', 'arm64'] as const).filter((a) => arches.has(a));
}

/** UI sessions vs. machine callers (API key, PATs) as a plan's source (3.29). */
export function requestSourceKind(req?: RequestWithUser): 'ui' | 'api' {
  const info = getUserFromRequest(req || ({} as RequestWithUser));

  return info.isApiKeyAuth || (info.amr ?? []).includes('pat') ? 'api' : 'ui';
}

type DeploymentStates = Record<
  string,
  {
    images: Record<string, string>;
    secretVersions: Record<string, number>;
    /** Inspected microVM / VM images per service (3.35). */
    imageConfigs?: Record<string, ImageInspection>;
  }
>;

interface Preview {
  deploymentStates: DeploymentStates;
  networkChanges: Record<string, unknown>[];
  diagnostics: Record<string, unknown>[];
  workloadChanges: Record<string, unknown>[];
  failureAnalysis: Record<string, unknown> | null;
  warnings: Record<string, unknown>[];
  /** Per project: why its part is risky (3.17 approvals). */
  risk: Record<string, string[]>;
}

function resourceBody(resource: Resource): Record<string, unknown> {
  return {
    labels: resource.metadata.labels ?? {},
    annotations: resource.metadata.annotations ?? {},
    spec: resource.spec,
  };
}

function entityBody(entity: ResourceEntity): Record<string, unknown> {
  return { labels: entity.labels ?? {}, annotations: entity.annotations ?? {}, spec: entity.spec };
}

/** In-memory resource row for previews. */
function previewEntity(resource: Resource, base?: ResourceEntity): ResourceEntity {
  return Object.assign(new ResourceEntity(), base ?? {}, {
    kind: resource.kind,
    name: resource.metadata.name,
    project: resource.metadata.project ?? null,
    projectKey: resource.metadata.project ?? '',
    labels: resource.metadata.labels ?? {},
    annotations: resource.metadata.annotations ?? {},
    spec: resource.spec as Record<string, unknown>,
  });
}

/**
 * Plan → apply for declarative resources (P3, 3.8). A plan records the generation of every resource it
 * touches; apply locks exactly those resources and refuses if any of them changed in between.
 * Approvals, failure analysis and automatic rollback build on this in M5.
 */
/** Images from registries without a mirror are pulled by every node directly (3.22): no cache, upstream outages hit. */
export function uncachedImageWarnings(
  parsed: WorkloadPlan['parsed'],
  registry: ClusterSpec['registry'],
): Record<string, unknown>[] {
  const mirrored = new Set(registry.mirrors.map((m) => m.host));

  return parsed.flatMap((d) =>
    d.compose.services.flatMap((s) => {
      const host = parseImageReference(s.image)?.host;

      return host && host !== PRIVATE_REGISTRY_HOST && !mirrored.has(host)
        ? [
            {
              level: 'warning',
              project: d.project,
              deployment: d.name,
              path: `services.${s.name}.image`,
              message: `${host} is not mirrored by the built-in registry; nodes pull from it directly`,
            },
          ]
        : [];
    }),
  );
}

@Injectable()
export class PlansService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resources: ResourcesRepository,
    private readonly store: ResourceStoreService,
    private readonly access: ClusterAccessService,
    private readonly audit: AuditLogService,
    private readonly network: NetworkStateService,
    private readonly planner: WorkloadPlannerService,
    private readonly images: ImageResolverService,
    private readonly secrets: SecretsService,
    private readonly registryTokens: RegistryTokenService,
    private readonly publicAddresses: PublicAddressService,
    private readonly dns: DnsService,
    private readonly rpki: RpkiCheckService,
    private readonly install: InstallService,
    private readonly imagePolicies: ImagePolicyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly operations: ApplyOperationService,
    private readonly gitScopes: GitScopeService,
    private readonly events: ChangeEventsService,
  ) {
    // A failed rollback gets a proposed fix-forward plan from the actual state (3.19).
    this.operations.onRollbackFailed = (plan) => this.createFixForward(plan);
  }

  /**
   * The fix-forward plan of a failed rollback: the original target state again, planned against what is stored now,
   * by the original author's roles. Only it may take over the failed plan's locks.
   */
  async createFixForward(failed: PlanEntity): Promise<void> {
    const touched = failed.changes.filter((c) => c.action !== 'unchanged');
    const submitted = touched
      .filter((c) => c.after)
      .map((c) => {
        const body = c.after as {
          labels: Record<string, string>;
          annotations: Record<string, string>;
          spec: Record<string, unknown>;
        };

        return normalizeResource({
          apiVersion: 'loadweaver.com/v1',
          kind: c.kind as ResourceKind,
          metadata: {
            name: c.name,
            ...(c.project ? { project: c.project } : {}),
            ...(Object.keys(body.labels ?? {}).length ? { labels: body.labels } : {}),
            ...(Object.keys(body.annotations ?? {}).length ? { annotations: body.annotations } : {}),
          },
          spec: body.spec,
        } as Resource);
      });
    const current = await Promise.all(
      touched
        .filter((c) => !c.after)
        .map(async (c) => ((await this.resources.findOne(c.kind, c.name, c.project)) ? c : null)),
    );
    const deletions = current.flatMap((c) =>
      c ? [{ kind: c.kind, name: c.name, ...(c.project ? { project: c.project } : {}) }] : [],
    );

    if (submitted.length === 0 && deletions.length === 0) return;

    await this.build(submitted, deletions, [], {
      createdBy: failed.createdBy ?? 'system',
      roles: async () => failed.creatorRoles ?? {},
      resolves: failed.id,
      source: { kind: 'system' },
    });
  }

  /** Stops a running apply at the next safe point; it rolls back (3.19). */
  async cancel(id: string, req?: RequestWithUser): Promise<PlanResponseDto> {
    const repo = this.dataSource.getRepository(PlanEntity);
    const plan = await repo.findOne({ where: { id } });

    if (!plan) throw new NotFoundException('plan not found');

    await this.assertMayChange(req, plan.changes);

    if (plan.status !== 'applying') throw new ConflictException(`plan is ${plan.status}`);

    await repo.update({ id }, { cancelRequested: true });
    await this.audit.recordStandalone({ actor: actorFromRequest(req), action: 'plan.cancel', target: `plan/${id}` });

    return await this.respond(await this.operations.waitFor(id, 5_000), await this.approvals([id]));
  }

  /** Reads signatures of a private image through the members (lazily: the token is fetched on first use). */
  private privateReader(manager: EntityManager, image: string): RepositoryReader {
    const ref = parseImageReference(image);
    let reader: Promise<RepositoryReader> | null = null;
    const open = () =>
      (reader ??= (async () => {
        const members = await manager
          .getRepository(NodeEntity)
          .find({ where: { controlPlane: true, lifecycle: Not('left') }, order: { name: 'ASC' } });
        const endpoints = members
          .map((n) => nodeAddress(n))
          .filter((a): a is string => !!a)
          .map((a) => `${a}:${REGISTRY_PRIVATE_PORT}`);
        const token = await this.registryTokens.issue(
          'control-plane:plans',
          [{ name: ref?.repository ?? '', actions: ['pull'] }],
          60,
        );

        return this.images.clusterReader(image, endpoints, token);
      })());

    return {
      manifest: async (reference, accept) => (await open()).manifest(reference, accept),
      blob: async (digest) => (await open()).blob(digest),
      blobPrefix: async (digest, bytes) => {
        const opened = await open();

        if (!opened.blobPrefix) throw new Error('blob prefixes not supported');

        return await opened.blobPrefix(digest, bytes);
      },
    };
  }

  /** Members' private registry endpoints (overlay) and a short pull token for one repository. */
  private async resolvePrivateImage(manager: EntityManager, image: string): Promise<string> {
    const ref = parseImageReference(image);

    if (!ref || ref.digest) return image;

    const members = await manager
      .getRepository(NodeEntity)
      .find({ where: { controlPlane: true, lifecycle: Not('left') }, order: { name: 'ASC' } });
    const endpoints = members
      .map((n) => nodeAddress(n))
      .filter((a): a is string => !!a)
      .map((a) => `${a}:${REGISTRY_PRIVATE_PORT}`);
    const token = await this.registryTokens.issue(
      'control-plane:plans',
      [{ name: ref.repository, actions: ['pull'] }],
      60,
    );

    return await this.images.resolveInCluster(image, endpoints, token);
  }

  /**
   * Who may plan / apply what (3.17): cluster-level resources need infra rights (the cluster and projects need
   * cluster admins), project resources at least the developer role in that project.
   */
  private async assertMayChange(
    req: RequestWithUser | undefined,
    changes: readonly { action: string; kind: string; project: string | null }[],
  ): Promise<AccessCaller> {
    const caller = await this.projectAccess.caller(req);
    const requirements = planRequirements(changes);

    if (requirements.cluster) await this.access.assert(req, requirements.cluster);

    for (const project of requirements.projects)
      if (!atLeast(projectRole(caller, project), 'developer'))
        throw new ForbiddenException(`project ${project}: developer role or higher required`);

    return caller;
  }

  /** Why the caller may not plan / apply these changes (3.17), or null if they may. */
  async mayChange(
    req: RequestWithUser | undefined,
    changes: readonly { action: string; kind: string; project: string | null }[],
  ): Promise<string | null> {
    try {
      await this.assertMayChange(req, changes);

      return null;
    } catch (error) {
      if (error instanceof ForbiddenException) return error.message;

      throw error;
    }
  }

  /**
   * A UI / API plan of an authoritative scope is replaced by the plan of its pull request (3.29 / 3.30): discarded with
   * a reference both ways, so the plan list shows where it went.
   */
  async supersede(id: string, by: string, pullRequest: { connection: string; number: number }): Promise<boolean> {
    const done = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PlanEntity);
      const plan = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      // Only the pull request Loadweaver opened for this plan replaces it (a branch name alone proves nothing).
      if (
        !plan ||
        plan.status !== 'pending' ||
        !plan.source ||
        plan.source.kind === 'git' ||
        !plan.source.pullRequests?.some(
          (p) => p.connection === pullRequest.connection && p.number === pullRequest.number,
        )
      )
        return false;

      plan.status = 'discarded';
      plan.source = { ...plan.source, supersededBy: by };
      await repo.save(plan);

      const next = await repo.findOne({ where: { id: by }, lock: { mode: 'pessimistic_write' } });

      if (next?.source) await repo.update({ id: by }, { source: { ...next.source, supersedes: id } });

      await this.audit.record(manager, {
        actor: { type: 'system', id: null },
        action: 'plan.superseded',
        target: `plan/${id}`,
        details: { by },
      });

      return true;
    });

    if (done) this.events.planStatus(id, 'discarded');

    return done;
  }

  private planVisible(caller: AccessCaller, plan: Pick<PlanEntity, 'changes'>): boolean {
    return planVisibleTo(caller, plan.changes);
  }

  /**
   * Plans the submitted documents / deletions / refreshes. `dryRun` (3.36 B2) builds the same plan — diff, network /
   * workload preview, failure analysis, risk, warnings — without storing it and without events or notifications.
   */
  async create(
    dto: CreatePlanDto,
    req?: RequestWithUser,
    origin: { kind?: 'drift'; draft?: { id: string; title: string } } = {},
  ): Promise<PlanResponseDto> {
    const submitted: Resource[] = [];

    if (dto.documents) {
      const parsed = parseResourceDocuments(dto.documents);

      if (parsed.ok === false) throw new BadRequestException({ message: 'Invalid resources', issues: parsed.issues });

      submitted.push(...parsed.resources.map(normalizeResource));
    }

    // `cluster` names the cluster-wide scope (reports, overview), so no project may take it; `lw-vm` holds VMs.
    const reserved = reservedNameIssue(submitted);

    if (reserved) throw new BadRequestException(reserved);

    const deletions = dto.delete ?? [];
    const refresh = (dto.refresh ?? []).filter((r) => r.kind === 'Deployment' && r.project);

    if (submitted.length === 0 && deletions.length === 0 && refresh.length === 0)
      throw new BadRequestException('nothing to plan');

    // Rights first: the diff must not reveal what exists in projects the caller can't change.
    await this.assertMayChange(req, [
      ...submitted.map((r) => ({ action: 'update', kind: r.kind, project: r.metadata.project ?? null })),
      ...deletions.map((d) => ({ action: 'delete', kind: d.kind, project: d.project ?? null })),
      ...refresh.map((r) => ({ action: 'update', kind: r.kind, project: r.project ?? null })),
    ]);

    const actor = actorFromRequest(req);
    // A verified fleet person (3.24) is the author, not the fleet's service user.
    const author = actor.person ?? actor.id;
    const plan = await this.build(submitted, deletions, refresh, {
      dryRun: dto.dryRun === true,
      createdBy: author ?? actor.type,
      roles: async (changes) => {
        const caller = await this.assertMayChange(req, changes);

        return Object.fromEntries(
          planRequirements(changes).projects.map((p) => [p, projectRole(caller, p) ?? 'viewer']),
        );
      },
      source: {
        kind: origin.kind ?? requestSourceKind(req),
        ...(author ? { author } : {}),
        ...(origin.draft ? { draft: origin.draft } : {}),
      },
    });

    if (dto.dryRun === true) return { ...(await this.respond(plan)), dryRun: true };

    // Authoritative Git scopes turn the plan into a pull request (3.29); the link is part of the response.
    await this.events.planCreated(plan);

    const stored = await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: plan.id } });

    return await this.respond(stored ?? plan);
  }

  /**
   * A plan from a Git commit (3.29): the commit's changed resources and the scope's resources missing in Git, with
   * conflict warnings. Git authors aren't Loadweaver users: the plan counts as a developer's in every touched project
   * (approval rules apply), and whoever applies it needs the rights for it.
   */
  async createFromGit(input: {
    submitted: Resource[];
    deletions: ResourceRefDto[];
    warnings: Record<string, unknown>[];
    source: PlanSource;
  }): Promise<PlanEntity> {
    const submitted = input.submitted.map(normalizeResource);
    const reserved = reservedNameIssue(submitted);

    if (reserved) throw new BadRequestException(reserved);

    return await this.build(submitted, input.deletions, [], {
      createdBy: 'git',
      roles: async (changes) => Object.fromEntries(planRequirements(changes).projects.map((p) => [p, 'developer'])),
      source: input.source,
      warnings: input.warnings,
    });
  }

  /** Builds a plan: the diff, its preview (network, workloads, DNS, failure analysis) and access data. */
  private async build(
    submitted: Resource[],
    deletions: ResourceRefDto[],
    refresh: ResourceRefDto[],
    author: {
      /** Build only (3.36 B2): the plan is returned unsaved. */
      dryRun?: boolean;
      createdBy: string;
      /** The author's role per touched project (also where rights on the actual diff are checked). */
      roles: (changes: PlanResourceChange[]) => Promise<Record<string, string>>;
      resolves?: string;
      source: PlanSource;
      /** Extra warnings (e.g. `git-conflict`). */
      warnings?: Record<string, unknown>[];
    },
  ): Promise<PlanEntity> {
    const changes: PlanResourceChange[] = [];
    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });

    for (const resource of submitted) {
      const current = await this.resources.findOne(
        resource.kind,
        resource.metadata.name,
        resource.metadata.project ?? null,
      );

      if (!current && resource.kind === 'Cluster')
        throw new BadRequestException('the cluster resource can only be updated');

      if (!current && resource.kind === 'Node')
        throw new BadRequestException(`node ${resource.metadata.name} has not joined; nodes join with a token`);

      if (resource.kind === 'Node') await this.assertSiteExists((resource as Resource<'Node'>).spec.site, submitted);

      const after = resourceBody(resource);
      const before = current ? entityBody(current) : null;

      changes.push({
        action: !current ? 'create' : canonicalJson(before) === canonicalJson(after) ? 'unchanged' : 'update',
        kind: resource.kind,
        name: resource.metadata.name,
        project: resource.metadata.project ?? null,
        baseGeneration: current?.generation ?? 0,
        before,
        after,
      });
    }

    for (const ref of deletions) {
      this.assertDeletable(ref, nodes);

      const current = await this.resources.findOne(ref.kind, ref.name, ref.project ?? null);

      if (!current) throw new NotFoundException(`${ref.kind} ${ref.name} does not exist`);

      changes.push({
        action: 'delete',
        kind: ref.kind,
        name: ref.name,
        project: ref.project ?? null,
        baseGeneration: current.generation,
        before: entityBody(current),
        after: null,
      });
    }

    const creatorRoles = await author.roles(changes);

    const touchesNetwork =
      changes.some((c) => c.action !== 'unchanged' && NETWORK_KINDS.has(c.kind)) || refresh.length > 0;
    const toResolve = new Set([
      ...submitted.filter((r) => r.kind === 'Deployment').map((r) => `${r.metadata.project}/${r.metadata.name}`),
      // A project's VMs are pinned per VM (3.35): only the submitted ones are re-resolved.
      ...submitted
        .filter((r) => r.kind === 'VirtualMachine')
        .map((r) => `${r.metadata.project}/${VM_DEPLOYMENT_NAME}/${r.metadata.name}`),
      ...refresh.map((r) => `${r.project}/${r.name}`),
    ]);
    const preview: Preview = touchesNetwork
      ? await this.preview(
          submitted,
          deletions,
          // Status pages share the hostname check of the exposures (3.25), which runs with the workload preview.
          changes.some((c) => c.action !== 'unchanged' && (WORKLOAD_KINDS.has(c.kind) || c.kind === 'StatusPage')) ||
            refresh.length > 0,
          toResolve,
          // Only pins of deployments this plan creates or changes need a confirm; existing ones were confirmed.
          new Set(
            changes
              .filter((c) => c.kind === 'Deployment' && (c.action === 'create' || c.action === 'update'))
              .map((c) => `${c.project}/${c.name}`),
          ),
        )
      : {
          deploymentStates: {},
          networkChanges: [],
          diagnostics: [],
          workloadChanges: [],
          failureAnalysis: null,
          warnings: [],
          risk: {},
        };
    // Why a project's part is risky (the `risky` approval mode): pins, internet exposure.
    const projects = await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Project' } });
    const changedDeployments = changes
      .filter((c) => c.kind === 'Deployment' && c.project && c.after)
      .map(
        (c) =>
          ({
            kind: 'Deployment',
            name: c.name,
            project: c.project,
            spec: (c.after as { spec: Record<string, unknown> }).spec,
          }) as ResourceEntity,
      );

    // Backups (3.20): a policy without a confirmed recovery kit or without an external target is a pin.
    if (changes.some((c) => c.action !== 'unchanged' && (c.kind === 'BackupPolicy' || c.kind === 'BackupTarget')))
      preview.warnings.push(...(await this.backupPinWarnings(changes)));

    // Platform backups (3.20): shortened retention waits for a second admin + delay; no external copy is a pin.
    preview.warnings.push(...(await platformPlanWarnings(this.dataSource, changes, deletionDelayMs() / 3_600_000)));

    preview.risk = planRisk(changes, preview.warnings, this.planner.parse([...projects, ...changedDeployments]).parsed);

    // No workload preview: copies the apply adds anyway (held back while a node was joining) are listed (M6 gate).
    if (!preview.failureAnalysis) {
      try {
        const copies = await this.dataSource.transaction('REPEATABLE READ', (manager: EntityManager) =>
          this.pendingVolumeCopies(manager),
        );

        preview.workloadChanges.push(...((copies ?? []) as unknown as Record<string, unknown>[]));
      } catch {
        // The listing is informational; the apply decides on its own re-plan.
      }
    }

    const repo = this.dataSource.getRepository(PlanEntity);
    const built = repo.create({
      status: 'pending',
      changes,
      networkChanges: preview.networkChanges,
      diagnostics: preview.diagnostics,
      workloadChanges: preview.workloadChanges,
      deploymentStates: preview.deploymentStates,
      failureAnalysis: preview.failureAnalysis,
      warnings: [...(author.warnings ?? []), ...preview.warnings],
      createdBy: author.createdBy,
      // Approvals depend on who planned (3.17): their role per touched project, now.
      creatorRoles,
      risk: preview.risk,
      resolves: author.resolves ?? null,
      source: author.source,
    });

    if (author.dryRun)
      return Object.assign(built, { id: DRY_RUN_PLAN_ID, createdAt: new Date(), appliedAt: null, error: null });

    return await repo.save(built);
  }

  private async backupPinWarnings(changes: readonly PlanResourceChange[]): Promise<Record<string, unknown>[]> {
    const count = async (kind: 'BackupPolicy' | 'BackupTarget') =>
      (await this.dataSource.getRepository(ResourceEntity).count({ where: { kind } })) +
      changes.filter((c) => c.kind === kind && c.action === 'create').length -
      changes.filter((c) => c.kind === kind && c.action === 'delete').length;
    const key = await this.dataSource.getRepository(BackupKeyEntity).findOne({ where: { active: true } });

    return backupPins(
      { generation: key?.generation ?? null, kitConfirmed: !!key?.kitConfirmedAt, escrowed: !!key?.escrow },
      await count('BackupTarget'),
      await count('BackupPolicy'),
    ).map((message) => ({ level: 'warning', path: 'backups', message, pin: true }));
  }

  private async assertSiteExists(site: string, submitted: Resource[]): Promise<void> {
    if (submitted.some((r) => r.kind === 'Site' && r.metadata.name === site)) return;

    if (!(await this.resources.findOne('Site', site, null)))
      throw new BadRequestException(`site ${site} does not exist`);
  }

  private assertDeletable(ref: ResourceRefDto, nodes: NodeEntity[]): void {
    if (!(ref.kind in RESOURCE_KINDS)) throw new BadRequestException(`unknown kind ${ref.kind}`);

    if (ref.kind === 'Cluster') throw new BadRequestException('the cluster resource cannot be deleted');

    if (ref.kind === 'Node')
      throw new BadRequestException('nodes are removed by draining and leaving, not by deleting their resource');

    if (ref.kind === 'Site' && nodes.some((n) => n.site === ref.name))
      throw new ConflictException(`site ${ref.name} still has nodes`);
  }

  /** Desired state after the plan, as in-memory rows (nothing is written). */
  private async afterState(
    manager: EntityManager,
    submitted: Resource[],
    deletions: ResourceRefDto[],
  ): Promise<{ before: ResourceEntity[]; after: ResourceEntity[]; nodes: NodeEntity[]; nodesAfter: NodeEntity[] }> {
    const before = await manager.getRepository(ResourceEntity).find();
    const nodes = await manager
      .getRepository(NodeEntity)
      .find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } });
    const key = (kind: string, name: string, project: string | null | undefined) => `${kind}/${project ?? ''}/${name}`;
    const after = new Map(before.map((r) => [key(r.kind, r.name, r.project), r]));

    for (const resource of submitted) {
      const k = key(resource.kind, resource.metadata.name, resource.metadata.project);

      after.set(k, previewEntity(resource, after.get(k)));
    }

    deletions.forEach((d) => after.delete(key(d.kind, d.name, d.project)));

    const nodesAfter = nodes.map((n) => {
      const resource = after.get(key('Node', n.name, null));

      // A join plan in this plan makes its pending node schedulable for the imported deployments (3.21).
      if (n.lifecycle === 'pending' && after.get(key('NodeImport', n.name, null)))
        return Object.assign(new NodeEntity(), n, { lifecycle: 'importing' });

      return resource
        ? Object.assign(new NodeEntity(), n, {
            labels: (resource.spec['labels'] as Record<string, string>) ?? n.labels,
            site: (resource.spec['site'] as string) ?? n.site,
            lifecycle: resource.spec['unschedulable'] && n.lifecycle === 'active' ? 'cordoned' : n.lifecycle,
          })
        : n;
    });

    return { before, after: [...after.values()], nodes, nodesAfter };
  }

  /** Pins images to digests and secrets to versions for the deployments this plan changes or refreshes (3.22). */
  private async resolveDeployments(
    manager: EntityManager,
    workload: WorkloadPlan,
    toResolve: ReadonlySet<string>,
    nodes: readonly NodeEntity[] = [],
    warnings: Record<string, unknown>[] = [],
  ): Promise<DeploymentStates> {
    const states: DeploymentStates = {};
    const errors: Record<string, unknown>[] = [];
    const arch = workloadArch(nodes);
    const arches = workloadArches(nodes);

    for (const deployment of workload.parsed) {
      const id = `${deployment.project}/${deployment.name}`;
      const vms = deployment.virtualMachines;
      // VMs: only the submitted ones are re-pinned, the others keep their pins (3.35).
      const changedVms = vms ? Object.keys(vms).filter((vm) => toResolve.has(`${id}/${vm}`)) : [];

      if (!toResolve.has(id) && changedVms.length === 0) continue;

      const previous = vms ? await manager.getRepository(DeploymentStateEntity).findOne({ where: { id } }) : null;
      const images: Record<string, string> = {};
      const imageConfigs: Record<string, ImageInspection> = {};

      for (const service of deployment.compose.services) {
        const kept = previous?.images[service.name];

        if (vms && !toResolve.has(id) && !changedVms.includes(service.name) && kept) {
          images[service.name] = kept;

          const inspection = previous?.imageConfigs?.[service.name];

          if (inspection) imageConfigs[service.name] = inspection;

          continue;
        }

        try {
          images[service.name] =
            parseImageReference(service.image)?.host === PRIVATE_REGISTRY_HOST
              ? await this.resolvePrivateImage(manager, service.image)
              : await this.images.resolve(service.image);

          // MicroVMs and VMs (3.35): labels, process config and layers, or the VM disk, read once at plan time.
          const vm = vms?.[service.name];

          if (vm || service.runtime === 'microvm') {
            const image = images[service.name];
            const reader =
              parseImageReference(image)?.host === PRIVATE_REGISTRY_HOST
                ? this.privateReader(manager, image)
                : this.images.publicReader(image);
            // VM images are single-arch artifacts; microVM guest images are inspected for every cluster architecture.
            const { inspection, missing } = vm
              ? { inspection: await inspectVmImage(reader, image, arch), missing: [] as string[] }
              : await inspectImageArchitectures(reader, image, arches);
            const issues = vm
              ? vmImageIssues(vm, inspection)
              : microvmIssues(service, inspection).map((i) => ({
                  ...i,
                  project: deployment.project,
                  deployment: deployment.name,
                }));

            imageConfigs[service.name] = inspection;
            errors.push(...issues.filter((i) => i.level === 'error').map((i) => ({ ...i })));
            warnings.push(...issues.filter((i) => i.level !== 'error').map((i) => ({ ...i })));

            // Architectures of the cluster the image lacks: the scheduler keeps the replicas off those nodes.
            const lacking = vm ? arches.filter((a) => a !== inspection.vmImage?.arch) : missing;

            if (lacking.length > 0)
              warnings.push({
                level: 'warning',
                project: deployment.project,
                deployment: deployment.name,
                path: `services.${service.name}.image`,
                message: `${service.image} has no ${lacking.map((a) => `linux/${a}`).join(', ')} variant; its replicas avoid the ${lacking.join(', ')} nodes`,
              });
          }
        } catch (error) {
          errors.push({
            level: 'error',
            project: deployment.project,
            deployment: deployment.name,
            path: `services.${service.name}.image`,
            message: error instanceof Error ? error.message : 'image not resolvable',
          });
        }
      }

      const refs = [...deployment.compose.secrets, ...deployment.compose.configs].map((s) => s.ref);
      const secretVersions = await this.secrets.latestVersions(refs);

      for (const ref of refs) {
        if (!secretVersions[ref])
          errors.push({
            level: 'error',
            project: deployment.project,
            deployment: deployment.name,
            path: 'secrets',
            message: `${ref} has no value yet; set it before applying`,
          });
      }

      // VM user data (3.35): every unpinned `secret://` ref gets its latest version per VM (kept for VMs not re-pinned).
      if (vms) {
        const pins = await pinVmSecrets(
          vms,
          (vm) => toResolve.has(id) || changedVms.includes(vm),
          previous?.secretVersions,
          (vmRefs) => this.secrets.latestVersions(vmRefs),
        );

        Object.assign(secretVersions, pins.versions);

        for (const { vm, ref } of pins.missing)
          errors.push({
            level: 'error',
            project: deployment.project,
            deployment: deployment.name,
            path: `${vm}.spec.cloudInit`,
            message: `${ref} has no value yet; set it before applying`,
          });
      }

      states[id] = { images, secretVersions, ...(Object.keys(imageConfigs).length > 0 ? { imageConfigs } : {}) };
    }

    if (errors.length > 0) throw new BadRequestException({ message: 'The plan cannot be applied', issues: errors });

    return states;
  }

  /**
   * Plans workloads (schedule, failure analysis, 3.11 / 3.12) and compiles the network before and after the change
   * for the plan's per-layer effects (3.3). Compose errors and replicas that don't fit reject the plan.
   */
  private async preview(
    submitted: Resource[],
    deletions: ResourceRefDto[],
    planWorkloads: boolean,
    toResolve: ReadonlySet<string>,
    confirmable: ReadonlySet<string>,
  ): Promise<Preview> {
    const bgpChanged = [...submitted.map((r) => r.kind), ...deletions.map((d) => d.kind)].some(
      (k) => k === 'AutonomousSystem' || k === 'BgpAnnouncement',
    );

    return await this.dataSource.transaction('REPEATABLE READ', async (manager: EntityManager) => {
      const cluster = await manager.getRepository(ClusterEntity).findOneOrFail({ where: {} });
      const state = await this.afterState(manager, submitted, deletions);
      const currentContext: WorkloadContext = {
        parsed: this.planner.parse(state.before).parsed,
        placements: await manager.getRepository(WorkloadPlacementEntity).find(),
        services: await manager.getRepository(ServiceAddressEntity).find(),
        podSubnets: podSubnetsOf(state.nodes),
      };
      let nextContext = currentContext;
      let deploymentStates: DeploymentStates = {};
      let workload: WorkloadPlan | null = null;
      const warnings: Record<string, unknown>[] = [];

      if (planWorkloads) {
        workload = await this.planner.plan(manager, state.after, state.nodesAfter);

        const errors = [
          ...workload.issues.filter((i) => i.level === 'error'),
          ...workload.schedule.unschedulable.map((u) => ({
            level: 'error',
            project: u.service.split('/')[0],
            deployment: u.service.split('/')[1],
            path: u.replica ?? u.service,
            message: u.reason,
          })),
        ];

        if (errors.length > 0) throw new BadRequestException({ message: 'The plan cannot be applied', issues: errors });

        warnings.push(
          ...workload.issues.map((i) => ({
            ...i,
            ...(i.message.startsWith('unacknowledged') && confirmable.has(`${i.project}/${i.deployment}`)
              ? { pin: true }
              : {}),
          })),
        );

        deploymentStates = await this.resolveDeployments(manager, workload, toResolve, state.nodesAfter, warnings);

        // Image architectures (3.35): freshly pinned microVM / VM images may rule out nodes of other architectures,
        // so the placements are planned again with them (the apply re-plans with the same pinned states).
        if (Object.values(deploymentStates).some((d) => d.imageConfigs)) {
          workload = await this.planner.plan(manager, state.after, state.nodesAfter, deploymentStates);

          const unschedulable = workload.schedule.unschedulable.map((u) => ({
            level: 'error',
            project: u.service.split('/')[0],
            deployment: u.service.split('/')[1],
            path: u.replica ?? u.service,
            message: u.reason,
          }));

          if (unschedulable.length > 0)
            throw new BadRequestException({ message: 'The plan cannot be applied', issues: unschedulable });
        }

        // Image policies (3.22) on the pinned digests of the deployments this plan changes.
        const imageIssues = await this.imagePolicies.evaluate(
          manager,
          workload.parsed
            // Every deployment whose images this plan pinned (VMs are pinned per VM, 3.35).
            .filter((d) => !!deploymentStates[`${d.project}/${d.name}`])
            .flatMap((d) =>
              d.compose.services.flatMap((service) => {
                const image = deploymentStates[`${d.project}/${d.name}`]?.images[service.name];

                return image
                  ? [
                      {
                        project: d.project,
                        deployment: d.name,
                        service: service.name,
                        labels: workloadLabels(d.project, d.name, service, 0),
                        image,
                      },
                    ]
                  : [];
              }),
            ),
          state.after
            .filter((r) => r.kind === 'ImagePolicy')
            .map((r) => ({ project: r.project ?? undefined, name: r.name, spec: imagePolicySpecSchema.parse(r.spec) })),
          (image) =>
            parseImageReference(image)?.host === PRIVATE_REGISTRY_HOST
              ? this.privateReader(manager, image)
              : this.images.publicReader(image),
        );

        if (imageIssues.some((i) => i.level === 'error'))
          throw new BadRequestException({
            message: 'The plan cannot be applied',
            issues: imageIssues.filter((i) => i.level === 'error'),
          });

        warnings.push(...imageIssues.map((i) => ({ ...i })));

        const clusterSpec = clusterSpecSchema.parse(state.after.find((r) => r.kind === 'Cluster')?.spec);

        warnings.push(...uncachedImageWarnings(workload.parsed, clusterSpec.registry));

        // Autoscaling (3.23): the count autoscaled services run, and quotas that `max` would exceed.
        warnings.push(
          ...autoscalePlanNotes(
            workload.parsed,
            workload.autoscaled,
            projectUsage(workload.parsed, state.after, await backupBytesByProject(this.dataSource)),
            new Map(
              state.after
                .filter((r) => r.kind === 'Project')
                .map((r) => [r.name, projectSpecSchema.parse(r.spec).quota] as const),
            ),
            toResolve,
          ),
        );

        // Volume support of the nodes (3.5): DRBD 9 module and the host name DRBD's `on` sections use.
        warnings.push(
          ...volumeNodeWarnings(
            state.nodesAfter,
            new Set(workload.schedule.volumes.flatMap((v) => [v.primary, ...v.syncReplicas, ...v.remoteReplicas])),
            workload.schedule.volumes.length > 0,
          ),
        );

        // A hostname + path or a public port belongs to one service (3.6).
        const exposureErrors = collectExposures(workload.parsed, statusPageHosts(state.after)).errors;

        if (exposureErrors.length > 0) {
          throw new BadRequestException({
            message: 'The plan cannot be applied',
            issues: exposureErrors.map((message) => ({ level: 'error', path: 'exposure', message })),
          });
        }
        const podSubnets = new Map(
          state.nodesAfter.map((n) => [n.name, [n.podSubnetV4, n.podSubnetV6].filter((x): x is string => !!x)]),
        );
        const addresses = allocateWorkloadAddresses(
          workload.schedule.replicas,
          podSubnets,
          new Map(currentContext.placements.map((p) => [p.id, { node: p.node, addresses: p.addresses }])),
          new Map(),
          addressFamiliesOf(workload.parsed),
        );
        const serviceIds = workload.parsed.flatMap((d) =>
          d.compose.services.map((sv) => serviceId(d.project, d.name, sv.name)),
        );
        const services = allocateServiceAddresses(
          serviceIds,
          clusterSpec.network,
          new Map(currentContext.services.map((a) => [a.id, { v4: a.addressV4, v6: a.addressV6 }])),
        );

        const currentAddresses = new Map(currentContext.placements.map((p) => [p.id, p.addresses]));
        const choices = workload.choices;

        nextContext = {
          parsed: workload.parsed,
          placements: workload.schedule.replicas.map((r) => ({
            id: r.replica,
            node: r.node,
            // Live migration keeps the replica's addresses (3.10).
            addresses: isCheckpointMethod(choices.get(r.replica)?.method)
              ? (currentAddresses.get(r.replica) ?? [])
              : (addresses.get(r.replica) ?? []),
          })),
          services: [...services].map(([id, a]) => ({ id, addressV4: a.v4, addressV6: a.v6 })),
          podSubnets,
        };
      }

      const holders = objectStoreHolderSet(await manager.getRepository(ObjectStoreGenerationEntity).find());
      // Public addresses (3.27): unsatisfiable claims reject the plan, new assignments are listed.
      const addresses = await this.publicAddresses.plan(manager, state.after);
      const currentAddresses = await manager.getRepository(PublicAddressEntity).find();
      // Remote access (3.31): enrolled clients are no resources; both sides see the current ones.
      const vpnClients = await manager.getRepository(VpnClientEntity).find();

      // Remote access (3.31): gateways, client network and client groups must fit together.
      const remoteErrors = remoteAccessIssues(
        state.after,
        vpnClients.filter((c) => clientValid(c, Date.now())).map((c) => c.address),
      );

      if (remoteErrors.length > 0) {
        throw new BadRequestException({
          message: 'The plan cannot be applied',
          issues: remoteErrors.map((message) => ({ level: 'error', path: 'remote-access', message })),
        });
      }

      // Projects (3.17): quotas, IP pool usage rights, and other projects' groups only where they are exposed.
      const touchedProjects = [
        ...new Set([
          ...submitted.flatMap((r) =>
            r.metadata.project ? [r.metadata.project] : r.kind === 'Project' ? [r.metadata.name] : [],
          ),
          ...deletions.flatMap((d) => (d.project ? [d.project] : [])),
        ]),
      ];
      const accessErrors = [
        ...quotaIssues(
          projectUsage(
            workload?.parsed ?? this.planner.parse(state.after).parsed,
            state.after,
            // Stored backup bytes count against the storage quota (3.20).
            await backupBytesByProject(this.dataSource),
          ),
          state.after,
          touchedProjects,
        ),
        // A narrowed pool is checked against every policy using it, not only those of touched projects.
        ...poolRightIssues(
          submitted.some((r) => r.kind === 'IpPool')
            ? state.after
            : state.after.filter((r) => r.kind === 'IpPool' || touchedProjects.includes(r.project ?? '')),
        ),
        ...exposureIssues(
          state.after.filter((r) => r.kind === 'WorkloadGroup' || touchedProjects.includes(r.project ?? '')),
        ),
      ];

      if (accessErrors.length > 0) {
        throw new BadRequestException({
          message: 'The plan cannot be applied',
          issues: accessErrors.map((message) => ({ level: 'error', path: 'projects', message })),
        });
      }

      const compile = (
        resources: ResourceEntity[],
        nodeList: NodeEntity[],
        context: WorkloadContext,
        addressRows: { address: string; owner: string | null; state: string; holder: string | null }[],
      ) => {
        const clusterResource = resources.find((r) => r.kind === 'Cluster');

        if (!clusterResource) throw new ConflictException('cluster resource missing');

        const membership = computeControlPlaneMembership(
          nodeList,
          clusterSpecSchema.parse(clusterResource.spec).controlPlaneSize,
        );

        return compileNetwork({
          ...buildCompilerInput(
            cluster,
            clusterResource,
            nodeList,
            resources,
            new Set(membership.members),
            context,
            holders,
            ingressNodesOf(resources, clusterSpecSchema.parse(clusterResource.spec), nodeList),
            remoteAccessInput(resources, nodeList, vpnClients, addressRows, Date.now()),
          ),
          egress: egressGateways(addressRows),
        });
      };
      const before = compile(state.before, state.nodes, currentContext, currentAddresses);
      // New egress addresses have no holder yet: the preview assumes the one the controller will pick.
      const poolsAfter = ipPools(state.after);
      const groupsAfter = new Map(
        state.after.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
      );
      const candidatesAfter = holderNodes(state.nodesAfter, Date.now());
      const next = compile(
        state.after,
        state.nodesAfter,
        nextContext,
        addresses.rows.map((r) =>
          r.holder || !(r.owner?.startsWith('egress/') || r.owner === VPN_ADDRESS_OWNER)
            ? r
            : {
                ...r,
                holder: chooseHolder(
                  null,
                  holderCandidates(groupsAfter.get(poolsAfter.get(r.pool)?.nodeGroup ?? ''), candidatesAfter),
                ),
              },
        ),
      );

      if (addresses.errors.length > 0) {
        throw new BadRequestException({
          message: 'The plan cannot be applied',
          issues: addresses.errors.map((message) => ({ level: 'error', path: 'ipam', message })),
        });
      }

      const currentRows = (await manager.getRepository(PublicAddressEntity).find()).filter(
        (r) => r.state === 'assigned',
      );
      const assigned = new Set(currentRows.map((r) => `${r.owner}=${r.address}`));
      // DNS (3.15): what changes at the providers; double definitions reject the plan.
      const failoverStates = new Map(
        (await manager.getRepository(DnsFailoverStateEntity).find()).map((r) => [r.name, r.state]),
      );
      const dnsBefore = this.dns.desired(state.before, currentRows, failoverStates);
      const dnsAfter = this.dns.desired(state.after, addresses.rows, failoverStates);

      if (dnsAfter.errors.length > 0) {
        throw new BadRequestException({
          message: 'The plan cannot be applied',
          issues: dnsAfter.errors.map((message) => ({ level: 'error', path: 'dns', message })),
        });
      }

      // A zone with DNSSEC keys may still have a DS at the parent: moving it off hosted bind9 or deleting it would
      // leave the parent pointing at keys nobody signs with (the zone turns bogus). Off first, wait, then move.
      const signedZones = new Set(
        (await manager.getRepository(DnssecKeyEntity).find({ select: { zone: true } })).map((k) => k.zone),
      );
      const zonesAfter = dnsZones(state.after);
      const providersAfter = dnsProviders(state.after);
      const signedErrors = [...signedZones]
        .filter((name) => {
          const zone = zonesAfter.get(name);

          return !zone || providersAfter.get(zone.provider)?.type !== 'bind9';
        })
        .map(
          (name) =>
            `zone ${name} is still DNSSEC-signed (a DS may be at the parent): set dnssec: false and wait until GET /dns/dnssec lists no keys before moving or deleting it`,
        );

      if (signedErrors.length > 0) {
        throw new BadRequestException({
          message: 'The plan cannot be applied',
          issues: signedErrors.map((message) => ({ level: 'error', path: 'dns', message })),
        });
      }

      warnings.push(...dnsAfter.warnings.map((message) => ({ level: 'warning', path: 'dns', message })));

      // Egress addresses (3.27) only for a project's own workloads: routing another project's traffic through one's
      // gateway would let it observe, block or masquerade as that project.
      const egressErrors = state.after
        .filter((r) => r.kind === 'Policy' && r.project)
        .flatMap((r) => {
          const spec = policySpecSchema.parse(r.spec);

          return spec.egress && spec.from.some((p) => 'group' in p && p.project && p.project !== r.project)
            ? [`Policy ${r.project}/${r.name}: egress addresses are only for workloads of project ${r.project}`]
            : [];
        });

      if (egressErrors.length > 0) {
        throw new BadRequestException({
          message: 'The plan cannot be applied',
          issues: egressErrors.map((message) => ({ level: 'error', path: 'egress', message })),
        });
      }

      // External BGP (3.27): only held prefixes, one AS; weak setups are warned about.
      const bgp = bgpResources(state.after);
      const bgpErrors = validateBgp(bgp, ipPools(state.after));

      if (bgpErrors.length > 0) {
        throw new BadRequestException({
          message: 'The plan cannot be applied',
          issues: bgpErrors.map((message) => ({ level: 'error', path: 'bgp', message })),
        });
      }

      warnings.push(
        ...bgpWarnings(
          bgp,
          ipPools(state.after),
          new Map(
            state.after.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
          ),
          state.nodesAfter,
          collectExposures(this.planner.parse(state.after).parsed).forwards.length > 0,
        ).map((message) => ({
          level: 'warning',
          path: 'bgp',
          message,
        })),
      );

      // ROAs for what is announced (3.27); lookups only when BGP resources change, never blocking.
      if (bgpChanged)
        warnings.push(
          ...(
            await this.rpki.warnings(
              bgp.as?.asn,
              [...bgp.announcements.values()].flatMap((a) => a.prefixes),
            )
          ).map((message) => ({ level: 'warning', path: 'bgp', message })),
        );

      // Hosted zones: delegation needs two name servers, ideally in two sites (3.15, a pin otherwise).
      const dnsProviderSpecs = dnsProviders(state.after);
      const groupSpecs = new Map(
        state.after.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
      );

      for (const zone of dnsZones(state.after).values()) {
        const bind9 = [zone.provider, ...zone.secondaries]
          .map((p) => dnsProviderSpecs.get(p))
          .find((p) => p?.type === 'bind9');

        if (bind9)
          warnings.push(
            ...nameServerWarnings(zone, bind9Nodes(bind9, groupSpecs, state.nodesAfter)).map((message) => ({
              level: 'warning',
              path: 'dns',
              message,
            })),
          );
      }

      // DNS failover (3.28): expected recovery, probe coverage, steering prerequisites.
      warnings.push(
        ...failoverPlanNotes(
          dnsFailovers(state.after),
          state.nodesAfter.filter((n) => n.lifecycle === 'active').map((n) => ({ name: n.name, site: n.site })),
          new Set(
            state.after.filter((r) => r.kind === 'Site' && siteSpecSchema.parse(r.spec).location).map((r) => r.name),
          ),
          !!(await this.install.geoipDatabase()),
        ).map((n) => ({ level: n.level, path: 'dns', message: n.message })),
      );

      // Edge capacity (3.12, 3.27): public addresses held by a single node, or not movable at all.
      warnings.push(
        ...poolWarnings(
          ipPools(state.after),
          new Map(
            state.after.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
          ),
          holderNodes(state.nodesAfter, Date.now()),
          addresses.rows,
        ).map((message) => ({ level: 'warning', path: 'ipam', message })),
      );

      // Secondaries behind their primary (3.15), from the reconciler's last check.
      warnings.push(
        ...(await manager.getRepository(DnsZoneStatusEntity).find())
          .filter((r) => r.drift && dnsZones(state.after).has(r.zone))
          .map((r) => ({
            level: 'warning',
            path: 'dns',
            message: `zone ${dnsZones(state.after).get(r.zone)?.zone}: secondary ${r.provider} drifted from the primary: ${r.drift}`,
          })),
      );

      warnings.push(
        ...addresses.rows
          .filter((r) => r.state === 'assigned' && !assigned.has(`${r.owner}=${r.address}`))
          .map((r) => ({
            level: 'info',
            path: 'ipam',
            message: `assigns ${r.address} from pool ${r.pool} to ${r.owner}`,
          })),
      );

      return {
        deploymentStates,
        networkChanges: [
          ...(diffCompilation(before, next) as unknown as Record<string, unknown>[]),
          ...this.dns.describe(this.dns.diff(dnsBefore, dnsAfter), state.after),
          ...dnssecPlanSteps(dnsZones(state.before), dnsZones(state.after)),
        ],
        diagnostics: next.diagnostics as unknown as Record<string, unknown>[],
        workloadChanges: (workload?.changes ?? []) as unknown as Record<string, unknown>[],
        failureAnalysis: workload ? (workload.analysis as unknown as Record<string, unknown>) : null,
        warnings,
        risk: {},
      };
    });
  }

  /** A plan response with the author / approver emails (the caller already may see the plan). */
  private async respond(
    plan: PlanEntity,
    approvals: readonly PlanApprovalEntity[] = [],
    manager: Pick<EntityManager, 'getRepository'> = this.dataSource,
  ): Promise<PlanResponseDto> {
    return toPlanResponse(plan, approvals, await userEmails(manager, planUserIds([plan], approvals)));
  }

  private async approvals(planIds: readonly string[]): Promise<PlanApprovalEntity[]> {
    return planIds.length > 0
      ? await this.dataSource.getRepository(PlanApprovalEntity).find({ where: { planId: In([...planIds]) } })
      : [];
  }

  async get(id: string, req?: RequestWithUser): Promise<PlanResponseDto> {
    const caller = await this.projectAccess.caller(req);
    const plan = await this.dataSource.getRepository(PlanEntity).findOne({ where: { id } });

    if (!plan || !this.planVisible(caller, plan)) throw new NotFoundException('plan not found');

    return await this.respond(plan, await this.approvals([plan.id]));
  }

  /** Plans the caller may see (everything they touch is readable), newest first. */
  /** Newest plans the caller may see, optionally only with a status / touching a project (filtered in SQL). */
  async list(
    req?: RequestWithUser,
    limit = 50,
    filter: { status?: PlanStatus; project?: string } = {},
  ): Promise<PlanResponseDto[]> {
    const caller = await this.projectAccess.caller(req);
    const take = Math.min(Math.max(limit, 1), 200);
    const query = this.dataSource
      .getRepository(PlanEntity)
      .createQueryBuilder('p')
      .orderBy('p.created_at', 'DESC')
      .take(take * 5);

    if (filter.status) query.andWhere('p.status = :status', { status: filter.status });

    if (filter.project)
      query.andWhere(`p.changes @> :touched::jsonb`, { touched: JSON.stringify([{ project: filter.project }]) });

    const plans = (await query.getMany()).filter((p) => this.planVisible(caller, p)).slice(0, take);
    const approvals = await this.approvals(plans.map((p) => p.id));
    // One batched lookup for every author / approver of the page, only of plans the caller may see.
    const emails = await userEmails(this.dataSource, planUserIds(plans, approvals));

    return plans.map((p) =>
      toPlanResponse(
        p,
        approvals.filter((a) => a.planId === p.id),
        emails,
      ),
    );
  }

  /**
   * Approves a pending plan for every touched project where the caller is operator / admin and didn't create it
   * (3.17). The approval is bound to this plan; a re-generated plan needs a new one.
   */
  async approve(id: string, req?: RequestWithUser): Promise<PlanResponseDto> {
    // Through a fleet only with a verified person (3.24): otherwise every approval would be the service user's.
    assertFleetApprovalIdentity(req, ON_BEHALF_OF_SCOPE);

    const response = await this.dataSource.transaction(async (manager) => {
      const caller = await this.projectAccess.caller(req, manager);
      const plan = await manager
        .getRepository(PlanEntity)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!plan || !this.planVisible(caller, plan)) throw new NotFoundException('plan not found');

      if (plan.status !== 'pending') throw new ConflictException(`plan is ${plan.status}`);

      const approver = caller.userId ?? 'api-key';

      // Plans made through the fleet before identity claims carry the service user as author: native only.
      assertNotLegacyFleetItem(req, plan.createdBy, getUserFromRequest(req ?? ({} as RequestWithUser)).userId);

      // The authors of a Git change (PR author, pusher) can't approve it either (3.30).
      if ((plan.source?.authors ?? []).includes(approver))
        throw new ForbiddenException('the author of a change cannot approve it');

      // The same person can't approve their own plan — also as a fleet person with the author's verified email.
      const author = await samePerson(manager, approver, plan.createdBy);
      const projects = author
        ? []
        : planRequirements(plan.changes).projects.filter((p) =>
            validApproval({ userId: approver, role: projectRole(caller, p) }, plan.createdBy),
          );

      if (projects.length === 0)
        throw new ForbiddenException(
          'approvals need the operator or admin role in a touched project, and not the plan author',
        );

      const repo = manager.getRepository(PlanApprovalEntity);

      // Cluster-admin sessions (global admins, the API key) aren't memberships; membership approvals are re-checked.
      // Fleet persons (3.24) qualified through their capped fleet grant at approval time.
      const via = fleetIdentityOf(req) ? 'fleet' : caller.clusterRole === 'cluster-admin' ? 'cluster-admin' : 'member';

      for (const project of projects) await repo.save(repo.create({ planId: plan.id, project, userId: approver, via }));

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'plan.approve',
        target: `plan/${plan.id}`,
        details: { projects },
      });

      return await this.respond(plan, await repo.find({ where: { planId: plan.id } }), manager);
    });

    // The commit status of a Git plan follows (3.29).
    this.events.planStatus(id, 'approved');

    return response;
  }

  /** What still blocks applying: missing approvals and cross-project acceptances (3.17). */
  private async applyBlockers(
    manager: EntityManager,
    plan: PlanEntity,
    caller: AccessCaller,
    via?: 'git-bot',
  ): Promise<string[]> {
    const blockers: string[] = [];
    const approvals = await manager.getRepository(PlanApprovalEntity).find({ where: { planId: plan.id } });
    // A Git change's authors never approve it, also when the approval was recorded before they were known.
    const authors = new Set(plan.source?.authors ?? []);

    for (const project of planRequirements(plan.changes).projects) {
      const { approvalMode } = await this.projectAccess.settings(manager, project);
      const creatorRole = plan.creatorRoles?.[project] as ProjectRole | undefined;

      // Membership approvals count only while the approver still holds the operator / admin role.
      let approved = false;

      for (const a of approvals.filter(
        (x) => x.project === project && x.userId !== plan.createdBy && !authors.has(x.userId),
      )) {
        // Also a fleet person with the author's verified email is the author (3.24).
        if (await samePerson(manager, a.userId, plan.createdBy)) continue;

        if (a.via === 'cluster-admin' || a.via === 'fleet') {
          approved = true;
          continue;
        }

        const member = await manager
          .getRepository(ProjectMemberEntity)
          .findOne({ where: { project, userId: a.userId } });

        if (atLeast(member?.role, 'operator')) approved = true;
      }

      if (approvalNeeded(approvalMode, creatorRole, (plan.risk?.[project] ?? []).length > 0) && !approved)
        blockers.push(`project ${project} needs an approval from an operator or admin who didn't create the plan`);
    }

    for (const ref of crossProjectReferences(plan.changes)) {
      // Someone who may run the other side can apply it directly; otherwise that project has to accept it first.
      if (atLeast(projectRole(caller, ref.peer), 'operator')) continue;

      const acceptance = await manager
        .getRepository(PolicyAcceptanceEntity)
        .findOne({ where: { project: ref.project, policy: ref.policy, peer: ref.peer } });

      if (acceptance?.specHash !== ref.specHash)
        blockers.push(`Policy ${ref.project}/${ref.policy} reaches project ${ref.peer}, which has to accept it first`);
    }

    // Authoritative Git scopes (3.29): UI / API changes go through a pull request, not a direct apply.
    blockers.push(...(await this.gitScopes.blockers(manager, plan, { via })));

    return blockers;
  }

  /**
   * Applies a plan. `via: 'git-bot'` is set only by the plan bot (3.30), which checked mergeability first; pull request
   * plans can't be applied any other way.
   */
  async apply(
    id: string,
    req?: RequestWithUser,
    options: { confirm?: boolean; via?: 'git-bot' } = {},
  ): Promise<PlanResponseDto> {
    const actor = actorFromRequest(req);
    const plan = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PlanEntity);
      const entity = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!entity) throw new NotFoundException('plan not found');

      if (entity.status !== 'pending') throw new ConflictException(`plan is ${entity.status}`);

      const caller = await this.assertMayChange(req, entity.changes);
      const blockers = await this.applyBlockers(manager, entity, caller, options.via);

      if (blockers.length > 0) throw new ConflictException({ message: 'The plan cannot be applied yet', blockers });

      // Unacknowledged pins need an explicit confirm at apply (3.12).
      if ((entity.warnings ?? []).some((w) => w['pin'] === true) && !options.confirm) {
        throw new ConflictException(
          'the plan contains unacknowledged pins; apply with confirm: true or acknowledge them with x-loadweaver.pinned',
        );
      }

      const touched = entity.changes.filter((c) => c.action !== 'unchanged');

      // Locks (3.8): only what the diff touches; overlapping plans are rejected, a fix-forward takes over its plan's.
      await lockTable(manager);

      const scopes = lockScopes(entity.changes);
      const held: { scope: string; plan_id: string }[] = await manager.query(
        'SELECT "scope", "plan_id" FROM "lw_resource_locks"',
      );
      const conflicts = lockConflicts(
        scopes,
        held.map((l) => ({ scope: l.scope, planId: l.plan_id })),
        entity.id,
        entity.resolves,
      );

      if (conflicts.length > 0)
        throw new ConflictException({
          message: 'Resources are locked by another plan',
          locks: conflicts.map((c) => `${c.scope} (plan ${c.planId})`),
        });

      for (const scope of scopes)
        await manager.query(
          `INSERT INTO "lw_resource_locks" ("scope", "plan_id") VALUES ($1, $2)
           ON CONFLICT ("scope") DO UPDATE SET "plan_id" = EXCLUDED."plan_id", "acquired_at" = now()`,
          [scope, entity.id],
        );

      // A fix-forward holds all of its failed plan's locks while it runs; they go back if it doesn't get through.
      if (entity.resolves)
        await manager.query('UPDATE "lw_resource_locks" SET "plan_id" = $1 WHERE "plan_id" = $2', [
          entity.id,
          entity.resolves,
        ]);

      // What a rollback restores besides the resources: the deployments' pinned images / secret versions.
      const stateIds = [
        ...Object.keys(entity.deploymentStates ?? {}),
        ...touched.filter((c) => c.kind === 'Deployment' && c.action === 'delete').map((c) => `${c.project}/${c.name}`),
      ];
      const previousStates = stateIds.length
        ? await manager.getRepository(DeploymentStateEntity).find({ where: { id: In(stateIds) } })
        : [];

      entity.rollback = {
        deploymentStates: Object.fromEntries(
          stateIds.map((id) => {
            const p = previousStates.find((x) => x.id === id);

            return [
              id,
              p
                ? {
                    images: p.images,
                    secretVersions: p.secretVersions,
                    ...(p.imageConfigs && Object.keys(p.imageConfigs).length > 0
                      ? { imageConfigs: p.imageConfigs }
                      : {}),
                  }
                : null,
            ];
          }),
        ),
      };

      const baseRevision = (await manager.getRepository(ClusterEntity).findOneOrFail({ where: {} })).desiredRevision;
      const locked = await this.resources.findForUpdate(
        manager,
        touched.map((c) => ({ kind: c.kind, name: c.name, project: c.project })),
      );
      const lockedMap = new Map(locked.map((r) => [`${r.kind}/${r.projectKey}/${r.name}`, r]));

      for (const change of entity.changes) {
        const current = lockedMap.get(`${change.kind}/${change.project ?? ''}/${change.name}`);
        const generation = current?.generation ?? 0;

        if (change.action !== 'unchanged' && generation !== change.baseGeneration) {
          throw new ConflictException(
            `${change.kind} ${change.name} changed since the plan was created; create a new plan`,
          );
        }
      }

      for (const change of touched) {
        if (change.action === 'delete') {
          await this.store.remove(manager, { kind: change.kind, name: change.name, project: change.project });

          if (change.kind === 'Project') await this.projectAccess.projectDeleted(manager, change.name);

          if (change.kind === 'VirtualMachine' && change.project)
            await forgetVmOperationalState(manager, change.project, change.name);

          continue;
        }

        if (change.kind === 'Project' && change.action === 'create')
          await this.projectAccess.projectCreated(manager, change.name, entity.createdBy);

        const body = change.after as {
          labels: Record<string, string>;
          annotations: Record<string, string>;
          spec: Record<string, unknown>;
        };
        const resource = {
          apiVersion: 'loadweaver.com/v1',
          kind: change.kind as ResourceKind,
          metadata: {
            name: change.name,
            ...(change.project ? { project: change.project } : {}),
            ...(Object.keys(body.labels).length ? { labels: body.labels } : {}),
            ...(Object.keys(body.annotations).length ? { annotations: body.annotations } : {}),
          },
          spec: body.spec,
        } as Resource;

        await this.store.upsert(manager, resource, actor.id ?? actor.type);

        if (change.kind === 'Node') await syncNode(manager, resource as Resource<'Node'>);

        // Join plan of a pending node (3.21): schedulable for its imports before the re-plan below.
        if (change.kind === 'NodeImport') await syncNodeImport(manager, resource as Resource<'NodeImport'>);
      }

      if (touched.some((c) => ADDRESS_KINDS.has(c.kind))) {
        try {
          await this.publicAddresses.persist(manager, await manager.getRepository(ResourceEntity).find());
        } catch (error) {
          throw new ConflictException(`public addresses: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (
        touched.some((c) => WORKLOAD_KINDS.has(c.kind)) ||
        Object.keys(entity.deploymentStates ?? {}).length > 0 ||
        (await this.volumeCopiesPending(manager))
      ) {
        // Re-plan against the current cluster: apply exactly what was reviewed, or nothing (3.8).
        const resources = await manager.getRepository(ResourceEntity).find();
        // The plan's pinned images (not stored yet) decide the image-architecture rule as in the preview (3.35).
        const workload = await this.planner.plan(manager, resources, undefined, entity.deploymentStates ?? {});

        // The method label carries live estimates (memory, link) that drift; the method itself must still match.
        // Added volume copies are informational (M6 gate): the apply persists the volume holders it schedules now.
        const comparable = (changes: readonly Record<string, unknown>[]) =>
          changes
            .filter((c) => c['action'] !== 'copy')
            .map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'methodLabel')));

        if (
          canonicalJson(comparable(workload.changes as unknown as Record<string, unknown>[])) !==
          canonicalJson(comparable(entity.workloadChanges ?? []))
        ) {
          throw new ConflictException(
            'the cluster changed since the plan was created (placements differ); create a new plan',
          );
        }

        const clusterResource = resources.find((r) => r.kind === 'Cluster');

        await this.planner.persist(manager, workload, clusterSpecSchema.parse(clusterResource?.spec).network);

        for (const volume of workload.schedule.volumes) await this.secrets.ensureVolumeKey(volume.volume);

        const stateRepo = manager.getRepository(DeploymentStateEntity);

        for (const [stateId, state] of Object.entries(entity.deploymentStates ?? {})) {
          const previous = await stateRepo.findOne({ where: { id: stateId } });

          const generation = (previous?.generation ?? 0) + 1;

          await stateRepo.save(
            stateRepo.create({
              id: stateId,
              images: state.images,
              secretVersions: state.secretVersions,
              imageConfigs: state.imageConfigs ?? {},
              generation,
            }),
          );

          await this.gateJobs(manager, workload, stateId);
        }

        for (const change of touched.filter((c) => c.kind === 'Deployment' && c.action === 'delete')) {
          await stateRepo.delete({ id: `${change.project}/${change.name}` });
        }
      }

      // Tracked from here: the nodes have to report the new revision (3.19).
      entity.status = 'applying';
      entity.progress = initialProgress('apply', baseRevision);
      entity.trackerOwner = this.operations.owner;
      entity.trackerHeartbeatAt = new Date();
      await repo.save(entity);
      await this.audit.record(manager, {
        actor,
        action: 'plan.apply',
        target: `plan/${entity.id}`,
        details: {
          changes: touched.map((c) => ({ action: c.action, kind: c.kind, name: c.name, project: c.project })),
        },
      });

      return entity;
    });

    this.operations.start(plan.id);
    this.events.planStatus(plan.id, 'applying');

    // Quick applies come back settled; longer ones are followed live (status channel, GET /plans/:id).
    return await this.respond(await this.operations.waitFor(plan.id, 5_000), await this.approvals([plan.id]));
  }

  /**
   * Volume copies the scheduler would add or move now — e.g. ones held back while a node was joining, announced by an
   * earlier plan's "plan again once the node is ready" note (M6 gate): the apply persists them even when the plan has
   * no workload changes.
   */
  private async volumeCopiesPending(manager: EntityManager): Promise<boolean> {
    const workload = await this.planner.plan(manager, await manager.getRepository(ResourceEntity).find());

    // Only when no replica would move: the apply below then matches a plan without workload changes.
    return (
      workload.changes.every((c) => c.action === 'copy') &&
      volumeHoldersChanged((await this.planner.current(manager)).volumes, workload.schedule.volumes)
    );
  }

  /** The copies `volumeCopiesPending` would add, for the preview of a plan without workload changes (M6 gate). */
  private async pendingVolumeCopies(manager: EntityManager): Promise<VolumeCopyChange[]> {
    const workload = await this.planner.plan(manager, await manager.getRepository(ResourceEntity).find());

    return workload.changes.every((c) => c.action === 'copy')
      ? workload.changes.filter((c): c is VolumeCopyChange => c.action === 'copy')
      : [];
  }

  /**
   * One-off jobs (3.23): services wait for `before` jobs of this generation, `after` jobs wait for the services.
   */
  private async gateJobs(manager: EntityManager, workload: WorkloadPlan, deploymentId: string): Promise<void> {
    const [project, name] = deploymentId.split('/');
    const deployment = workload.parsed.find((d) => d.project === project && d.name === name);

    if (!deployment) return;

    const jobs = deployment.compose.services.filter((s) => s.kind === 'job');
    const before = new Set(jobs.filter((j) => j.jobPhase !== 'after').map((j) => j.name));
    const after = new Set(jobs.filter((j) => j.jobPhase === 'after').map((j) => j.name));
    const repo = manager.getRepository(WorkloadPlacementEntity);

    for (const placement of await repo.find({ where: { project, deployment: name } })) {
      const gate = after.has(placement.service)
        ? 'after-services'
        : !before.has(placement.service) && !after.has(placement.service) && before.size > 0
          ? 'before-jobs'
          : null;

      if (placement.gate !== gate) await repo.update({ id: placement.id }, { gate });
    }
  }

  async discard(id: string, req?: RequestWithUser): Promise<PlanResponseDto> {
    const repo = this.dataSource.getRepository(PlanEntity);
    const plan = await repo.findOne({ where: { id } });

    if (!plan) throw new NotFoundException('plan not found');

    if (plan.status !== 'pending') throw new ConflictException(`plan is ${plan.status}`);

    await this.assertMayChange(req, plan.changes);
    plan.status = 'discarded';

    const saved = await repo.save(plan);

    this.events.planStatus(id, 'discarded');

    return await this.respond(saved);
  }
}
