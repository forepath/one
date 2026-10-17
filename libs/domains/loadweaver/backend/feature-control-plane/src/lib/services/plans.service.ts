import type { RequestWithUser } from '@forepath/identity/backend';
import { compileNetwork, diffCompilation } from '@forepath/loadweaver/shared/util-policy-compiler';
import { parseImageReference } from '@forepath/loadweaver/shared/util-compose';
import {
  clusterSpecSchema,
  nodeGroupSpecSchema,
  policySpecSchema,
  imagePolicySpecSchema,
  siteSpecSchema,
  parseResourceDocuments,
  PRIVATE_REGISTRY_HOST,
  RESOURCE_KINDS,
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
import { DataSource, EntityManager, Not } from 'typeorm';

import { toPlanResponse, type CreatePlanDto, type PlanResponseDto, type ResourceRefDto } from '../dto/plan.dto';
import { ClusterEntity } from '../entities/cluster.entity';
import { NodeEntity } from '../entities/node.entity';
import { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { PlanEntity, type PlanResourceChange } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { ResourcesRepository } from '../repositories/resources.repository';
import { canonicalJson } from '../utils/canonical-json.utils';
import { computeControlPlaneMembership } from '../utils/control-plane-membership.utils';
import { actorFromRequest, AuditLogService } from './audit-log.service';
import { ClusterAccessService, type ClusterCaller } from './cluster-access.service';
import {
  buildCompilerInput,
  ingressNodesOf,
  NetworkStateService,
  objectStoreHolderSet,
  type WorkloadContext,
} from './network-state.service';
import { collectExposures } from '../ingress/ingress-state.utils';
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
import { WorkloadPlannerService, type WorkloadPlan } from './workload-planner.service';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import {
  allocateServiceAddresses,
  allocateWorkloadAddresses,
  serviceId,
  workloadLabels,
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

const NETWORK_KINDS = new Set([
  'NodeGroup',
  'WorkloadGroup',
  'Policy',
  'Cluster',
  'Node',
  'Deployment',
  'Project',
  'IpPool',
  'DnsProvider',
  'DnsZone',
  'DnsRecord',
  // Probes, answers and steering views (3.28); site locations steer by latency.
  'DnsFailover',
  'Site',
  // Vulnerability limits are part of the nodes' workload specs (3.22).
  'ImagePolicy',
  // Remote access client groups (3.31).
  'ClientGroup',
  'AutonomousSystem',
  'BgpPeer',
  'BgpAnnouncement',
]);
/** Changes to these kinds can move public addresses (3.27). */
const ADDRESS_KINDS = new Set(['Cluster', 'IpPool', 'DnsProvider', 'Policy']);
/** Changes to these kinds can move workloads (3.11). */
const WORKLOAD_KINDS = new Set(['Deployment', 'Project', 'Node', 'Cluster']);

type DeploymentStates = Record<string, { images: Record<string, string>; secretVersions: Record<string, number> }>;

interface Preview {
  deploymentStates: DeploymentStates;
  networkChanges: Record<string, unknown>[];
  diagnostics: Record<string, unknown>[];
  workloadChanges: Record<string, unknown>[];
  failureAnalysis: Record<string, unknown> | null;
  warnings: Record<string, unknown>[];
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
  ) {}

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
      manifest: async (reference) => (await open()).manifest(reference),
      blob: async (digest) => (await open()).blob(digest),
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

  /** Cluster-level resources need infra rights; project resources need cluster admin until project roles exist (M5). */
  private async assertMayChange(
    req: RequestWithUser | undefined,
    changes: PlanResourceChange[],
  ): Promise<ClusterCaller> {
    const needsAdmin = changes.some((c) => c.project !== null);

    return await this.access.assert(req, needsAdmin ? 'admin' : 'infra');
  }

  async create(dto: CreatePlanDto, req?: RequestWithUser): Promise<PlanResponseDto> {
    await this.access.assert(req, 'read');

    const submitted: Resource[] = [];

    if (dto.documents) {
      const parsed = parseResourceDocuments(dto.documents);

      if (parsed.ok === false) throw new BadRequestException({ message: 'Invalid resources', issues: parsed.issues });

      submitted.push(...parsed.resources.map(normalizeResource));
    }

    const deletions = dto.delete ?? [];
    const refresh = (dto.refresh ?? []).filter((r) => r.kind === 'Deployment' && r.project);

    if (submitted.length === 0 && deletions.length === 0 && refresh.length === 0)
      throw new BadRequestException('nothing to plan');

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

    await this.assertMayChange(req, changes);

    const touchesNetwork =
      changes.some((c) => c.action !== 'unchanged' && NETWORK_KINDS.has(c.kind)) || refresh.length > 0;
    const toResolve = new Set([
      ...submitted.filter((r) => r.kind === 'Deployment').map((r) => `${r.metadata.project}/${r.metadata.name}`),
      ...refresh.map((r) => `${r.project}/${r.name}`),
    ]);
    const preview: Preview = touchesNetwork
      ? await this.preview(
          submitted,
          deletions,
          changes.some((c) => c.action !== 'unchanged' && WORKLOAD_KINDS.has(c.kind)) || refresh.length > 0,
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
        };
    const actor = actorFromRequest(req);
    const repo = this.dataSource.getRepository(PlanEntity);
    const plan = await repo.save(
      repo.create({
        status: 'pending',
        changes,
        networkChanges: preview.networkChanges,
        diagnostics: preview.diagnostics,
        workloadChanges: preview.workloadChanges,
        deploymentStates: preview.deploymentStates,
        failureAnalysis: preview.failureAnalysis,
        warnings: preview.warnings,
        createdBy: actor.id ?? actor.type,
      }),
    );

    return toPlanResponse(plan);
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
  ): Promise<DeploymentStates> {
    const states: DeploymentStates = {};
    const errors: Record<string, unknown>[] = [];

    for (const deployment of workload.parsed) {
      const id = `${deployment.project}/${deployment.name}`;

      if (!toResolve.has(id)) continue;

      const images: Record<string, string> = {};

      for (const service of deployment.compose.services) {
        try {
          images[service.name] =
            parseImageReference(service.image)?.host === PRIVATE_REGISTRY_HOST
              ? await this.resolvePrivateImage(manager, service.image)
              : await this.images.resolve(service.image);
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

      states[id] = { images, secretVersions };
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

        deploymentStates = await this.resolveDeployments(manager, workload, toResolve);

        // Image policies (3.22) on the pinned digests of the deployments this plan changes.
        const imageIssues = await this.imagePolicies.evaluate(
          manager,
          workload.parsed
            .filter((d) => toResolve.has(`${d.project}/${d.name}`))
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

        // A hostname + path or a public port belongs to one service (3.6).
        const exposureErrors = collectExposures(workload.parsed).errors;

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
        );
        const serviceIds = workload.parsed.flatMap((d) =>
          d.compose.services.map((sv) => serviceId(d.project, d.name, sv.name)),
        );
        const services = allocateServiceAddresses(
          serviceIds,
          clusterSpec.network,
          new Map(currentContext.services.map((a) => [a.id, { v4: a.addressV4, v6: a.addressV6 }])),
        );

        nextContext = {
          parsed: workload.parsed,
          placements: workload.schedule.replicas.map((r) => ({
            id: r.replica,
            node: r.node,
            addresses: addresses.get(r.replica) ?? [],
          })),
          services: [...services].map(([id, a]) => ({ id, addressV4: a.v4, addressV6: a.v6 })),
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
      };
    });
  }

  async get(id: string, req?: RequestWithUser): Promise<PlanResponseDto> {
    await this.access.assert(req, 'read');

    const plan = await this.dataSource.getRepository(PlanEntity).findOne({ where: { id } });

    if (!plan) throw new NotFoundException('plan not found');

    return toPlanResponse(plan);
  }

  async list(req?: RequestWithUser, limit = 50): Promise<PlanResponseDto[]> {
    await this.access.assert(req, 'read');

    return (
      await this.dataSource
        .getRepository(PlanEntity)
        .find({ order: { createdAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 200) })
    ).map(toPlanResponse);
  }

  async apply(id: string, req?: RequestWithUser, options: { confirm?: boolean } = {}): Promise<PlanResponseDto> {
    const actor = actorFromRequest(req);
    const plan = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PlanEntity);
      const entity = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!entity) throw new NotFoundException('plan not found');

      if (entity.status !== 'pending') throw new ConflictException(`plan is ${entity.status}`);

      await this.assertMayChange(req, entity.changes);

      // Unacknowledged pins need an explicit confirm at apply (3.12).
      if ((entity.warnings ?? []).some((w) => w['pin'] === true) && !options.confirm) {
        throw new ConflictException(
          'the plan contains unacknowledged pins; apply with confirm: true or acknowledge them with x-loadweaver.pinned',
        );
      }

      const touched = entity.changes.filter((c) => c.action !== 'unchanged');
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
          continue;
        }

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

        if (change.kind === 'Node') await this.syncNode(manager, resource as Resource<'Node'>);
      }

      if (touched.some((c) => ADDRESS_KINDS.has(c.kind))) {
        try {
          await this.publicAddresses.persist(manager, await manager.getRepository(ResourceEntity).find());
        } catch (error) {
          throw new ConflictException(`public addresses: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (touched.some((c) => WORKLOAD_KINDS.has(c.kind)) || Object.keys(entity.deploymentStates ?? {}).length > 0) {
        // Re-plan against the current cluster: apply exactly what was reviewed, or nothing (3.8).
        const resources = await manager.getRepository(ResourceEntity).find();
        const workload = await this.planner.plan(manager, resources);

        if (canonicalJson(workload.changes) !== canonicalJson(entity.workloadChanges ?? [])) {
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
            stateRepo.create({ id: stateId, images: state.images, secretVersions: state.secretVersions, generation }),
          );

          await this.gateJobs(manager, workload, stateId);
        }

        for (const change of touched.filter((c) => c.kind === 'Deployment' && c.action === 'delete')) {
          await stateRepo.delete({ id: `${change.project}/${change.name}` });
        }
      }

      entity.status = 'applied';
      entity.appliedAt = new Date();
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

    if (plan.changes.some((c) => c.action !== 'unchanged' && NETWORK_KINDS.has(c.kind)))
      this.network.requestRecompile(`plan ${plan.id} applied`);

    return toPlanResponse(plan);
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

  /** The declarative part of a node (site, labels, cordon) lives in its `Node` resource. */
  private async syncNode(manager: EntityManager, resource: Resource<'Node'>): Promise<void> {
    const repo = manager.getRepository(NodeEntity);
    const node = await repo.findOne({ where: { name: resource.metadata.name }, lock: { mode: 'pessimistic_write' } });

    if (!node) throw new ConflictException(`node ${resource.metadata.name} is no longer part of the cluster`);

    node.site = resource.spec.site;
    node.labels = resource.spec.labels ?? {};

    if (resource.spec.unschedulable && node.lifecycle === 'active') node.lifecycle = 'cordoned';

    if (!resource.spec.unschedulable && node.lifecycle === 'cordoned') node.lifecycle = 'active';

    await repo.save(node);
  }

  async discard(id: string, req?: RequestWithUser): Promise<PlanResponseDto> {
    const caller = await this.access.resolve(req);

    if (!caller.role) throw new ForbiddenException('Missing cluster permission');

    const repo = this.dataSource.getRepository(PlanEntity);
    const plan = await repo.findOne({ where: { id } });

    if (!plan) throw new NotFoundException('plan not found');

    if (plan.status !== 'pending') throw new ConflictException(`plan is ${plan.status}`);

    await this.assertMayChange(req, plan.changes);
    plan.status = 'discarded';

    return toPlanResponse(await repo.save(plan));
  }
}
