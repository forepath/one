import {
  type AuthoritativeDns,
  volumeDockerName,
  volumeKeyRef,
  type ControlPlaneRole,
  type DesiredState,
  foldEgressPoliciesForLegacy,
  type VolumeAssignment,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  compileNetwork,
  type CompilationResult,
  type CompilerInput,
  type CompilerRemoteAccess,
  type CompilerNode,
  type CompilerService,
  type CompilerWorkload,
  type NamedWorkloadGroup,
} from '@forepath/loadweaver/shared/util-policy-compiler';
import {
  clusterSpecSchema,
  type ClusterBackups,
  type ClusterSpec,
  nodeGroupSpecSchema,
  policySpecSchema,
  workloadGroupSpecSchema,
  type DnsZoneSpec,
  imagePolicySpecSchema,
} from '@forepath/loadweaver/shared/util-model';
import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, MoreThan, Not } from 'typeorm';

import { ADVISORY_LOCK_NETWORK_COMPILE, LOG_STORE_PORTS } from '../constants/control-plane.constants';
import { ClusterEntity } from '../entities/cluster.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { assignDrbdNodeIds } from '../utils/drbd-volumes.utils';
import { ServiceAddressEntity } from '../entities/service-address.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { objectStoreRole, registryClient, registryRole } from '../object-store/registry-state.utils';
import { ensureRegistryTokenKey } from '../object-store/registry-token-key';
import { PublicAddressEntity } from '../entities/public-address.entity';
import { DnsZoneSerialEntity } from '../entities/dns-zone-serial.entity';
import { DnssecKeyEntity } from '../entities/dnssec-key.entity';
import { DnsFailoverStateEntity } from '../entities/dns-failover.entity';
import { assignProbes, dnsFailovers } from '../dns/dns-failover.utils';
import { DnsService, dnsProviders, dnsZones } from '../dns/dns.service';
import { dnssecMode } from '../dns/dnssec.utils';
import type { DnsDesiredState } from '../dns/dns-desired.utils';
import { steeringViews, type SteeredHost } from '../dns/steering.utils';
import type { NameServer } from '../dns/zone-file';
import { InstallService } from './install.service';
import { runtimeImagePolicy } from '../images/image-policy.service';
import { bind9Nodes, nameServerAddresses, zoneNameServers } from '../dns/hosted-zones.utils';
import { bgpResources, nodeExternalBgp, healthyReplicas } from '../bgp/bgp-state.utils';
import { holderCandidates } from '../ipam/public-ipam.utils';
import { nextSerial, renderZoneFile, zoneBody, zoneHash } from '../dns/zone-file';
import { AcmeChallengeEntity, CertificateEntity } from '../entities/certificate.entity';
import { ipPools } from '../ipam/public-address.service';
import { holderNodes, nodePublicAddresses } from '../ipam/public-address-state.utils';
import { egressGateways } from '../ipam/public-ipam.utils';
import { VpnClientEntity } from '../entities/vpn-client.entity';
import { ensureVpnGatewayKey } from '../remote-access/gateway-key';
import { remoteAccessInput } from '../remote-access/remote-access.utils';
import {
  collectExposures,
  platformHttpPort,
  STATUS_PAGE_SERVICE,
  statusPageHosts,
  exposeGroup,
  ingressNodeSet,
  ingressPolicies,
  ingressState,
  RATE_LIMIT_PORT,
  renderRateLimitConfig,
} from '../ingress/ingress-state.utils';
import type { HolderNode } from '../ipam/public-ipam.utils';
import { canonicalJson } from '../utils/canonical-json.utils';
import {
  buildWorkloadSpec,
  composeNetworkGroup,
  serviceId,
  workloadLabels,
  type ParsedDeployment,
} from '../utils/workload-planning.utils';
import { MasterKeyService } from './master-key.service';
import { WorkloadPlannerService } from './workload-planner.service';
import { computeControlPlaneMembership, type ControlPlaneMembership } from '../utils/control-plane-membership.utils';
import { hostRoutes, keptAddresses } from '../utils/migration-state.utils';
import { isDraining } from '../utils/replica-drain.utils';
import { IMPORT_LIFECYCLES } from '../entities/node.entity';
import { heldImportDeployments } from '../import/import-hold';
import { ReleasesService } from '../updates/releases.service';
import { activePlatformState, withPlatformState, type PlatformState } from '../backups/platform/platform-backups.role';
import { pendingReseedScopes } from '../backups/platform/platform-dr.utils';
import { BackupRepositoryEntity } from '../backups/backup.entities';
import { backupServerRole } from '../backups/backup-server-role';

export const DESIRED_STATE_CHANNEL = 'lw_desired_state';
const RECOMPILE_DEBOUNCE_MS = 250;

export interface RecompileOutcome {
  revision: number;
  changedNodes: string[];
  compilation: CompilationResult;
  membership: ControlPlaneMembership;
}

