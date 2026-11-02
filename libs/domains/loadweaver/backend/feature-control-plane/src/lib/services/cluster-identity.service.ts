import { isIP } from 'node:net';

import { POSTGRES_TLS_SERVER_NAME, type PostgresTls } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCsr,
  generateKeyPair,
  issueCertificate,
  verifyCertificate,
  type CertificateAuthority,
  type IssuedCertificate,
  type VerifiedIdentity,
} from '@forepath/loadweaver/shared/util-pki';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { NODE_CERTIFICATE_VALIDITY_HOURS } from '../constants/control-plane.constants';
import { ClusterEntity } from '../entities/cluster.entity';
import { PostgresCertificateEntity } from '../entities/postgres-certificate.entity';
import { memberPostgresCertificate, type PostgresCertificateStore } from './postgres-certificates';

/** Control-plane serving certificates are short-lived and re-issued on every start. */
const SERVER_CERTIFICATE_VALIDITY_HOURS = 7 * 24;

export interface ServerKeyPair {
  certificatePem: string;
  privateKeyPem: string;
  caCertificatePem: string;
}

/**
 * Members' Postgres server certificates; stored and reused by the control plane until a third of the lifetime is
 * left (`postgres-certificates.ts`), which is also when the agent switches to the offered one.
 */
export const POSTGRES_CERTIFICATE_VALIDITY_HOURS = 365 * 24;

/**
 * A member's Postgres server certificate (3.2): the name the API checks through the leader proxy
 * (`POSTGRES_TLS_SERVER_NAME`) and the member's overlay address (replicas, operators), identity
 * `control-plane/postgres/<node>`. A fresh key every time; callers store and reuse it (`memberPostgresCertificate`).
 */
export async function issuePostgresServerCertificate(
  ca: CertificateAuthority,
  clusterId: string,
  nodeName: string,
  address: string,
  now?: Date,
): Promise<PostgresTls> {
  const keys = await generateKeyPair();
  const issued = await issueCertificate({
    ca,
    csrPem: await createCsr(keys, 'postgres'),
    clusterId,
    kind: 'control-plane',
    name: `postgres/${nodeName}`,
    dnsNames: [POSTGRES_TLS_SERVER_NAME],
    ipAddresses: isIP(address) !== 0 ? [address] : [],
    validityHours: POSTGRES_CERTIFICATE_VALIDITY_HOURS,
    now,
  });

  return {
    certificatePem: issued.certificatePem,
    privateKeyPem: keys.privateKeyPem,
    caCertificatePem: ca.certificatePem,
  };
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

  /** A remote access device certificate (`client/<device id>`, 3.31), a posture fact; the key stays on the device. */
  async issueClientCertificate(
    clientId: string,
    csrPem: string,
    validityHours: number,
  ): Promise<IssuedCertificate & { caCertificatePem: string }> {
    const cluster = await this.cluster();
    const issued = await issueCertificate({
      ca: { certificatePem: cluster.caCertificate, privateKeyPem: cluster.caPrivateKey },
      csrPem,
      clusterId: cluster.clusterId,
      kind: 'client',
      name: clientId,
      validityHours,
    });

    return { ...issued, caCertificatePem: cluster.caCertificate };
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

  /**
   * The member's Postgres server certificate, added to its control-plane role at push time only: the stored one
   * while it covers the member and has more than a third of its lifetime left, else a new one (stored). Every
   * replica pushes the same certificate, so pushes of an unchanged state are identical.
   */
  async memberPostgresCertificate(nodeName: string, address: string, now: Date = new Date()): Promise<PostgresTls> {
    const cluster = await this.cluster();
    const ca = { certificatePem: cluster.caCertificate, privateKeyPem: cluster.caPrivateKey };

    return (
      await memberPostgresCertificate(
        this.postgresCertificateStore(),
        async () => await issuePostgresServerCertificate(ca, cluster.clusterId, nodeName, address, now),
        nodeName,
        address,
        cluster.caCertificate,
        now,
      )
    ).tls;
  }

  /** Stored member certificates in `lw_postgres_certificates`; replacements are compare-and-swap on the serial. */
  postgresCertificateStore(): PostgresCertificateStore {
    const repo = this.dataSource.getRepository(PostgresCertificateEntity);

    return {
      load: async (nodeName) => await repo.findOne({ where: { nodeName } }),
      replace: async (next, previous) => {
        if (previous) {
          const { nodeName, ...fields } = next;

          await repo.update({ nodeName, serial: previous.serial }, fields);
        } else
          await repo.createQueryBuilder().insert().into(PostgresCertificateEntity).values(next).orIgnore().execute();

        return await repo.findOneOrFail({ where: { nodeName: next.nodeName } });
      },
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
