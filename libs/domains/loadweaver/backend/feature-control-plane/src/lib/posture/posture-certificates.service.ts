import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { postureProofMessage, type PostureReportInput } from '@forepath/loadweaver/shared/util-model';
import {
  caBundleIssues,
  parseCertificateBundle,
  parseCrlBundle,
  verifyCertificate,
  verifyDeviceCertificate,
  verifyPossession,
} from '@forepath/loadweaver/shared/util-pki';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { PostureCertificateTrustEntity } from '../entities/posture-integration.entity';
import { VpnClientEntity } from '../entities/vpn-client.entity';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { ClusterIdentityService } from '../services/cluster-identity.service';
import type { CertificateFact } from './posture-facts';

const TRUST_ID = 'default';
const PROOF_WINDOW_MS = 5 * 60_000;
const MAX_PEM = 262_144;
const MIN_CERTIFICATE_HOURS = 1;

export interface CertificateTrustSettings {
  companyCaPem: string | null;
  crlPem: string | null;
  trustClusterCa: boolean;
  requireProof: boolean;
  /** Subjects of the company CA bundle, for display. */
  companyCaSubjects: string[];
  updatedAt: string | null;
}

export interface IssuedDeviceCertificate {
  certificatePem: string;
  caCertificatePem: string;
  serialNumber: string;
  notAfter: string;
}

/**
 * Device certificates as posture facts (3.31): trust settings (company CA bundle + CRLs, the cluster's enrollment
 * CA), issuing device certificates from the cluster CA at enrollment (CSR from the device, key never leaves it),
 * and verifying the certificate a posture report carries, bound to the device.
 */
