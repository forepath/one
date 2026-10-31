import type { JoinRequest, JoinResponse } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  clusterSpecSchema,
  isRuntime,
  LOADWEAVER_API_VERSION,
  labelsSchema,
  matchesSelector,
  type Resource,
  type Selector,
} from '@forepath/loadweaver/shared/util-model';
import { RUNTIME_READY_LABEL_PREFIX, runtimeAtLeastExpression } from '@forepath/loadweaver/shared/util-scheduler';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';

import { DataSource, Not } from 'typeorm';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { ADVISORY_LOCK_ALLOCATION, NODE_HEARTBEAT_TIMEOUT_MS } from '../constants/control-plane.constants';
import { effectiveNodeLabels, toNodeResponse, type NodeResponseDto } from '../dto/node.dto';
import { IMPORT_LIFECYCLES, NodeEntity, type NodeLifecycle } from '../entities/node.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { NodeDiscoveryEntity } from '../import/import.entities';
import { sanitizeDiscovery } from '../import/discovery-sanitize';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { NodesRepository } from '../repositories/nodes.repository';
import { allocateNodeAddressing, heldPodSubnets } from '../utils/network-allocation.utils';
import { drainImportNote } from '../utils/vm-import-hold.utils';
import {
  nodePlatformComponents,
  patroniRole,
  type NodePlatformComponentDto,
  type PatroniRole,
} from '../utils/node-platform.utils';
import { AuditLogService, type AuditActor } from './audit-log.service';
import { ClusterIdentityService } from './cluster-identity.service';
import { JoinTokensService } from './join-tokens.service';
import { NetworkStateService } from './network-state.service';
import { ResourceStoreService } from './resource-store.service';

/** Patroni's REST API on control-plane members (as `MEMBER_PATRONI_PORT`). */
const PATRONI_PORT = 8008;