/** Running replicas and their services, the workload half of the compiler input (3.11). */
export interface WorkloadContext {
  parsed: ParsedDeployment[];
  placements: (Pick<WorkloadPlacementEntity, 'id' | 'node' | 'addresses'> &
    Partial<
      Pick<
        WorkloadPlacementEntity,
        'targetNode' | 'targetAddresses' | 'migration' | 'gate' | 'releasedSpec' | 'restored' | 'drainUntil'
      >
    >)[];
  services: Pick<ServiceAddressEntity, 'id' | 'addressV4' | 'addressV6'>[];
  /** Pinned images and secret versions per deployment (3.22). */
  states?: Pick<DeploymentStateEntity, 'id' | 'images' | 'secretVersions' | 'generation'>[];
  /** Pod subnets per node: addresses outside them were kept by a live migration (3.10). */
  podSubnets?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Where a placement runs right now (3.10): both ends during blue / green, nowhere while a short stop stops it, only
 * on the source while queued or during a checkpoint attempt (the target restores outside the desired state; the
 * placement switches over at the cut-over).
 */
export function runningCopies(
  placement: WorkloadContext['placements'][number],
): { node: string; addresses: string[]; target: boolean }[] {
  const copies: { node: string; addresses: string[]; target: boolean }[] = [];
  const stopping = placement.migration?.method === 'short-stop' && placement.migration.phase === 'stopping';

  if (!stopping) copies.push({ node: placement.node, addresses: placement.addresses, target: false });

  if (placement.targetNode && placement.migration?.method === 'blue-green' && placement.migration.phase === 'starting')
    copies.push({ node: placement.targetNode, addresses: placement.targetAddresses ?? [], target: true });

  return copies;
}

/**
 * Live-migration hints of a replica's spec on its node (3.10, gated by `live-migration`): restored from a
 * checkpoint (agent-managed until its next restart) and the host routes of addresses it kept.
 */
export function withMigrationHints(
  spec: WorkloadSpec,
  placement: WorkloadContext['placements'][number],
  node: string,
  podSubnets: ReadonlyMap<string, readonly string[]> | undefined,
): WorkloadSpec {
  const kept = podSubnets?.has(node) ? keptAddresses(spec.addresses, podSubnets.get(node) ?? []) : [];

  return {
    ...spec,
    ...(placement.restored && placement.node === node ? { restoredFrom: placement.restored } : {}),
    ...(kept.length > 0 ? { hostRoutes: hostRoutes(kept) } : {}),
  };
}

export function workloadCompilerInput(
  context: WorkloadContext,
): Pick<CompilerInput, 'workloads' | 'services' | 'workloadGroups'> {
  const workloads: CompilerWorkload[] = [];

  for (const copy of context.placements.flatMap((p) =>
    runningCopies(p).map((c) => ({
      ...p,
      node: c.node,
      addresses: c.addresses,
      copyId: c.target ? `${p.id}@${c.node}` : p.id,
    })),
  )) {
    const placement = copy;
    const [project, deployment, service, index] = placement.id.split('/');
    const parsed = context.parsed.find((d) => d.project === project && d.name === deployment);
    const spec = parsed?.compose.services.find((s) => s.name === service);

    if (!parsed || !spec) continue;

    // Addresses kept by a live migration are routed to this node as host routes (3.10).
    const kept = context.podSubnets?.has(placement.node)
      ? keptAddresses(placement.addresses, context.podSubnets.get(placement.node) ?? [])
      : [];

    workloads.push({
      id: copy.copyId,
      project,
      deployment,
      service,
      node: placement.node,
      labels: workloadLabels(project, deployment, spec, Number(index)),
      addresses: placement.addresses,
      ...(kept.length > 0 ? { keptAddresses: kept } : {}),
      // Removed and draining: keeps its policies (open connections), receives no new ones (M6 gate).
      ...(isDraining(placement) ? { draining: true } : {}),
      groups: [
        ...spec.networks.map((n) => composeNetworkGroup(deployment, n)),
        ...spec.groups,
        ...(spec.http.length > 0 || spec.ports.length > 0 ? [exposeGroup(deployment, spec.name)] : []),
      ],
    });
  }

  const services: CompilerService[] = context.parsed.flatMap((d) =>
    d.compose.services.map((s) => {
      const address = context.services.find((a) => a.id === serviceId(d.project, d.name, s.name));

      return {
        project: d.project,
        deployment: d.name,
        name: s.name,
        serviceIps: [address?.addressV4, address?.addressV6].filter((a): a is string => !!a),
      };
    }),
  );
  // A compose network = its members can talk to each other (3.11); membership is explicit, never by selector.
  const workloadGroups: NamedWorkloadGroup[] = context.parsed.flatMap((d) =>
    d.compose.networks.map((n) => ({
      project: d.project,
      name: composeNetworkGroup(d.name, n.name),
      spec: { selector: { names: [] }, intraGroup: 'allow' as const, exposed: false },
    })),
  );

  workloadGroups.push(...ingressPolicies(context.parsed).groups);

  return { workloads, services, workloadGroups };
}

/** The spec a placement should run now, honouring job gates (3.23); null = not yet. */
export function effectiveSpec(
  p: WorkloadContext['placements'][number],
  addresses: string[],
  context: WorkloadContext,
  dnsDomain: string,
): WorkloadSpec | null {
  const [project, deployment, service, index] = p.id.split('/');
  const parsed = context.parsed.find((d) => d.project === project && d.name === deployment);
  const spec = parsed?.compose.services.find((s) => s.name === service);

  // A draining replica keeps what it ran until it stops (its service may be gone or changed already).
  if (isDraining(p)) {
    const released = p.releasedSpec as WorkloadSpec | null | undefined;

    return released && released.addresses.join(',') === addresses.join(',') ? released : null;
  }

  if (!parsed || !spec || p.gate === 'after-services') return null;

  if (p.gate === 'before-jobs') {
    // Keep running what was released until the `before` jobs succeeded; a new replica waits.
    const released = p.releasedSpec as WorkloadSpec | null | undefined;

    return released && released.addresses.join(',') === addresses.join(',') ? released : null;
  }

  const pinned = context.states?.find((s) => s.id === `${project}/${deployment}`);

  return buildWorkloadSpec(parsed, spec, Number(index), addresses, dnsDomain, pinned);
}

/** Workload specs of one node, built from its placements. */
export function nodeWorkloads(node: string, context: WorkloadContext, dnsDomain: string): WorkloadSpec[] {
  return context.placements
    .flatMap((p) =>
      runningCopies(p)
        .filter((c) => c.node === node)
        .map((c) => {
          const spec = effectiveSpec(p, c.addresses, context, dnsDomain);

          return spec && !c.target ? withMigrationHints(spec, p, node, context.podSubnets) : spec;
        }),
    )
    .filter((s): s is WorkloadSpec => s !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Nodes already warned about for holding volumes without a reported host name (once per process). */
const unnamedVolumeHosts = new Set<string>();

/** Replicated volumes a node holds a copy of (3.5): DRBD node ids, per-pair protocol, the primary. */
export function nodeVolumes(
  node: string,
  placements: VolumePlacementEntity[],
  nodes: NodeEntity[],
): VolumeAssignment[] {
  const byName = new Map(nodes.map((n) => [n.name, n]));

  return placements
    .filter((v) => [v.primaryNode, ...v.syncReplicas, ...v.remoteReplicas].includes(node))
    .flatMap((v) => {
      const allHolders = [...new Set([v.primaryNode, ...v.syncReplicas, ...v.remoteReplicas])];
      // Stable ids from the placement; holders it doesn't know yet (not persisted by a plan) get free ones.
      const { ids } = assignDrbdNodeIds(allHolders, v.drbdNodeIds ?? {}, v.drbdNextNodeId ?? 0);
      const replicas = allHolders
        .filter((n) => byName.has(n))
        .map((n) => {
          const holder = byName.get(n);

          return {
            node: n,
            nodeId: ids[n],
            address: holder?.overlayV4 ?? holder?.overlayV6 ?? '',
            // DRBD's `on` sections must match the host's `uname -n`; without a reported one, the node name.
            ...(holder?.hostname ? { host: holder.hostname } : {}),
          };
        })
        .filter((r) => r.address);

      if (replicas.length === 0) return [];

      const connections: VolumeAssignment['connections'] = [];

      for (let i = 0; i < replicas.length; i++) {
        for (let j = i + 1; j < replicas.length; j++) {
          const sameSite = byName.get(replicas[i].node)?.site === byName.get(replicas[j].node)?.site;

          connections.push({
            a: replicas[i].node,
            b: replicas[j].node,
            protocol: sameSite || v.crossSite === 'sync' ? 'C' : 'A',
          });
        }
      }

      return [
        {
          id: v.id,
          dockerName: volumeDockerName(v.id),
          minor: v.drbdMinor,
          port: v.drbdPort,
          sizeBytes: Number(v.sizeBytes),
          replicas,
          connections,
          primary: v.primaryNode,
          keyRef: volumeKeyRef(v.id),
        },
      ];
    })
    .sort((a, b) => a.minor - b.minor);
}

/** Nodes running the ingress: the ingress pool's node group (3.6). */
export function ingressNodesOf(
  resources: readonly ResourceEntity[],
  spec: ClusterSpec,
  nodes: readonly NodeEntity[],
): Set<string> {
  const groups = new Map(
    resources.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
  );

  return ingressNodeSet(spec.ingress?.pool, ipPools(resources), groups, nodes);
}

/** Nodes holding object-store data (3.20); they get the built-in object-store policy. */
export function objectStoreHolderSet(
  generations: readonly Pick<ObjectStoreGenerationEntity, 'state' | 'holders'>[],
): Set<string> {
  return new Set(generations.filter((g) => g.state !== 'retired').flatMap((g) => g.holders));
}

/** Public URL of the control-plane API (registry token realm for `docker login`, 3.22). */
export function publicUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_PUBLIC_URL'] || `http://localhost:${env['PORT'] || '3400'}`;
}

function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** Builds the compiler input from the stored desired state (pure, for plans and the live compile). */
export function buildCompilerInput(
  cluster: ClusterEntity,
  clusterResource: ResourceEntity,
  nodes: NodeEntity[],
  resources: ResourceEntity[],
  controlPlaneMembers: ReadonlySet<string>,
  workloadContext?: WorkloadContext,
  objectStoreHolders: ReadonlySet<string> = new Set(),
  ingressNodes: ReadonlySet<string> = new Set(),
  remoteAccess?: CompilerRemoteAccess,
): CompilerInput {
  const spec = clusterSpecSchema.parse(clusterResource.spec);
  const compilerNodes: CompilerNode[] = nodes.map((n) => ({
    name: n.name,
    site: n.site,
    labels: { ...n.labels, 'loadweaver.com/site': n.site, 'loadweaver.com/node': n.name },
    controlPlane: controlPlaneMembers.has(n.name),
    witness: n.witness,
    overlayV4: n.overlayV4 ?? undefined,
    overlayV6: n.overlayV6 ?? undefined,
    podSubnetV4: n.podSubnetV4 ?? undefined,
    podSubnetV6: n.podSubnetV6 ?? undefined,
    endpointHost: n.endpointHost ?? undefined,
    wireguardPublicKey: n.wireguardPublicKey,
    objectStore: objectStoreHolders.has(n.name),
    ingress: ingressNodes.has(n.name),
    // Host ports found by the import discovery (3.21): WireGuard listen ports skip them.
    ...(n.reservedPorts?.udp.length ? { reservedUdpPorts: n.reservedPorts.udp } : {}),
  }));

  return {
    network: spec.network,
    nodes: compilerNodes,
    workloads: [],
    services: [],
    ...(workloadContext ? workloadCompilerInput(workloadContext) : {}),
    nodeGroups: resources
      .filter((r) => r.kind === 'NodeGroup')
      .map((r) => ({ name: r.name, spec: nodeGroupSpecSchema.parse(r.spec) })),
    workloadGroups: [
      ...resources
        .filter((r) => r.kind === 'WorkloadGroup' && r.project)
        .map((r) => ({ project: r.project as string, name: r.name, spec: workloadGroupSpecSchema.parse(r.spec) })),
      ...(workloadContext ? workloadCompilerInput(workloadContext).workloadGroups : []),
    ],
    policies: [
      ...resources
        .filter((r) => r.kind === 'Policy')
        .map((r) => ({ project: r.project ?? undefined, name: r.name, spec: policySpecSchema.parse(r.spec) })),
      ...(workloadContext ? ingressPolicies(workloadContext.parsed).policies : []),
    ],
    portAllocations: cluster.networkState?.portAllocations,
    routeReflectors: cluster.networkState?.routeReflectors,
    // Web egress filtering through the node proxies (3.7).
    egressFilter: spec.egress,
    platformPorts: { http: platformHttpPort() },
    statusPages: statusPageHosts(resources).length > 0,
    ...(remoteAccess ? { remoteAccess } : {}),
  };
}

/** Desired states are compared without their revision, which changes on every compilation. */
function withoutRevision(state: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'revision'));
}

