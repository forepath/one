import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Optional, Req } from '@nestjs/common';

import { NodesRepository } from '../repositories/nodes.repository';
import { AuditService, type AnchorVerification } from '../audit/audit.service';
import { BuiltinMemberService, type BuiltinMemberState } from '../builtin-member/builtin-member.service';
import { DatabaseHandoverService, type DatabaseHandoverStatus } from '../database-handover/database-handover.service';
import { SiemForwarderService } from '../siem/siem-forwarder.service';
import { AuditLogService, type AuditVerification } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { ClusterIdentityService } from '../services/cluster-identity.service';
import { MasterKeyService } from '../services/master-key.service';
import { nodeConnectedInCluster } from '../services/nodes.service';
import type { BuiltinMemberMode, BuiltinMemberRole } from '../utils/builtin-member.utils';
import { ResourceStoreService } from '../services/resource-store.service';
import { computeControlPlaneMembership } from '../utils/control-plane-membership.utils';
import { consoleBaseUrl } from '../git/git-sync.utils';

export interface ClusterSummaryDto {
  clusterId: string;
  displayName: string;
  caCertificate: string;
  desiredRevision: number;
  /**
   * The cluster's own public API URL (`LOADWEAVER_PUBLIC_URL`, what every install script embeds) and console URL
   * (`LOADWEAVER_CONSOLE_URL`, else the public URL); null when not configured. Public anyway — through a fleet they
   * build the same installer line and native links as the cluster's own console (2026-10-29).
   */
  publicUrl: string | null;
  consoleUrl: string | null;
  nodes: { total: number; connected: number; sites: string[] };
  controlPlane: {
    members: string[];
    votingWitnesses: string[];
    automaticFailover: boolean;
    warnings: string[];
    /**
     * The built-in control-plane member (3.39): a master-key holder inside the control-plane API, never a node and
     * never schedulable. `active` = sole holder (no real member with a seal key), `standby` = keeps an in-sync copy.
     */
    builtin: {
      mode: BuiltinMemberMode;
      state: BuiltinMemberState;
      role: BuiltinMemberRole;
      holder: boolean;
      standby: boolean;
      realMembers: number;
      instance: string | null;
      lastSeenAt: string | null;
    };
    /**
     * Where the cluster's database lives for this control plane (3.43): `external` (own Postgres, handed over once a
     * member's leader is up), `members`, or null on the members themselves; `readOnly` while every member is unreachable.
     */
    database?: DatabaseHandoverStatus;
    /** How the active master key is held (names only, never key material). */
    masterKey: {
      state: 'none' | 'sealed' | 'unsealed';
      threshold: number;
      holders: string[];
      kms: string | null;
      builtinStandby: boolean;
    };
  };
}

/** `LOADWEAVER_PUBLIC_URL` when it is an http(s) URL (as the installer uses it), else null. */
export function publicApiUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = (env['LOADWEAVER_PUBLIC_URL'] ?? '').trim().replace(/\/+$/, '');

  return /^https?:\/\/[^\s]+$/.test(url) ? url : null;
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
    private readonly audit: AuditLogService,
    private readonly access: ClusterAccessService,
    private readonly auditMirror: AuditService,
    private readonly siemForwarder: SiemForwarderService,
    private readonly masterKey: MasterKeyService,
    private readonly builtin: BuiltinMemberService,
    @Optional() private readonly database?: DatabaseHandoverService,
  ) {}

  @Get()
  @RequireScopes('cluster:read')
  async summary(@Req() req?: RequestWithUser): Promise<ClusterSummaryDto> {
    await this.access.assert(req, 'read');

    const cluster = await this.identity.cluster();
    const members = await this.nodes.findMembers();
    const now = Date.now();
    const spec = await this.store.clusterSpec();
    const [status, role, key] = await Promise.all([
      this.builtin.status(),
      this.masterKey.builtinRole(),
      this.masterKey.describe(),
    ]);

    return {
      clusterId: cluster.clusterId,
      displayName: cluster.displayName,
      caCertificate: cluster.caCertificate,
      desiredRevision: cluster.desiredRevision,
      publicUrl: publicApiUrl(),
      consoleUrl: consoleBaseUrl(),
      nodes: {
        total: members.length,
        // A fresh heartbeat on any replica (not just a stream to this one), live during the read-only fallback.
        connected: members.filter((m) => nodeConnectedInCluster(m, now)).length,
        sites: [...new Set(members.map((m) => m.site))].sort(),
      },
      controlPlane: {
        ...computeControlPlaneMembership(members, spec.controlPlaneSize),
        builtin: {
          mode: status.mode,
          state: status.state,
          role: role.role,
          holder: role.holder,
          standby: role.standby,
          realMembers: role.realMembers,
          instance: status.instance,
          lastSeenAt: status.lastSeenAt,
        },
        ...(this.database ? { database: this.database.status() } : {}),
        masterKey: {
          state: !key ? 'none' : this.masterKey.unsealed ? 'unsealed' : 'sealed',
          threshold: key?.threshold ?? 0,
          holders: key?.holders ?? [],
          kms: key?.kms?.provider ?? null,
          builtinStandby: key?.builtinStandby ?? false,
        },
      },
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
