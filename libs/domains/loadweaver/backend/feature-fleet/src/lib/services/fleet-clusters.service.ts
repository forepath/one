import { UserEntity } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';

import { FleetClusterEntity, type FleetClusterHealth } from '../entities/fleet-cluster.entity';
import { FleetGrantEntity } from '../entities/fleet-grant.entity';
import type { CreateClusterDto, PutGrantDto, TestClusterDto, UpdateClusterDto } from '../dto/fleet.dto';
import { normalizeCaCertificate, validateClusterEndpoint } from '../utils/fleet-endpoint-security';
import type { FleetCaller, FleetClusterAccess } from '../utils/fleet-access.utils';
import { FleetAccessEvents } from './fleet-access-events.service';
import { FleetAuditService } from './fleet-audit.service';
import { FleetClusterClient, FleetClusterError, type ClusterConnection } from './fleet-cluster-client.service';

export interface FleetClusterDto {
  id: string;
  name: string;
  description: string | null;
  endpoint: string;
  hasCustomCa: boolean;
  /** Last four characters of the stored credential (the credential itself is never returned). */
  credentialHint: string;
  reference: string | null;
  state: string;
  readOnlyUntil: string | null;
  readOnlyReason: string | null;
  health: FleetClusterHealth;
  /** The caller's effective access (null for admins' full access). */
  access: { clusterRole: string | null; projects: Record<string, string>; readOnly: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface FleetGrantDto {
  id: string;
  clusterId: string;
  userId: string;
  role: string;
  project: string | null;
  createdBy: string | null;
  createdAt: string;
}

export function credentialHint(credential: string): string {
  return credential.length > 8 ? `…${credential.slice(-4)}` : '…';
}

/** API view of a connection: never the credential, only its hint. */
export function toClusterDto(cluster: FleetClusterEntity, access: FleetClusterAccess): FleetClusterDto {
  return {
    id: cluster.id,
    name: cluster.name,
    description: cluster.description,
    endpoint: cluster.endpoint,
    hasCustomCa: !!cluster.caCertificate,
    credentialHint: cluster.credentialHint,
    reference: cluster.reference,
    state: cluster.state,
    readOnlyUntil: cluster.readOnlyUntil ? cluster.readOnlyUntil.toISOString() : null,
    readOnlyReason: cluster.readOnlyReason,
    health: cluster.health,
    access: {
      clusterRole: access.clusterRole,
      projects: Object.fromEntries(access.projects),
      readOnly: access.readOnly,
    },
    createdAt: cluster.createdAt.toISOString(),
    updatedAt: cluster.updatedAt.toISOString(),
  };
}

function toGrantDto(g: FleetGrantEntity): FleetGrantDto {
  return {
    id: g.id,
    clusterId: g.clusterId,
    userId: g.userId,
    role: g.role,
    project: g.project,
    createdBy: g.createdBy,
    createdAt: g.createdAt.toISOString(),
  };
}

/** What `GET /api/cluster` of a control plane returns (the parts the health poll uses). */
interface ClusterInfoLike {
  clusterId?: string;
  displayName?: string;
  nodes?: { total?: number; connected?: number };
}

/**
 * Cluster connections (3.24): register / change / remove, connection test, periodic health polls, and the
 * per-cluster grants of fleet users.
 */
@Injectable()
export class FleetClustersService {
  private readonly logger = new Logger(FleetClustersService.name);

  constructor(
    @InjectRepository(FleetClusterEntity) private readonly clusters: Repository<FleetClusterEntity>,
    @InjectRepository(FleetGrantEntity) private readonly grants: Repository<FleetGrantEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly client: FleetClusterClient,
    private readonly audit: FleetAuditService,
    @Optional() private readonly accessEvents?: FleetAccessEvents,
  ) {}

  async get(id: string): Promise<FleetClusterEntity> {
    const cluster = await this.clusters.findOne({ where: { id } });

    if (!cluster) throw new NotFoundException('cluster not found');

    return cluster;
  }

  async findByReference(reference: string): Promise<FleetClusterEntity | null> {
    return await this.clusters.findOne({ where: { reference } });
  }

  /**
   * Probes a cluster with a credential: `GET /api/cluster` needs a valid token with `cluster:read` and a cluster
   * role, so it proves both the endpoint and the credential. Returns the health record.
   */
  async probe(connection: ClusterConnection): Promise<FleetClusterHealth> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();

    try {
      const { data, headers } = await this.client.json<ClusterInfoLike>(connection, { method: 'GET', path: 'cluster' });
      const version = typeof headers['x-loadweaver-version'] === 'string' ? headers['x-loadweaver-version'] : null;
      const nodes = data?.nodes;
      const degraded = !!nodes && typeof nodes.total === 'number' && (nodes.connected ?? 0) < nodes.total;

      return {
        state: degraded ? 'degraded' : 'healthy',
        checkedAt,
        latencyMs: Date.now() - started,
        version,
        clusterId: typeof data?.clusterId === 'string' ? data.clusterId : null,
        error: degraded ? `${nodes?.connected ?? 0} of ${nodes?.total} nodes connected` : null,
      };
    } catch (error) {
      const status = error instanceof FleetClusterError ? error.status : null;
      const message = error instanceof Error ? error.message : String(error);

      return {
        state: status === 401 || status === 403 ? 'credential-rejected' : status === null ? 'unreachable' : 'degraded',
        checkedAt,
        latencyMs: status === null ? null : Date.now() - started,
        version: null,
        clusterId: null,
        error: message.slice(0, 500),
      };
    }
  }

  async test(dto: TestClusterDto): Promise<FleetClusterHealth> {
    const { endpoint } = await validateClusterEndpoint(dto.endpoint);

    return await this.probe({
      id: 'test',
      endpoint,
      caCertificate: normalizeCaCertificate(dto.caCertificate),
      credential: dto.credential.trim(),
      updatedAt: new Date(),
    });
  }

  async create(
    caller: FleetCaller,
    dto: CreateClusterDto,
    extra: { reference?: string | null } = {},
  ): Promise<FleetClusterEntity> {
    const { endpoint } = await validateClusterEndpoint(dto.endpoint);
    const caCertificate = normalizeCaCertificate(dto.caCertificate);
    const credential = dto.credential.trim();

    if (await this.clusters.exists({ where: { name: dto.name } })) throw new ConflictException('name already in use');

    if (extra.reference && (await this.clusters.exists({ where: { reference: extra.reference } })))
      throw new ConflictException('reference already registered');

    const health =
      dto.test === false
        ? ({ state: 'unknown', checkedAt: null, latencyMs: null, version: null, clusterId: null, error: null } as const)
        : await this.probe({ id: 'new', endpoint, caCertificate, credential, updatedAt: new Date() });

    if (dto.test !== false && (health.state === 'unreachable' || health.state === 'credential-rejected'))
      throw new BadRequestException(`connection test failed: ${health.error ?? health.state}`);

    const saved = await this.clusters.save(
      this.clusters.create({
        name: dto.name,
        description: dto.description ?? null,
        endpoint,
        caCertificate,
        credential,
        credentialHint: credentialHint(credential),
        reference: extra.reference ?? null,
        state: 'active',
        readOnlyUntil: null,
        readOnlyReason: null,
        health: { ...health },
        createdBy: caller.userId,
      }),
    );

    await this.audit.record(
      caller,
      'cluster.registered',
      `cluster/${saved.id}`,
      { name: saved.name, endpoint, reference: saved.reference, health: health.state },
      saved.id,
    );

    return saved;
  }

  async update(caller: FleetCaller, id: string, dto: UpdateClusterDto): Promise<FleetClusterEntity> {
    const cluster = await this.get(id);
    const changed: string[] = [];
    const endpoint = dto.endpoint !== undefined ? (await validateClusterEndpoint(dto.endpoint)).endpoint : undefined;
    const caCertificate = dto.caCertificate !== undefined ? normalizeCaCertificate(dto.caCertificate) : undefined;
    const endpointChanges = endpoint !== undefined && endpoint !== cluster.endpoint;
    const caChanges = caCertificate !== undefined && caCertificate !== (cluster.caCertificate ?? null);

    // The stored credential is never sent to a new destination (or one trusted through another CA): whoever
    // moves a connection has to present the credential for the new target in the same request.
    if ((endpointChanges || caChanges) && !dto.credential?.trim())
      throw new BadRequestException('changing the endpoint or CA requires re-entering the service credential');

    if (dto.description !== undefined) {
      cluster.description = dto.description || null;
      changed.push('description');
    }

    if (endpointChanges) {
      cluster.endpoint = endpoint;
      changed.push('endpoint');
    }

    if (caChanges) {
      cluster.caCertificate = caCertificate;
      changed.push('caCertificate');
    }

    if (dto.credential !== undefined) {
      cluster.credential = dto.credential.trim();
      cluster.credentialHint = credentialHint(cluster.credential);
      changed.push('credential');
    }

    if (changed.some((c) => c !== 'description'))
      cluster.health = await this.probe({ ...cluster, updatedAt: new Date() });

    const saved = await this.clusters.save(cluster);

    await this.audit.record(caller, 'cluster.updated', `cluster/${id}`, { changed }, id);
    this.accessEvents?.accessChanged(id);

    return saved;
  }

  async remove(caller: FleetCaller, id: string): Promise<void> {
    const cluster = await this.get(id);

    await this.grants.delete({ clusterId: id });
    await this.clusters.delete({ id });
    await this.audit.record(caller, 'cluster.removed', `cluster/${id}`, { name: cluster.name }, id);
    this.accessEvents?.accessChanged(id);
  }

  /** One health poll (unit job): stores the result; clusters in other states than `active` / `teardown` are skipped. */
  async poll(id: string): Promise<FleetClusterHealth | null> {
    const cluster = await this.clusters.findOne({ where: { id } });

    if (!cluster || cluster.state === 'retired') return null;

    const health = await this.probe(cluster);

    await this.clusters.update({ id }, { health });

    if (health.state !== cluster.health?.state)
      await this.audit.recordQuietly(
        null,
        'cluster.health-changed',
        `cluster/${id}`,
        { from: cluster.health?.state ?? 'unknown', to: health.state, error: health.error },
        id,
      );

    return health;
  }

  /** Ids to poll now, and clusters whose read-only grace ended are retired (relay closed, polling stops). */
  async pollableIds(now = new Date()): Promise<string[]> {
    const ended = await this.clusters.find({
      where: { state: 'teardown', readOnlyUntil: LessThan(now) },
    });

    for (const cluster of ended) {
      await this.clusters.update({ id: cluster.id }, { state: 'retired' });
      this.accessEvents?.accessChanged(cluster.id);
      await this.audit.recordQuietly(
        null,
        'cloud.retired',
        `cluster/${cluster.id}`,
        { reference: cluster.reference },
        cluster.id,
      );
    }

    return (await this.clusters.find({ select: { id: true }, where: { state: Not('retired') } })).map((c) => c.id);
  }

  // ---------------------------------------------------------------------------------------------- grants

  async listGrants(clusterId: string): Promise<FleetGrantDto[]> {
    await this.get(clusterId);

    return (await this.grants.find({ where: { clusterId }, order: { createdAt: 'ASC' } })).map(toGrantDto);
  }

  async putGrant(caller: FleetCaller, clusterId: string, dto: PutGrantDto): Promise<FleetGrantDto> {
    await this.get(clusterId);

    if (!(await this.users.exists({ where: { id: dto.userId } }))) throw new NotFoundException('user not found');

    const project = dto.project ?? null;
    const existing = await this.grants.findOne({
      where: { clusterId, userId: dto.userId, project: project === null ? IsNull() : project },
    });
    const previousRole = existing?.role ?? null;
    const saved = await this.grants.save(
      existing
        ? Object.assign(existing, { role: dto.role })
        : this.grants.create({ clusterId, userId: dto.userId, role: dto.role, project, createdBy: caller.userId }),
    );

    await this.audit.record(
      caller,
      'grant.put',
      `cluster/${clusterId}/grant/${saved.id}`,
      { userId: dto.userId, role: dto.role, project, previousRole },
      clusterId,
    );
    this.accessEvents?.accessChanged(clusterId);

    return toGrantDto(saved);
  }

  async removeGrant(caller: FleetCaller, clusterId: string, grantId: string): Promise<void> {
    const grant = await this.grants.findOne({ where: { id: grantId, clusterId } });

    if (!grant) throw new NotFoundException('grant not found');

    await this.grants.delete({ id: grantId });
    await this.audit.record(
      caller,
      'grant.removed',
      `cluster/${clusterId}/grant/${grantId}`,
      { userId: grant.userId, role: grant.role, project: grant.project },
      clusterId,
    );
    this.accessEvents?.accessChanged(clusterId);
  }
}
