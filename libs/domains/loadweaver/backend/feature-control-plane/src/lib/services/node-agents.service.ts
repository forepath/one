import type {
  AgentEvent,
  AgentHello,
  ApplyReport,
  CertificateIssued,
  Heartbeat,
  WorkloadStatus,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { NODE_HEARTBEAT_TIMEOUT_MS } from '../constants/control-plane.constants';
import { NodeEntity } from '../entities/node.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { AuditLogService } from './audit-log.service';
import { ClusterIdentityService } from './cluster-identity.service';
import { NetworkStateService } from './network-state.service';

/**
 * Handles what node agents report over their stream: inventory (hello), liveness (heartbeat),
 * apply results, certificate rotation and platform events.
 */
@Injectable()
export class NodeAgentsService {
  private readonly logger = new Logger(NodeAgentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly identity: ClusterIdentityService,
    private readonly network: NetworkStateService,
    private readonly audit: AuditLogService,
  ) {}

  async handleHello(nodeName: string, hello: AgentHello): Promise<void> {
    if (hello.nodeName !== nodeName) {
      throw new Error('hello node name does not match the certificate identity');
    }

    const recompile = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(NodeEntity);
      const node = await repo.findOneOrFail({ where: { name: nodeName }, lock: { mode: 'pessimistic_write' } });
      const networkChanged =
        node.wireguardPublicKey !== hello.wireguardPublicKey || (node.endpointHost ?? undefined) !== hello.endpointHost;

      if (node.wireguardPublicKey !== hello.wireguardPublicKey) {
        await this.audit.record(manager, {
          actor: { type: 'node', id: nodeName },
          action: 'node.wireguard-key-rotated',
          target: `node/${nodeName}`,
        });
      }

      node.agentVersion = hello.agentVersion;
      node.os = hello.os;
      node.capabilities = hello.capabilities as unknown as Record<string, unknown>;
      node.capacity = hello.capacity;
      node.wireguardPublicKey = hello.wireguardPublicKey;
      node.endpointHost = hello.endpointHost ?? null;

      if (hello.sealPublicKey && node.sealPublicKey !== hello.sealPublicKey) {
        // A new seal key invalidates the node's master-key share; the next re-share includes the new key.
        node.sealPublicKey = hello.sealPublicKey;
        await this.audit.record(manager, {
          actor: { type: 'node', id: nodeName },
          action: 'node.seal-key-changed',
          target: `node/${nodeName}`,
        });
      }
      node.appliedRevision = hello.appliedRevision;
      node.lastSeenAt = new Date();
      await repo.save(node);

      return networkChanged;
    });

    if (recompile) this.network.requestRecompile(`node ${nodeName} changed its WireGuard identity or endpoint`);
  }

  async handleHeartbeat(nodeName: string, heartbeat: Heartbeat): Promise<void> {
    await this.dataSource
      .getRepository(NodeEntity)
      .update(
        { name: nodeName },
        { usage: heartbeat.usage, appliedRevision: heartbeat.appliedRevision, lastSeenAt: new Date() },
      );
  }

  async handleApplyReport(nodeName: string, report: ApplyReport): Promise<void> {
    await this.dataSource.getRepository(NodeEntity).update(
      { name: nodeName },
      {
        ...(report.status === 'applied' ? { appliedRevision: report.revision } : {}),
        applyStatus: report.status,
        applyError: report.error ?? null,
        lastSeenAt: new Date(),
      },
    );

    if (report.status !== 'applied') {
      this.logger.warn(
        `Node ${nodeName} failed to apply revision ${report.revision}: ${report.error ?? 'unknown error'}`,
      );
    }
  }

  /** Automatic rotation (3.21): the new certificate is accepted alongside the current one until the next rotation. */
  async renewCertificate(nodeName: string, csrPem: string): Promise<CertificateIssued> {
    const issued = await this.identity.issueNodeCertificate(nodeName, csrPem);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(NodeEntity);
      const node = await repo.findOneOrFail({ where: { name: nodeName }, lock: { mode: 'pessimistic_write' } });

      node.certificateFingerprints = [issued.fingerprintSha256, ...node.certificateFingerprints.slice(0, 1)];
      node.certificateNotAfter = issued.notAfter;
      await repo.save(node);
      await this.audit.record(manager, {
        actor: { type: 'node', id: nodeName },
        action: 'node.certificate-rotated',
        target: `node/${nodeName}`,
        details: { serialNumber: issued.serialNumber, notAfter: issued.notAfter.toISOString() },
      });
    });

    return { certificatePem: issued.certificatePem, caCertificatePem: issued.caCertificatePem };
  }

  /** Platform events, labelled with the node (3.14). Shipped to the log store once it exists (M5). */
  handleEvent(nodeName: string, event: AgentEvent): void {
    const line = JSON.stringify({
      node: nodeName,
      source: event.source,
      at: event.at,
      labels: event.labels,
      message: event.message,
    });

    switch (event.level) {
      case 'error':
        this.logger.error(line);
        break;
      case 'warn':
        this.logger.warn(line);
        break;
      default:
        this.logger.log(line);
    }
  }

  /**
   * Runtime state of the node's workloads (3.25 health, 3.19 progress). Replicas expected on the node but missing
   * from the report are recorded as `absent`, which completes short-stop migrations (3.10).
   */
  async handleWorkloadStatus(nodeName: string, status: WorkloadStatus): Promise<void> {
    const repo = this.dataSource.getRepository(WorkloadPlacementEntity);
    const at = new Date().toISOString();
    const reported = new Map(status.workloads.map((w) => [w.id, w]));
    const placements = await repo.find({ where: [{ node: nodeName }, { targetNode: nodeName }] });
    const up = (state: string | undefined) => state === 'healthy' || state === 'running';
    let flipped = false;

    for (const placement of placements) {
      const workload = reported.get(placement.id);

      // Health-gated BGP announcements follow replicas going up or down (3.27).
      if (up(placement.status?.[nodeName]?.state) !== up(workload?.state)) flipped = true;
      const entry = workload
        ? {
            state: workload.state,
            ...(workload.exitCode !== undefined ? { exitCode: workload.exitCode } : {}),
            ...(workload.message ? { message: workload.message } : {}),
            specHash: workload.specHash,
            at,
          }
        : { state: 'absent', specHash: '', at };

      // Atomic per-node merge: reports of the source and target node of a migration never overwrite each other.
      await repo
        .createQueryBuilder()
        .update()
        .set({
          status: () =>
            `COALESCE(status, '{}'::jsonb) || jsonb_build_object(CAST(:node AS text), CAST(:entry AS jsonb))`,
        })
        .where('id = :id', { id: placement.id })
        .setParameters({ node: nodeName, entry: JSON.stringify(entry) })
        .execute();
    }

    if (flipped) this.network.requestRecompile(`workload health on ${nodeName}`);
  }

  async markDisconnected(nodeName: string): Promise<void> {
    await this.dataSource.getRepository(NodeEntity).update({ name: nodeName }, { lastSeenAt: new Date() });
    // What depends on reachability (health-gated announcements, 3.27) is recomputed once the node counts as gone.
    setTimeout(
      () => this.network.requestRecompile(`agent ${nodeName} disconnected`),
      NODE_HEARTBEAT_TIMEOUT_MS + 1_000,
    ).unref();
  }
}