export function readControlPlaneEndpoints(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.LOADWEAVER_GRPC_ENDPOINTS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * A node query on isolation levels (3.1): `sandboxed-kvm` = the level is ready (exact), `>=sandboxed-kvm` = the
 * node's strongest ready level is at least that (`runtime ≥ X`, an `In` over the stronger levels). Null if malformed.
 */
export function runtimeQuerySelector(query: string): Selector | null {
  const trimmed = query.trim();
  const atLeast = trimmed.startsWith('>=');
  const level = atLeast ? trimmed.slice(2).trim() : trimmed;

  if (!isRuntime(level)) return null;

  return atLeast
    ? { matchExpressions: [runtimeAtLeastExpression(level)] }
    : { matchLabels: { [`${RUNTIME_READY_LABEL_PREFIX}${level}`]: 'ready' } };
}

/**
 * Node membership: join with a token (3.21), cordon / drain / leave (3.2, 3.12).
 * Nodes can join and leave over and over again; a former node re-joins under its old name.
 */
/**
 * Whether a node streams to some control-plane replica (3.43): sessions live in each replica's memory, so a node
 * streaming to a member replica looked disconnected on the others. Every replica records heartbeats in the node's row
 * (`connected`, `lastSeenAt`); fresh within the heartbeat timeout counts, like the scheduler's reachability. A left
 * node's reports are no longer recorded, so it goes stale.
 */
export function nodeConnectedInCluster(
  node: Pick<NodeEntity, 'connected' | 'lastSeenAt' | 'lifecycle'>,
  now: number,
): boolean {
  return (
    node.lifecycle !== 'left' &&
    node.connected &&
    !!node.lastSeenAt &&
    now - node.lastSeenAt.getTime() <= NODE_HEARTBEAT_TIMEOUT_MS
  );
}

@Injectable()
export class NodesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly nodes: NodesRepository,
    private readonly tokens: JoinTokensService,
    private readonly identity: ClusterIdentityService,
    private readonly network: NetworkStateService,
    private readonly store: ResourceStoreService,
    private readonly audit: AuditLogService,
    private readonly sessions: AgentSessionRegistry,
  ) {}

  /** All nodes, or those matching a runtime query (`runtimeQuerySelector`: `microvm`, `>=sandboxed-kvm`). */
  async list(filter: { runtime?: string } = {}): Promise<NodeResponseDto[]> {
    const selector = filter.runtime ? runtimeQuerySelector(filter.runtime) : null;

    if (filter.runtime && !selector)
      throw new BadRequestException('runtime must be a level (runc, sandboxed, sandboxed-kvm, microvm), optionally >=');

    return (await this.nodes.findAll())
      .filter((n) => !selector || matchesSelector(selector, { name: n.name, labels: effectiveNodeLabels(n) }))
      .map((n) => toNodeResponse(n, this.connected(n)));
  }

  async get(name: string): Promise<NodeResponseDto> {
    const node = await this.nodes.findByNameOrThrow(name);

    return toNodeResponse(node, this.connected(node));
  }

  /**
   * Platform components the node runs (2026-10-30, console node page): from its stored desired state and the agent's
   * last apply report; members' Postgres role from their Patroni. No secrets.
   */
  async platform(name: string): Promise<NodePlatformComponentDto[]> {
    const node = await this.nodes.findByNameOrThrow(name);
    const desired = await this.network.getDesiredState(name);
    const connected = this.connected(node);
    const patroni = desired?.controlPlane?.role === 'member' && connected ? await this.patroniRole(node) : null;

    return nodePlatformComponents(desired, { connected, lastReportSteps: node.lastReportSteps }, patroni);
  }

  /** The member's Postgres role as its Patroni reports it (null: unreachable / unknown); overridable in tests. */
  protected async patroniRole(node: NodeEntity, timeoutMs = 1_500): Promise<PatroniRole> {
    const overlay = node.overlayV4 ?? node.overlayV6;

    if (!overlay) return null;

    const address = overlay.includes(':') ? `[${overlay}]` : overlay;

    try {
      const res = await fetch(`http://${address}:${PATRONI_PORT}/patroni`, { signal: AbortSignal.timeout(timeoutMs) });

      // Patroni answers 503 on a replica's `/patroni` only when it isn't running; the body has the role either way.
      return patroniRole(await res.json());
    } catch {
      return null;
    }
  }

  /** Connected to any replica (3.43): a stream here, or a fresh heartbeat recorded by another replica. */
  private connected(node: NodeEntity): boolean {
    return !!this.sessions.get(node.name) || nodeConnectedInCluster(node, Date.now());
  }

  async join(request: JoinRequest): Promise<JoinResponse> {
    if (request.hello.nodeName !== request.nodeName)
      throw new BadRequestException('hello.nodeName must match nodeName');

    const result = await this.dataSource.transaction(async (manager) => {
      const token = await this.tokens.consume(manager, request.token, request.nodeName);
      const repo = manager.getRepository(NodeEntity);
      const existing = await repo.findOne({ where: { name: request.nodeName }, lock: { mode: 'pessimistic_write' } });

      if (existing && existing.lifecycle !== 'left')
        throw new ConflictException('a node with this name is already part of the cluster');

      const requestedLabels = labelsSchema.safeParse(request.labels ?? {});

      if (!requestedLabels.success) throw new BadRequestException('invalid labels');

      // Token labels win over self-reported ones: the operator who issued the token decides.
      const labels = { ...requestedLabels.data, ...token.labels };

      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_ALLOCATION]);

      const clusterResource = await manager
        .getRepository(ResourceEntity)
        .findOneOrFail({ where: { kind: 'Cluster', projectKey: '' } });
      const network = clusterSpecSchema.parse(clusterResource.spec).network;
      const members = await repo.find({ where: { lifecycle: Not('left') } });
      // Subnets of left nodes stay reserved while live-migrated replicas keep addresses from them (3.10).
      const placements = await manager
        .getRepository(WorkloadPlacementEntity)
        .find({ select: { id: true, addresses: true, targetAddresses: true } });
      const held = heldPodSubnets(
        await repo.find({ where: { lifecycle: 'left' } }),
        placements.flatMap((p) => [...p.addresses, ...(p.targetAddresses ?? [])]),
      );
      const addressing = allocateNodeAddressing(network, [...members, ...held]);
      const issued = await this.identity.issueNodeCertificate(request.nodeName, request.csrPem);
      const node = existing ?? repo.create({ name: request.nodeName });

      Object.assign(node, {
        site: token.site,
        // Joined for an import (3.21): no desired state, nothing changes on the host until its join plan is applied.
        lifecycle: (request.discover ? 'pending' : 'active') as NodeLifecycle,
        reservedPorts: null,
        labels,
        controlPlane: false,
        witness: token.witness,
        agentVersion: request.hello.agentVersion,
        os: request.hello.os,
        capabilities: request.hello.capabilities as unknown as Record<string, unknown>,
        capacity: request.hello.capacity,
        usage: null,
        wireguardPublicKey: request.hello.wireguardPublicKey,
        endpointHost: request.hello.endpointHost ?? null,
        sealPublicKey: request.hello.sealPublicKey ?? null,
        // DRBD's `on` sections name the host (3.5): known from the join on, so a volume placed before the first stream
        // hello isn't rendered under the node name; a re-join on another host doesn't keep the old host's name.
        hostname: request.hello.hostname ?? null,
        ...addressing,
        certificateFingerprints: [issued.fingerprintSha256],
        certificateNotAfter: issued.notAfter,
        appliedRevision: 0,
        applyStatus: null,
        applyError: null,
        lastSeenAt: new Date(),
        joinedAt: new Date(),
      });
      await repo.save(node);

      if (request.discover && request.discovery) {
        // A former member's last desired state must never reach the pending agent.
        await manager.getRepository(NodeDesiredStateEntity).delete({ nodeName: node.name });
        await manager.getRepository(NodeDiscoveryEntity).save({
          node: node.name,
          id: randomUUID(),
          report: sanitizeDiscovery(request.discovery),
          source: 'join',
          requestId: null,
          requestedAt: null,
          receivedAt: new Date(),
        });
      }

      const nodeResource: Resource<'Node'> = {
        apiVersion: LOADWEAVER_API_VERSION,
        kind: 'Node',
        metadata: { name: node.name },
        spec: { site: node.site, labels, unschedulable: false, witness: node.witness },
      };

      await this.store.upsert(manager, nodeResource, 'system');
      await this.audit.record(manager, {
        actor: { type: 'node', id: node.name },
        action: request.discover ? 'node.join-for-import' : existing ? 'node.rejoin' : 'node.join',
        target: `node/${node.name}`,
        details: {
          site: node.site,
          witness: node.witness,
          tokenPrefix: token.tokenPrefix,
          serialNumber: issued.serialNumber,
          ...addressing,
        },
      });

      return { node, issued };
    });

    this.network.requestRecompile(`node ${request.nodeName} joined`);

    return {
      clusterId: result.issued.clusterId,
      nodeName: result.node.name,
      certificatePem: result.issued.certificatePem,
      caCertificatePem: result.issued.caCertificatePem,
      controlPlaneEndpoints: readControlPlaneEndpoints(),
      ...(request.discover ? { pending: true as const } : {}),
    };
  }

  async setLifecycle(
    name: string,
    lifecycle: Extract<NodeLifecycle, 'active' | 'cordoned' | 'draining'>,
    actor: AuditActor,
  ): Promise<NodeResponseDto> {
    const node = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(NodeEntity);
      const entity = await repo.findOne({ where: { name }, lock: { mode: 'pessimistic_write' } });

      if (!entity || entity.lifecycle === 'left')
        throw new BadRequestException(`node ${name} is not part of the cluster`);

      if (IMPORT_LIFECYCLES.includes(entity.lifecycle))
        throw new ConflictException(`node ${name} waits for its join plan (import wizard)`);

      if (entity.lifecycle === lifecycle) return entity;

      const from = entity.lifecycle;

      entity.lifecycle = lifecycle;
      await repo.save(entity);
      await this.audit.record(manager, {
        actor,
        action: `node.${lifecycle === 'active' ? 'uncordon' : lifecycle === 'cordoned' ? 'cordon' : 'drain'}`,
        target: `node/${name}`,
        details: { from, to: lifecycle },
      });

      return entity;
    });

    this.network.requestRecompile(`node ${name} is now ${lifecycle}`);

    return toNodeResponse(node, this.connected(node));
  }

  /**
   * Re-runs a node's isolation probes now (3.1): a fresh nonce in its desired state (`host.probeNonce`); the agent
   * reports the new capabilities when done.
   */
  async requestIsolationProbe(name: string, actor: AuditActor): Promise<{ node: string; probeNonce: string }> {
    const nonce = randomUUID();

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(NodeEntity);
      const entity = await repo.findOne({ where: { name }, lock: { mode: 'pessimistic_write' } });

      if (!entity || entity.lifecycle === 'left')
        throw new BadRequestException(`node ${name} is not part of the cluster`);

      entity.isolationProbeNonce = nonce;
      await repo.save(entity);
      await this.audit.record(manager, {
        actor,
        action: 'node.isolation-probe',
        target: `node/${name}`,
        details: { probeNonce: nonce },
      });
    });

    this.network.requestRecompile(`isolation probe requested on ${name}`);

    return { node: name, probeNonce: nonce };
  }

  /**
   * Planned removal (3.12): the node must be drained first; its identity is revoked immediately.
   * Workload evacuation and the capacity check with workload selection arrive with the scheduler (M2).
   */
  async leave(name: string, actor: AuditActor): Promise<NodeResponseDto> {
    const node = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(NodeEntity);
      const entity = await repo.findOne({ where: { name }, lock: { mode: 'pessimistic_write' } });

      if (!entity || entity.lifecycle === 'left')
        throw new BadRequestException(`node ${name} is not part of the cluster`);

      // A node still pending its join plan runs nothing of the cluster: it can leave right away (import discarded).
      if (entity.lifecycle !== 'draining' && entity.lifecycle !== 'pending')
        throw new ConflictException('drain the node before it leaves');

      // No data loss on leave (3.2): workloads and volume copies must have moved off first.
      const placements = await manager
        .getRepository(WorkloadPlacementEntity)
        .count({ where: [{ node: name }, { targetNode: name }] });
      const volumes = (await manager.getRepository(VolumePlacementEntity).find()).filter((v) =>
        [v.primaryNode, ...v.syncReplicas, ...v.remoteReplicas].includes(name),
      );

      if (placements > 0 || volumes.length > 0) {
        // VMs writing their first boot disk move once the import finished (M7 F4).
        const importing =
          placements > 0
            ? drainImportNote(
                await manager.getRepository(WorkloadPlacementEntity).find({ where: { node: name } }),
                name,
              )
            : '';

        throw new ConflictException(
          `the node still runs ${placements} replica(s) and holds ${volumes.length} volume copy(ies); wait for the drain to finish${importing}`,
        );
      }

      // Object-store data moves off with Garage's rebalance or a new generation (3.20).
      const objectStore = (await manager.getRepository(ObjectStoreGenerationEntity).find()).filter(
        (g) => g.state !== 'retired' && g.holders.includes(name),
      );

      if (objectStore.length > 0) {
        throw new ConflictException(
          `the node still holds object-store data (generation ${objectStore.map((g) => g.generation).join(', ')}); wait until it moved`,
        );
      }

      const remaining = await repo.count({ where: { lifecycle: Not('left') } });

      if (remaining <= 1) throw new ConflictException('the last node cannot leave the cluster');

      entity.lifecycle = 'left';
      entity.controlPlane = false;
      // Its etcd data leaves with it (3.43): it no longer counts against a bootstrap of the remaining members.
      entity.etcdMemberSince = null;
      entity.etcdReportedAt = null;
      entity.etcdBootstrapAt = null;
      entity.certificateFingerprints = [];
      await repo.save(entity);
      await this.store.remove(manager, { kind: 'Node', name });
      await this.audit.record(manager, { actor, action: 'node.leave', target: `node/${name}` });

      return entity;
    });

    // The session isn't closed here (3.43): whichever replica the agent streams to sends it its last state without
    // the control-plane role and then closes it (`AgentStreamServer.farewell`, on the next push round or heartbeat).
    this.network.requestRecompile(`node ${name} left`);

    return toNodeResponse(node, false);
  }

  /**
   * Confirms a node is gone for good (2 nodes without a witness, 3.2): stateful workloads may then fail over
   * without quorum. The operator takes responsibility that the node does not come back writing.
   */
  async confirmLost(name: string, actor: AuditActor): Promise<NodeResponseDto> {
    const node = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(NodeEntity);
      const entity = await repo.findOne({ where: { name }, lock: { mode: 'pessimistic_write' } });

      if (!entity || entity.lifecycle === 'left')
        throw new BadRequestException(`node ${name} is not part of the cluster`);

      if (this.connected(entity)) throw new ConflictException('the node is connected; it is not lost');

      entity.lostConfirmedAt = new Date();
      entity.certificateFingerprints = [];
      await repo.save(entity);
      await this.audit.record(manager, { actor, action: 'node.confirm-lost', target: `node/${name}` });

      return entity;
    });

    return toNodeResponse(node, false);
  }
}
