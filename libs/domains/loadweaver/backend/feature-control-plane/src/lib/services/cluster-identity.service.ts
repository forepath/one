import { isIP } from 'node:net';

import {
  createCsr,
  generateKeyPair,
  issueCertificate,
  verifyCertificate,
  type IssuedCertificate,
  type VerifiedIdentity,
} from '@forepath/loadweaver/shared/util-pki';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { NODE_CERTIFICATE_VALIDITY_HOURS } from '../constants/control-plane.constants';
import { ClusterEntity } from '../entities/cluster.entity';

/** Control-plane serving certificates are short-lived and re-issued on every start. */
const SERVER_CERTIFICATE_VALIDITY_HOURS = 7 * 24;

export interface ServerKeyPair {
  certificatePem: string;
  privateKeyPem: string;
  caCertificatePem: string;
}

/**
 * Cluster CA operations: node identities (3.21), control-plane serving certificates, peer verification.
 */
/** Workload identities rotate daily; the agent renews them at half their lifetime. */
export const WORKLOAD_CERTIFICATE_VALIDITY_HOURS = 24;

@Injectable()
export class ClusterIdentityService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async cluster(): Promise<ClusterEntity> {
    return await this.dataSource.getRepository(ClusterEntity).findOneOrFail({ where: {} });
  }

  async caCertificate(): Promise<string> {
    return (await this.cluster()).caCertificate;
  }

  async issueNodeCertificate(
    nodeName: string,
    csrPem: string,
  ): Promise<IssuedCertificate & { caCertificatePem: string; clusterId: string }> {
    const cluster = await this.cluster();
    const issued = await issueCertificate({
      ca: { certificatePem: cluster.caCertificate, privateKeyPem: cluster.caPrivateKey },
      csrPem,
      clusterId: cluster.clusterId,
      kind: 'node',
      name: nodeName,
      validityHours: NODE_CERTIFICATE_VALIDITY_HOURS,
    });

    return { ...issued, caCertificatePem: cluster.caCertificate, clusterId: cluster.clusterId };
  }

  /** A workload identity (`project/deployment/service`) for the node proxies' mTLS (3.7); short-lived. */
  async issueWorkloadCertificate(identity: string, csrPem: string): Promise<IssuedCertificate> {
    const cluster = await this.cluster();

    return await issueCertificate({
      ca: { certificatePem: cluster.caCertificate, privateKeyPem: cluster.caPrivateKey },
      csrPem,
      clusterId: cluster.clusterId,
      kind: 'workload',
      name: identity,
      validityHours: WORKLOAD_CERTIFICATE_VALIDITY_HOURS,
    });
  }

  /** Issues the gRPC serving certificate of this replica for the given hostnames / IPs. */
  async issueServerCertificate(names: string[]): Promise<ServerKeyPair> {
    const cluster = await this.cluster();
    const keys = await generateKeyPair();
    const issued = await issueCertificate({
      ca: { certificatePem: cluster.caCertificate, privateKeyPem: cluster.caPrivateKey },
      csrPem: await createCsr(keys, 'control-plane'),
      clusterId: cluster.clusterId,
      kind: 'control-plane',
      name: 'api',
      dnsNames: names.filter((n) => isIP(n) === 0),
      ipAddresses: names.filter((n) => isIP(n) !== 0),
      validityHours: SERVER_CERTIFICATE_VALIDITY_HOURS,
    });

    return {
      certificatePem: issued.certificatePem,
      privateKeyPem: keys.privateKeyPem,
      caCertificatePem: cluster.caCertificate,
    };
  }

  /** Verifies a peer certificate (PEM) against the cluster CA and returns its identity, or null. */
  async verifyPeer(certificatePem: string): Promise<VerifiedIdentity | null> {
    const cluster = await this.cluster();
    const identity = await verifyCertificate(certificatePem, cluster.caCertificate);

    return identity && identity.clusterId === cluster.clusterId ? identity : null;
  }
}

export function derToPem(der: Buffer): string {
  const body =
    der
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n') ?? '';

  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}