/**
 * Settings every control-plane member needs to run the API against the shared database (3.2).
 * Added to the desired state only when it is pushed to a member over its authenticated stream; never
 * persisted with the desired state, never in plans, logs or the audit log.
 */
export const REPLICATED_CONTROL_PLANE_ENV = [
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'ENCRYPTION_KEY',
  'AUTHENTICATION_METHOD',
  'STATIC_API_KEY',
  'JWT_SECRET',
  'KEYCLOAK_SERVER_URL',
  'KEYCLOAK_AUTH_SERVER_URL',
  'KEYCLOAK_REALM',
  'KEYCLOAK_CLIENT_ID',
  'KEYCLOAK_CLIENT_SECRET',
  'CORS_ORIGIN',
  'LOADWEAVER_CLUSTER_ID',
  'LOADWEAVER_GRPC_HOSTNAMES',
  'LOADWEAVER_GRPC_ENDPOINTS',
  'LOADWEAVER_PUBLIC_URL',
  'LOADWEAVER_POSTGRES_REPLICATION_PASSWORD',
  'LOADWEAVER_POSTGRES_ADMIN_PASSWORD',
  // External KMS for the master key (3.22).
  'LOADWEAVER_MASTER_KEY_KMS',
  'DYNAMIC_KMS_PROVIDERS',
  'VAULT_ADDR',
  'VAULT_TOKEN',
  'VAULT_NAMESPACE',
  'LOADWEAVER_VAULT_TRANSIT_MOUNT',
  'LOADWEAVER_VAULT_TRANSIT_KEY',
] as const;