@Injectable()
export class PostureCertificatesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClusterAccessService,
    private readonly audit: AuditLogService,
    private readonly identity: ClusterIdentityService,
  ) {}

  private async trust(): Promise<PostureCertificateTrustEntity> {
    return (
      (await this.dataSource.getRepository(PostureCertificateTrustEntity).findOne({ where: { id: TRUST_ID } })) ??
      Object.assign(new PostureCertificateTrustEntity(), {
        id: TRUST_ID,
        companyCaPem: null,
        crlPem: null,
        trustClusterCa: true,
        requireProof: true,
      })
    );
  }

  private view(t: PostureCertificateTrustEntity): CertificateTrustSettings {
    return {
      companyCaPem: t.companyCaPem,
      crlPem: t.crlPem,
      trustClusterCa: t.trustClusterCa,
      requireProof: t.requireProof,
      companyCaSubjects: caBundleSubjects(t.companyCaPem ?? ''),
      updatedAt: t.updatedAt?.toISOString() ?? null,
    };
  }

  async settings(req: RequestWithUser | undefined): Promise<CertificateTrustSettings> {
    await this.access.assert(req, 'infra');

    return this.view(await this.trust());
  }

  async updateSettings(
    req: RequestWithUser | undefined,
    input: { companyCaPem?: string | null; crlPem?: string | null; trustClusterCa?: boolean; requireProof?: boolean },
  ): Promise<CertificateTrustSettings> {
    await this.access.assert(req, 'admin');

    const current = await this.trust();
    const companyCaPem = input.companyCaPem === undefined ? current.companyCaPem : input.companyCaPem?.trim() || null;
    const crlPem = input.crlPem === undefined ? current.crlPem : input.crlPem?.trim() || null;

    if ((companyCaPem?.length ?? 0) > MAX_PEM || (crlPem?.length ?? 0) > MAX_PEM)
      throw new BadRequestException('PEM bundles are limited to 256 KiB');

    if (companyCaPem) {
      const issues = caBundleIssues(companyCaPem);

      if (issues.length) throw new BadRequestException(issues.join('; '));
    }

    if (crlPem) {
      try {
        parseCrlBundle(crlPem);
      } catch {
        throw new BadRequestException('the CRL bundle is invalid');
      }
    }

    const next = Object.assign(current, {
      companyCaPem,
      crlPem,
      trustClusterCa: input.trustClusterCa ?? current.trustClusterCa,
      requireProof: input.requireProof ?? current.requireProof,
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(PostureCertificateTrustEntity).save(next);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'posture.certificates.update',
        target: 'posture/certificates',
        details: {
          companyCa: caBundleSubjects(companyCaPem ?? ''),
          crl: !!crlPem,
          trustClusterCa: next.trustClusterCa,
          requireProof: next.requireProof,
        },
      });
    });

    return this.view(await this.trust());
  }

  /**
   * A device certificate from the cluster CA for the caller's own device (interactive login, like enrollment): the
   * identity is `spiffe://<cluster>.loadweaver/client/<device id>`, valid until the device key expires. A new
   * certificate supersedes the previous one.
   */
  async issue(req: RequestWithUser | undefined, clientId: string, csrPem: string): Promise<IssuedDeviceCertificate> {
    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (info.isApiKeyAuth || !info.userId || (info.amr ?? []).includes('pat'))
      throw new BadRequestException('device certificates need an interactive login');

    const repo = this.dataSource.getRepository(VpnClientEntity);
    const client = await repo.findOne({ where: { id: clientId, userId: info.userId, kind: 'user' } });
    const now = Date.now();

    if (!client || client.revokedAt || client.expiresAt.getTime() <= now)
      throw new NotFoundException('device not found');

    const hours = Math.max(MIN_CERTIFICATE_HOURS, Math.floor((client.expiresAt.getTime() - now) / 3_600_000));
    let issued: Awaited<ReturnType<ClusterIdentityService['issueClientCertificate']>>;

    try {
      issued = await this.identity.issueClientCertificate(client.id, csrPem, hours);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid CSR');
    }

    await repo.update(
      { id: client.id },
      { certificateSerial: issued.serialNumber.toLowerCase(), certificateNotAfter: issued.notAfter },
    );
    await this.audit.recordStandalone({
      actor: actorFromRequest(req),
      action: 'vpn.certificate.issue',
      target: `vpn/${client.id}`,
      details: { serialNumber: issued.serialNumber, notAfter: issued.notAfter.toISOString() },
    });

    return {
      certificatePem: issued.certificatePem,
      caCertificatePem: issued.caCertificatePem,
      serialNumber: issued.serialNumber.toLowerCase(),
      notAfter: issued.notAfter.toISOString(),
    };
  }

  /** Verifies the certificate of a posture report (trust, validity, revocation, binding, proof of possession). */
  async verifyReport(
    client: Pick<VpnClientEntity, 'id' | 'certificateSerial'>,
    certificate: NonNullable<PostureReportInput['certificate']>,
    now = new Date(),
  ): Promise<CertificateFact> {
    const trust = await this.trust();
    const checkedAt = now.toISOString();
    const reasons: string[] = [];
    const proof = certificate.proof;

    if (proof) {
      const at = Date.parse(proof.timestamp);

      if (Number.isNaN(at) || Math.abs(now.getTime() - at) > PROOF_WINDOW_MS)
        reasons.push('the proof of possession is outside the 5-minute window');
      else if (
        !(await verifyPossession(certificate.pem, postureProofMessage(client.id, proof.timestamp), proof.signature))
      )
        reasons.push('the proof of possession does not verify');
    } else if (trust.requireProof) reasons.push('no proof of possession for the device certificate');

    // The cluster's enrollment CA: the identity must be exactly this device, the serial the latest issued.
    if (trust.trustClusterCa) {
      const verified = await verifyCertificate(certificate.pem, await this.identity.caCertificate(), now);

      if (verified && verified.kind === 'client') {
        if (verified.name !== client.id) reasons.push('the device certificate belongs to another device');

        const serial = verified.serialNumber.toLowerCase();
        const revoked = !client.certificateSerial || serial !== client.certificateSerial;

        if (revoked) reasons.push('the device certificate was superseded or revoked');

        return {
          source: 'loadweaver',
          valid: reasons.length === 0,
          revoked,
          serialNumber: serial,
          notAfter: verified.notAfter.toISOString(),
          reasons,
          checkedAt,
        };
      }
    }

    if (!trust.companyCaPem)
      return {
        source: 'company',
        valid: false,
        revoked: false,
        reasons: [...reasons, 'the device certificate is not issued by a trusted CA'],
        checkedAt,
      };

    const check = await verifyDeviceCertificate({
      certificatePem: certificate.pem,
      trustBundlePem: trust.companyCaPem,
      ...(trust.crlPem ? { crlPem: trust.crlPem } : {}),
      now,
    });

    return {
      source: 'company',
      valid: check.valid && reasons.length === 0,
      revoked: check.revoked,
      ...(check.serialNumber ? { serialNumber: check.serialNumber } : {}),
      ...(check.notAfter ? { notAfter: check.notAfter.toISOString() } : {}),
      reasons: [...check.reasons, ...reasons],
      checkedAt,
    };
  }
}

function caBundleSubjects(pem: string): string[] {
  if (!pem.trim()) return [];

  try {
    return parseCertificateBundle(pem).map((c) => c.subject);
  } catch {
    return [];
  }
}
