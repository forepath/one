import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Req } from '@nestjs/common';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { NodesRepository } from '../repositories/nodes.repository';
import { AuditService, type AnchorVerification } from '../audit/audit.service';
import { SiemForwarderService } from '../siem/siem-forwarder.service';
import { AuditLogService, type AuditVerification } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { ClusterIdentityService } from '../services/cluster-identity.service';
import { ResourceStoreService } from '../services/resource-store.service';
import { computeControlPlaneMembership } from '../utils/control-plane-membership.utils';

export interface ClusterSummaryDto {
  clusterId: string;
  displayName: string;
  caCertificate: string;
  desiredRevision: number;
  nodes: { total: number; connected: number; sites: string[] };
  controlPlane: { members: string[]; votingWitnesses: string[]; automaticFailover: boolean; warnings: string[] };
}

/**
 * Cluster summary and audit chain verification.
 */
@Controller('cluster')
export class ClusterController {
  constructor(
    private readonly identity: ClusterIdentityService,
    private readonly nodes: NodesRepository,
    private readonly store: ResourceStoreService,
    private readonly sessions: AgentSessionRegistry,
    private readonly audit: AuditLogService,
    private readonly access: ClusterAccessService,
    private readonly auditMirror: AuditService,
    private readonly siemForwarder: SiemForwarderService,
  ) {}

  @Get()
  @RequireScopes('cluster:read')
  async summary(@Req() req?: RequestWithUser): Promise<ClusterSummaryDto> {
    await this.access.assert(req, 'read');

    const cluster = await this.identity.cluster();
    const members = await this.nodes.findMembers();
    const spec = await this.store.clusterSpec();

    return {
      clusterId: cluster.clusterId,
      displayName: cluster.displayName,
      caCertificate: cluster.caCertificate,
      desiredRevision: cluster.desiredRevision,
      nodes: {
        total: members.length,
        connected: members.filter((m) => !!this.sessions.get(m.name)).length,
        sites: [...new Set(members.map((m) => m.site))].sort(),
      },
      controlPlane: computeControlPlaneMembership(members, spec.controlPlaneSize),
    };
  }

  /** Delivery state of the SIEM targets (3.18). */
  @Get('siem')
  @RequireScopes('audit:read')
  async siem(@Req() req?: RequestWithUser) {
    await this.access.assert(req, 'audit');

    return await this.siemForwarder.status();
  }

  /** The "verify" action of the hash-chained audit log (3.18). */
  @Get('audit/verify')
  @RequireScopes('audit:read')
  async verifyAudit(@Req() req?: RequestWithUser): Promise<AuditVerification & { anchors: AnchorVerification }> {
    await this.access.assert(req, 'audit');

    const [chain, anchors] = await Promise.all([this.audit.verify(), this.auditMirror.verifyAnchors()]);

    // A chain that verifies but disagrees with its anchors was rewritten after them.
    return anchors.mismatched.length
      ? { ...chain, ok: false, brokenAt: chain.brokenAt ?? anchors.mismatched.at(-1), anchors }
      : { ...chain, anchors };
  }
}