export function replicatedEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    REPLICATED_CONTROL_PLANE_ENV.filter((key) => env[key] !== undefined && env[key] !== '').map((key) => [
      key,
      env[key] as string,
    ]),
  );
}

function controlPlaneRole(
  node: NodeEntity,
  nodes: NodeEntity[],
  membership: ControlPlaneMembership,
  scope: string,
): ControlPlaneRole {
  const address = (n: NodeEntity) => n.overlayV4 ?? n.overlayV6 ?? '';
  const voters = nodes.filter(
    (n) => membership.members.includes(n.name) || membership.votingWitnesses.includes(n.name),
  );
  const role = membership.members.includes(node.name)
    ? 'member'
    : membership.votingWitnesses.includes(node.name)
      ? 'witness'
      : 'none';

  return {
    role,
    members: voters
      .map((n) => ({ name: n.name, address: address(n), witness: n.witness }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    automaticFailover: membership.automaticFailover,
    scope,
    // Logs on the members, sized by cluster (3.14): a small heap for one member, more once there are three.
    ...(role === 'member'
      ? {
          logStore: {
            clusterName: scope,
            heapMb: membership.members.length >= 3 ? 1024 : 512,
            httpPort: LOG_STORE_PORTS.http,
            transportPort: LOG_STORE_PORTS.transport,
          },
        }
      : {}),
  };
}

/** Adds the member's control-plane data backup settings (3.20, gated by `platform-backups` / `platform-cutover`). */
function withPlatformBackups(
  role: ControlPlaneRole,
  node: string,
  backups: ClusterBackups | undefined,
  platform: PlatformState,
): ControlPlaneRole {
  return withPlatformState(role, node, backups, platform);
}

/**
 * Compiles the network from groups and policies (3.3) and distributes the result: per-node desired states are
 * persisted with a cluster-wide revision and announced via Postgres NOTIFY, so every control-plane replica
 * pushes them to the agents connected to it.
 */
@Injectable()
export class NetworkStateService implements OnModuleDestroy {
  private readonly logger = new Logger(NetworkStateService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private pendingReasons = new Set<string>();
  /** Last legacy-egress warning per node (logged on change only). */
  private legacyEgressWarnings = new Map<string, string>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly planner: WorkloadPlannerService,
    private readonly masterKey: MasterKeyService,
    private readonly dns: DnsService,
    private readonly install: InstallService,
    @Optional() private readonly releases?: ReleasesService,
  ) {}

  /** Rendered zones per bind9 node (3.15); serials advance only when a zone's content changes. */
  private async hostedZones(
    manager: EntityManager,
    resources: ResourceEntity[],
    nodes: NodeEntity[],
    addressRows: PublicAddressEntity[],
  ): Promise<Map<string, AuthoritativeDns>> {
    const providers = dnsProviders(resources);
    const zones = dnsZones(resources);
    const result = new Map<string, AuthoritativeDns>();

    if (![...providers.values()].some((p) => p.type === 'bind9')) return result;

    const groups = new Map(
      resources.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
    );
    const desired = this.dns.desired(
      resources,
      addressRows,
      new Map((await manager.getRepository(DnsFailoverStateEntity).find()).map((r) => [r.name, r.state])),
    );

    if (desired.errors.length > 0) {
      this.logger.warn(`DNS desired state has errors, hosted zones unchanged: ${desired.errors.join('; ')}`);

      // Unchanged means each node keeps what it serves: no configuration would make its agent remove bind9 with the
      // zones, keys and rollover state it holds.
      for (const row of await manager.getRepository(NodeDesiredStateEntity).find()) {
        const previous = (row.state as { authoritativeDns?: AuthoritativeDns }).authoritativeDns;

        if (previous) result.set(row.nodeName, previous);
      }

      return result;
    }

    const serials = manager.getRepository(DnsZoneSerialEntity);
    const dnssecKeys = await manager.getRepository(DnssecKeyEntity).find({ order: { createdAt: 'ASC' } });
    const tsigKey = (provider: string) => ({
      name: provider,
      algorithm: providers.get(provider)?.tsigAlgorithm ?? ('hmac-sha256' as const),
    });

    // Zones rendered here, for the steering views below.
    const rendered = new Map<
      string,
      { zone: DnsZoneSpec; nameServers: NameServer[]; serial: number; provider: string; nodes: string[] }
    >();

    for (const [zoneName, zone] of zones) {
      const bind9 = [zone.provider, ...zone.secondaries].map((p) => providers.get(p)).find((p) => p?.type === 'bind9');

      if (!bind9) continue;

      const servers = bind9Nodes(bind9, groups, nodes);
      // Name-server addresses from the provider's DNS pool (e.g. anycast), else the nodes' endpoints.
      const providerName = [zone.provider, ...zone.secondaries].find((p) => providers.get(p) === bind9) as string;
      const poolAddresses = addressRows
        .filter((r) => r.state === 'assigned' && r.owner?.startsWith(`dns/${providerName}/`))
        .map((r) => r.address)
        .sort();
      const primary = providers.get(zone.provider);
      let entryZone: AuthoritativeDns['zones'][number];
      const keys: NonNullable<AuthoritativeDns['tsigKeys']> = [];

      if (primary?.type === 'axfr') {
        // An external primary owns the zone: bind9 pulls it with the provider's TSIG key.
        entryZone = { name: zone.zone, primaries: [...(primary.servers ?? [])], transferKey: zone.provider };
        keys.push(tsigKey(zone.provider));
      } else {
        const nameServers =
          poolAddresses.length > 0
            ? poolAddresses.map((address, i) => ({ name: `ns${i + 1}.${zone.zone}`, addresses: [address] }))
            : zoneNameServers(zone, servers);
        const body = zoneBody(
          zone,
          desired.records.filter((r) => r.zone === zoneName),
          nameServers,
        );
        // Steered answers live in the views' variants: a change there is a change of the zone too (new serial).
        const steering = (desired.steered ?? [])
          .filter((h) => h.zone === zoneName)
          .map((h) => ({
            fqdn: h.fqdn,
            addresses: h.addresses,
            geo: [...h.steering.geo],
            buckets: h.steering.buckets,
          }));
        const hash = zoneHash(steering.length > 0 ? `${body}\n${JSON.stringify(steering)}` : body);
        const previous = await serials.findOne({ where: { zone: zoneName } });
        const serial =
          previous && previous.contentHash === hash ? previous.serial : nextSerial(previous?.serial, new Date());

        if (!previous || previous.contentHash !== hash)
          await serials.save(serials.create({ zone: zoneName, serial, contentHash: hash }));

        const signedHere = primary?.type === 'bind9';
        // AXFR secondaries pull from hosted bind9 as primary (the plan rejects other combinations).
        const transfers = signedHere
          ? zone.secondaries
              .filter((p) => providers.get(p)?.type === 'axfr')
              .flatMap((p) => (providers.get(p)?.servers ?? []).map((address) => ({ address, key: p })))
          : [];
        const own = signedHere ? dnssecKeys.filter((k) => k.zone === zoneName) : [];
        const mode = dnssecMode(zone.dnssec, own);

        for (const p of new Set(transfers.map((t) => t.key))) keys.push(tsigKey(p));

        rendered.set(zoneName, {
          zone,
          nameServers,
          serial,
          provider: providerName,
          nodes: servers.map((n) => n.name),
        });
        entryZone = {
          name: zone.zone,
          file: renderZoneFile(zone, body, serial, nameServers[0]?.name ?? `ns1.${zone.zone}`),
          ...(transfers.length > 0 ? { transfers } : {}),
          ...(mode
            ? {
                dnssec: {
                  mode,
                  keys: own.map((k) => ({
                    publicKey: k.publicKey,
                    created: k.createdAt.toISOString(),
                    ...(k.retiredAt ? { retired: k.retiredAt.toISOString() } : {}),
                  })),
                },
              }
            : {}),
        };
      }

      for (const node of servers) {
        const listen = [...new Set([...poolAddresses, ...nameServerAddresses(node)])];

        if (listen.length === 0) continue;

        const entry = result.get(node.name) ?? { listen, zones: [] };

        entry.zones.push(entryZone);

        for (const key of keys) {
          if (!entry.tsigKeys?.some((k) => k.name === key.name)) entry.tsigKeys = [...(entry.tsigKeys ?? []), key];
        }

        result.set(node.name, entry);
      }
    }

    await this.steeringViews(desired, rendered, result);

    return result;
  }

  /**
   * DNS steering (3.28): per bind9 provider, the views its steered hosts need, each with its own variant of the zones
   * those hosts are in. Without a GeoIP database, only weighted steering (by address) gets views.
   */
  private async steeringViews(
    desired: DnsDesiredState,
    rendered: ReadonlyMap<
      string,
      { zone: DnsZoneSpec; nameServers: NameServer[]; serial: number; provider: string; nodes: string[] }
    >,
    result: Map<string, AuthoritativeDns>,
  ): Promise<void> {
    const steered = (desired.steered ?? []).filter((h) => rendered.has(h.zone));

    if (steered.length === 0) return;

    const geoip = await this.install.geoipDatabase();
    const byProvider = new Map<string, SteeredHost[]>();

    for (const host of steered) {
      const provider = rendered.get(host.zone)?.provider as string;

      byProvider.set(provider, [...(byProvider.get(provider) ?? []), host]);
    }

    for (const [provider, hosts] of byProvider) {
      const views = steeringViews(hosts, !!geoip);

      if ('error' in views) {
        this.logger.warn(`DNS steering at ${provider}: ${views.error}`);
        continue;
      }

      const zoneNames = [...new Set(hosts.map((h) => h.zone))];
      const steeredNames = new Set(hosts.map((h) => h.fqdn));
      const variants = views.map((view) => ({
        name: view.name,
        ...(view.country ? { country: view.country } : {}),
        ...(view.continent ? { continent: view.continent } : {}),
        ...(view.networks ? { networks: view.networks } : {}),
        zones: zoneNames.map((zoneName) => {
          const r = rendered.get(zoneName) as NonNullable<ReturnType<typeof rendered.get>>;
          const base = desired.records.filter((rec) => rec.zone === zoneName);
          const records = [
            ...base.filter((rec) => !(steeredNames.has(rec.fqdn) && (rec.type === 'A' || rec.type === 'AAAA'))),
            ...hosts
              .filter((h) => h.zone === zoneName)
              .flatMap((h) => {
                const answer = view.answers.get(h.fqdn) ?? h.addresses;
                const ttl = base.find((rec) => rec.fqdn === h.fqdn)?.ttl ?? r.zone.defaultTtl;
                const source = base.find((rec) => rec.fqdn === h.fqdn)?.source ?? 'steering';

                return (['A', 'AAAA'] as const).flatMap((type) => {
                  const values = answer.filter((a) => a.includes(':') === (type === 'AAAA')).sort();

                  return values.length ? [{ zone: zoneName, fqdn: h.fqdn, type, values, ttl, source }] : [];
                });
              }),
          ];

          return {
            name: r.zone.zone,
            file: renderZoneFile(
              r.zone,
              zoneBody(r.zone, records, r.nameServers),
              r.serial,
              r.nameServers[0]?.name ?? `ns1.${r.zone.zone}`,
            ),
          };
        }),
      }));
      const usesGeo = variants.some((v) => v.country || v.continent);

      for (const node of new Set(zoneNames.flatMap((z) => rendered.get(z)?.nodes ?? []))) {
        const entry = result.get(node);

        if (!entry) continue;

        if (entry.views) {
          this.logger.warn(`DNS steering: ${node} runs two bind9 providers with views; keeping the first`);
          continue;
        }

        entry.views = variants;

        if (usesGeo && geoip) entry.geoip = geoip;
      }
    }
  }

  /**
   * Agents without `egress-policies` get per-source egress settings folded into the node level at send time (M6
   * review M5); what that can't express (URL deny patterns, address denies of sources without an allow list) is
   * warned about here, once per change.
   */
  private warnLegacyEgress(node: NodeEntity, filter: DesiredState['network']['egressFilter']): void {
    const unexpressible =
      filter && !(node.protocolFeatures ?? []).includes('egress-policies')
        ? foldEgressPoliciesForLegacy(filter).unexpressible
        : [];
    const summary = unexpressible.map((u) => `${u.address}: ${u.setting}`).join(', ');

    if ((this.legacyEgressWarnings.get(node.name) ?? '') === summary) return;

    this.legacyEgressWarnings.set(node.name, summary);

    if (summary)
      this.logger.warn(
        `The agent on node ${node.name} lacks the egress-policies feature and cannot apply these per-source egress settings (update the agent): ${summary}`,
      );
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Coalesces recompile requests (joins, applies, lifecycle changes) into one compilation. */
  requestRecompile(reason: string): void {
    this.pendingReasons.add(reason);

    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      const reasons = [...this.pendingReasons];

      this.pendingReasons.clear();
      this.running = (this.running ?? Promise.resolve())
        .then(() => this.recompile())
        .then(async (outcome) => {
          this.logger.log(
            `Compiled network revision ${outcome.revision} (${reasons.join(', ')}); ${outcome.changedNodes.length} node(s) changed`,
          );
          // Control-plane membership may have changed: the master-key shares follow the members (3.22).
          await this.masterKey
            .reshare()
            .catch((error: unknown) =>
              this.logger.warn(
                `Master key re-share deferred: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
        })
        .catch((error: unknown) =>
          this.logger.error(`Network compilation failed: ${error instanceof Error ? error.message : String(error)}`),
        );
    }, RECOMPILE_DEBOUNCE_MS);
  }

  /** Loads everything the compiler needs inside the given transaction. */
  async loadInput(manager: EntityManager): Promise<{
    cluster: ClusterEntity;
    nodes: NodeEntity[];
    input: CompilerInput;
    membership: ControlPlaneMembership;
    workloads: WorkloadContext;
    generations: ObjectStoreGenerationEntity[];
    clusterSpec: ClusterSpec;
    resources: ResourceEntity[];
    ingressNodes: Set<string>;
  }> {
    const cluster = await manager.getRepository(ClusterEntity).findOneOrFail({ where: {} });
    const resources = await manager.getRepository(ResourceEntity).find({
      where: [
        { kind: 'NodeGroup' },
        { kind: 'WorkloadGroup' },
        { kind: 'Policy' },
        { kind: 'Project' },
        { kind: 'Deployment' },
        { kind: 'IpPool' },
        { kind: 'AutonomousSystem' },
        { kind: 'BgpPeer' },
        { kind: 'BgpAnnouncement' },
        { kind: 'DnsProvider' },
        { kind: 'DnsZone' },
        { kind: 'DnsRecord' },
        { kind: 'DnsFailover' },
        // Vulnerability limits go out with the workloads (3.22).
        { kind: 'ImagePolicy' },
        // Remote access client groups (3.31).
        { kind: 'ClientGroup' },
        // Status page hostnames are ingress sites (3.25).
        { kind: 'StatusPage' },
      ],
    });
    const clusterResource = await manager
      .getRepository(ResourceEntity)
      .findOneOrFail({ where: { kind: 'Cluster', projectKey: '' } });
    // Nodes joined for an import get no desired state until their join plan activates them (3.21).
    const nodes = await manager
      .getRepository(NodeEntity)
      .find({ where: { lifecycle: Not(In(['left', ...IMPORT_LIFECYCLES])) }, order: { name: 'ASC' } });
    const spec = clusterSpecSchema.parse(clusterResource.spec);
    const membership = computeControlPlaneMembership(nodes, spec.controlPlaneSize);
    // Imported deployments wait for their join plan's release step (data copied, source stopped).
    const held = await heldImportDeployments(manager);
    const workloads: WorkloadContext = {
      parsed: this.planner.parse(resources).parsed,
      placements: (await manager.getRepository(WorkloadPlacementEntity).find()).filter(
        (p) => !held.has(`${p.project}/${p.deployment}`),
      ),
      services: await manager.getRepository(ServiceAddressEntity).find(),
      states: await manager.getRepository(DeploymentStateEntity).find(),
      podSubnets: new Map(nodes.map((n) => [n.name, [n.podSubnetV4, n.podSubnetV6].filter((s): s is string => !!s)])),
    };
    const generations = await manager.getRepository(ObjectStoreGenerationEntity).find({ order: { generation: 'ASC' } });
    const ingressNodes = ingressNodesOf(resources, spec, nodes);
    // Remote access (3.31): gateways, the active one (holder of the gateway address) and the valid clients.
    const remoteAccess = remoteAccessInput(
      [...resources, clusterResource],
      nodes,
      await manager.getRepository(VpnClientEntity).find(),
      await manager.getRepository(PublicAddressEntity).find(),
      Date.now(),
    );
    const input = buildCompilerInput(
      cluster,
      clusterResource,
      nodes,
      resources,
      new Set(membership.members),
      workloads,
      objectStoreHolderSet(generations),
      ingressNodes,
      remoteAccess,
    );

    return { cluster, nodes, input, membership, workloads, generations, clusterSpec: spec, resources, ingressNodes };
  }

  async recompile(): Promise<RecompileOutcome> {
    return await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_NETWORK_COMPILE]);

      const { cluster, nodes, input, membership, workloads, generations, clusterSpec, resources, ingressNodes } =
        await this.loadInput(manager);
      const exposures = collectExposures(workloads.parsed, statusPageHosts(resources));
      const certificates = await manager
        .getRepository(CertificateEntity)
        .find({ select: { id: true, names: true, source: true, certificatePem: true, notAfter: true } });
      const challenges = await manager
        .getRepository(AcmeChallengeEntity)
        .find({ where: { expiresAt: MoreThan(new Date()) } });
      const ingressEndpoints = new Map<string, string[]>();

      for (const placement of workloads.placements) {
        const service = placement.id.split('/').slice(0, 3).join('/');

        // Draining replicas leave the ingress upstreams first (M6 gate).
        if (isDraining(placement)) continue;

        for (const copy of runningCopies(placement))
          ingressEndpoints.set(service, [...(ingressEndpoints.get(service) ?? []), ...copy.addresses]);
      }
      // Status pages: the API on every member (3.25).
      ingressEndpoints.set(
        STATUS_PAGE_SERVICE,
        nodes
          .filter((n) => membership.members.includes(n.name))
          .map((n) => n.overlayV4 ?? n.overlayV6)
          .filter((a): a is string => !!a)
          .sort(),
      );
      const pools = ipPools(resources);
      const nodeGroups = new Map(
        resources.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
      );
      const addressRows = await manager.getRepository(PublicAddressEntity).find();
      const addressNodes = holderNodes(nodes, Date.now());
      const hosted = await this.hostedZones(manager, resources, nodes, addressRows);
      const bgp = bgpResources(resources);
      // Probes for DNS failover from reachable, active nodes (3.28).
      const probes = assignProbes(
        dnsFailovers(resources),
        addressNodes
          .filter((n) => n.reachable && n.lifecycle === 'active')
          .map((n) => ({ name: n.name, site: n.site })),
      );
      const bgpAddresses = addressRows
        .filter((r) => r.state === 'assigned' && pools.get(r.pool)?.failover === 'bgp')
        .map((r) => ({
          address: r.address,
          holder: r.holder,
          candidates: holderCandidates(nodeGroups.get(pools.get(r.pool)?.nodeGroup ?? ''), addressNodes),
          anycast: pools.get(r.pool)?.bgpMode === 'anycast',
        }));
      const memberSet = new Set(membership.members);
      const client = registryClient(nodes, memberSet, generations, clusterSpec.registry);
      // Rate-limit service on the members (3.6), in a fixed order so every ingress uses the same healthy one.
      const rateLimitEndpoints =
        exposures.limits.length > 0
          ? nodes
              .filter((n) => memberSet.has(n.name))
              .map((n) => n.overlayV4 ?? n.overlayV6)
              .filter((a): a is string => !!a)
              .sort()
              .slice(0, 7)
          : [];
      const rateLimiter =
        rateLimitEndpoints.length > 0
          ? { config: renderRateLimitConfig(exposures.limits), port: RATE_LIMIT_PORT }
          : undefined;
      // The registry trusts only the registry-token certificate, never the cluster CA.
      const registryTokenRoot = generations.some((g) => g.state === 'active')
        ? (await ensureRegistryTokenKey(manager)).certificatePem
        : '';

      const volumePlacements = await manager.getRepository(VolumePlacementEntity).find();
      // Control-plane data backups (3.20): the point-in-time clone a member runs, if any.
      const platformRestore = await activePlatformState(manager);
      // Backup repository servers on the members (3.20).
      // A disaster recovery re-seeds repositories from the external copy before their servers start (3.20).
      const reseeding = await pendingReseedScopes(manager);
      const backupRepositories = (
        await manager
          .getRepository(BackupRepositoryEntity)
          .find({ select: { scope: true, port: true, certificate: true } })
      ).filter((r) => !reseeding.has(r.scope));

      // Agents before `hostname` in the hello (3.5): DRBD then needs node name == `uname -n`.
      for (const node of nodes) {
        if (node.hostname || unnamedVolumeHosts.has(node.name)) continue;

        if (!volumePlacements.some((v) => [v.primaryNode, ...v.syncReplicas, ...v.remoteReplicas].includes(node.name)))
          continue;

        unnamedVolumeHosts.add(node.name);
        this.logger.warn(
          `Node ${node.name} didn't report its host name; its DRBD resources name it "${node.name}", which must equal its \`uname -n\``,
        );
      }

      // Remember what each ungated replica runs, so a later `before-jobs` gate can keep serving it (3.23).
      for (const placement of workloads.placements) {
        if (placement.gate || isDraining(placement)) continue;

        const released = effectiveSpec(placement, placement.addresses, workloads, input.network.dnsDomain);

        if (released && (placement.releasedSpec as WorkloadSpec | null)?.specHash !== released.specHash) {
          await manager
            .getRepository(WorkloadPlacementEntity)
            .update({ id: placement.id }, { releasedSpec: released as unknown as Record<string, unknown> });
        }
      }

      const imagePolicies = resources
        .filter((r) => r.kind === 'ImagePolicy')
        .map((r) => ({ project: r.project ?? undefined, name: r.name, spec: imagePolicySpecSchema.parse(r.spec) }));
      // Health-gated announcements (3.27) follow the replicas' reported state.
      const upReplicas = healthyReplicas(
        (workloads.placements as WorkloadPlacementEntity[]).filter((p) => !isDraining(p)),
        new Map(nodes.map((n) => [n.name, n.site])),
        new Set(addressNodes.filter((n) => n.reachable).map((n) => n.name)),
      );
      // Remote access gateways need their shared key before any client enrolls (3.31).
      if (input.remoteAccess) await ensureVpnGatewayKey(manager);

      // Egress from own prefixes (3.27): through the nodes holding the policies' addresses.
      const compilation = compileNetwork({ ...input, egress: egressGateways(addressRows) });

      compilation.diagnostics
        .filter((d) => d.level === 'error')
        .forEach((d) => this.logger.warn(`Compiler: ${d.policy ?? ''} ${d.message}`));

      // The release each node moves to (3.26): set by the update rollout, gated by the `components` feature.
      const nodeComponents = this.releases
        ? await this.releases.componentsResolver(nodes.map((n) => n.componentTarget))
        : () => undefined;
      const stateRepo = manager.getRepository(NodeDesiredStateEntity);
      const previous = new Map((await stateRepo.find()).map((s) => [s.nodeName, s]));
      const nextRevision = cluster.desiredRevision + 1;
      const changed: { node: NodeEntity; state: DesiredState }[] = [];

      for (const node of nodes) {
        const network = compilation.nodes[node.name];

        if (!network) continue;

        this.warnLegacyEgress(node, network.egressFilter);

        const state: DesiredState = {
          revision: nextRevision,
          network,
          controlPlane: withPlatformBackups(
            controlPlaneRole(node, nodes, membership, cluster.clusterId),
            node.name,
            clusterSpec.backups,
            platformRestore,
          ),
          // Vulnerability limits the node checks after pulling (3.22); outside the spec hash, so policy changes
          // don't restart anything.
          workloads: nodeWorkloads(node.name, workloads, input.network.dnsDomain).map((spec) => {
            const imagePolicy = runtimeImagePolicy(imagePolicies, {
              project: spec.project,
              service: spec.service,
              labels: spec.labels ?? {},
            });

            return imagePolicy ? { ...spec, imagePolicy } : spec;
          }),
          volumes: nodeVolumes(node.name, volumePlacements, nodes),
          ...optional('objectStore', objectStoreRole(node, generations)),
          ...optional(
            'registry',
            registryRole(node, memberSet, nodes, generations, clusterSpec.registry, registryTokenRoot, publicUrl()),
          ),
          ...optional('registryClient', client),
          ...optional('backupServer', backupServerRole(node, memberSet, nodes, generations, backupRepositories)),
          ...optional(
            'ingress',
            ingressNodes.has(node.name)
              ? ingressState(
                  exposures,
                  addressRows
                    .filter((r) => r.state === 'assigned' && r.owner?.startsWith('ingress/'))
                    .map((r) => r.address),
                  ingressEndpoints,
                  certificates,
                  challenges,
                  new Date(),
                  rateLimitEndpoints,
                )
              : undefined,
          ),
          ...optional('authoritativeDns', hosted.get(node.name)),
          ...optional('externalBgp', nodeExternalBgp(node, bgp, nodeGroups, bgpAddresses, upReplicas)),
          ...optional('probes', nonEmpty(probes.get(node.name) ?? [])),
          liveAccess: { nodeShell: clusterSpec.nodeShellEnabled },
          ...optional('rateLimiter', memberSet.has(node.name) ? rateLimiter : undefined),
          ...optional(
            'publicAddresses',
            nonEmpty(
              nodePublicAddresses(
                addressNodes.find((n) => n.name === node.name) as HolderNode,
                addressRows,
                pools,
                nodeGroups,
                addressNodes,
              ),
            ),
          ),
          // Import nodes (pending / importing) never get here: they are not compiled until activated (3.21).
          lifecycle: (node.lifecycle === 'left' ? 'leaving' : node.lifecycle) as DesiredState['lifecycle'],
          ...optional('components', nodeComponents(node)),
        };
        const before = previous.get(node.name);

        if (!before || canonicalJson(withoutRevision(before.state)) !== canonicalJson(withoutRevision(state)))
          changed.push({ node, state });
      }

      for (const node of nodes) {
        if (node.controlPlane !== memberSet.has(node.name)) {
          await manager.getRepository(NodeEntity).update({ id: node.id }, { controlPlane: memberSet.has(node.name) });
        }
      }

      const networkState = {
        portAllocations: compilation.portAllocations,
        routeReflectors: compilation.routeReflectors,
      };
      const stateChanged = canonicalJson(networkState) !== canonicalJson(cluster.networkState ?? {});

      if (changed.length === 0 && !stateChanged) {
        return { revision: cluster.desiredRevision, changedNodes: [], compilation, membership };
      }

      for (const { node, state } of changed) {
        await stateRepo.save(
          stateRepo.create({
            nodeName: node.name,
            revision: nextRevision,
            state: state as unknown as Record<string, unknown>,
          }),
        );
      }

      await manager
        .getRepository(ClusterEntity)
        .update({ id: cluster.id }, { desiredRevision: nextRevision, networkState });
      // Delivered to all listening replicas when the transaction commits.
      await manager.query('SELECT pg_notify($1, $2)', [DESIRED_STATE_CHANNEL, String(nextRevision)]);

      return { revision: nextRevision, changedNodes: changed.map((c) => c.node.name), compilation, membership };
    });
  }

  /**
   * Re-announces the unchanged desired states of some nodes under a new revision, so every replica pushes them again
   * (the push adds what is never stored, e.g. a renewed Postgres server certificate). Returns the revision, or null
   * when none of the nodes has a desired state yet.
   */
  async repush(nodeNames: readonly string[], reason: string): Promise<number | null> {
    if (nodeNames.length === 0) return null;

    const revision = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_NETWORK_COMPILE]);

      const stateRepo = manager.getRepository(NodeDesiredStateEntity);
      const rows = await stateRepo.find({ where: { nodeName: In([...nodeNames]) } });

      if (rows.length === 0) return null;

      const cluster = await manager.getRepository(ClusterEntity).findOneOrFail({ where: {} });
      const nextRevision = cluster.desiredRevision + 1;

      for (const row of rows)
        await stateRepo.update(
          { nodeName: row.nodeName },
          { revision: nextRevision, state: { ...row.state, revision: nextRevision } },
        );

      await manager.getRepository(ClusterEntity).update({ id: cluster.id }, { desiredRevision: nextRevision });
      await manager.query('SELECT pg_notify($1, $2)', [DESIRED_STATE_CHANNEL, String(nextRevision)]);

      return nextRevision;
    });

    if (revision !== null) this.logger.log(`Re-pushing revision ${revision} to ${nodeNames.join(', ')} (${reason})`);

    return revision;
  }

  async getDesiredState(nodeName: string): Promise<DesiredState | null> {
    const row = await this.dataSource.getRepository(NodeDesiredStateEntity).findOne({ where: { nodeName } });

    return row ? (row.state as unknown as DesiredState) : null;
  }
}
