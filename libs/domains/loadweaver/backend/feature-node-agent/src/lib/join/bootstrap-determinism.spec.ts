import { randomBytes } from 'node:crypto';

import {
  memberPlatformBackups,
  POSTGRES_TLS_SERVER_NAME,
  type ControlPlaneRole,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
} from '@forepath/loadweaver/shared/util-pki';

import { controlPlaneImages, postgresSpec, type MemberContext } from '../control-plane/control-plane-containers';
import { bootstrapPlatformBackups, JoinService } from './join.service';

/**
 * User decision 2026-10-27 "bootstrap with the final config": the Postgres container `bootstrap` starts is the one
 * the first apply wants (no re-create → no read-only window), and membership changes / certificate renewals keep it.
 */
describe('bootstrap Postgres = first apply Postgres', () => {
  async function bootstrapRole(): Promise<ControlPlaneRole> {
    const state = { credentials: jest.fn().mockResolvedValue(null) };
    const controlPlane = { apply: jest.fn().mockResolvedValue(undefined) };
    const service = new JoinService(state as never, {} as never, controlPlane as never);

    jest
      .spyOn(service as unknown as { waitForApi: () => Promise<void> }, 'waitForApi')
      .mockRejectedValue(new Error('stop'));
    await expect(service.bootstrap({ nodeName: 'n1', publicHost: 'lw.example.com' })).rejects.toThrow('stop');
    expect(controlPlane.apply.mock.calls[0][1]).toBe('127.0.0.1');

    return controlPlane.apply.mock.calls[0][2] as ControlPlaneRole;
  }

  async function memberTls() {
    const ca = await createCertificateAuthority({ commonName: 'Loadweaver cluster CA', validityDays: 3650 });
    const keys = await generateKeyPair();
    const issued = await issueCertificate({
      ca,
      csrPem: await createCsr(keys, 'postgres'),
      clusterId: 'lw-abc',
      kind: 'control-plane',
      name: 'postgres/n1',
      dnsNames: [POSTGRES_TLS_SERVER_NAME],
      ipAddresses: ['10.93.0.1'],
      validityHours: 24 * 365,
    });

    return {
      certificatePem: issued.certificatePem,
      privateKeyPem: keys.privateKeyPem,
      caCertificatePem: ca.certificatePem,
    };
  }

  const ctx = (address: string): MemberContext => ({
    nodeName: 'n1',
    address,
    stateDir: '/var/lib/loadweaver',
    images: controlPlaneImages({}),
  });

  it('starts Postgres with the spec of the first desired state (overlay address, CA certificate, WAL-G)', async () => {
    const bootstrap = await bootstrapRole();
    const environment = { ...(bootstrap.environment ?? {}) };

    // What the control plane pushes for its first node: the replicated environment (no bootstrap join token), the
    // overlay address, the log store, the platform backups with the push-time secrets, and a CA certificate.
    delete environment['LOADWEAVER_BOOTSTRAP_JOIN_TOKEN'];
    const firstApply: ControlPlaneRole = {
      role: 'member',
      members: [{ name: 'n1', address: '10.93.0.1', witness: false }],
      automaticFailover: false,
      scope: bootstrap.scope,
      environment,
      logStore: { clusterName: bootstrap.scope, heapMb: 512, httpPort: 9200, transportPort: 9300 },
      platformBackups: memberPlatformBackups(environment['ENCRYPTION_KEY'], 'n1'),
    };

    expect(bootstrap.platformBackups).toEqual(firstApply.platformBackups);
    expect(postgresSpec({ ...ctx('10.93.0.1'), postgresTls: await memberTls() }, firstApply).hash).toBe(
      postgresSpec(ctx('127.0.0.1'), bootstrap).hash,
    );
    expect(postgresSpec(ctx('127.0.0.1'), bootstrap).env).toMatchObject({ USE_WALG_BACKUP: 'true' });
  });

  it('keeps the Postgres spec through membership changes and certificate renewals', async () => {
    const key = randomBytes(32).toString('base64');
    const one: ControlPlaneRole = {
      role: 'member',
      members: [{ name: 'n1', address: '10.93.0.1', witness: false }],
      automaticFailover: false,
      scope: 'lw-abc',
      environment: { ENCRYPTION_KEY: key, DB_PASSWORD: 'p' },
      platformBackups: memberPlatformBackups(key, 'n1'),
    };
    const three: ControlPlaneRole = {
      ...one,
      members: [
        { name: 'n1', address: '10.93.0.1', witness: false },
        { name: 'n2', address: '10.93.0.2', witness: false, draining: true },
        { name: 'n3', address: '10.93.0.3', witness: true },
      ],
      automaticFailover: true,
      logStore: { clusterName: 'lw-abc', heapMb: 1024, httpPort: 9200, transportPort: 9300 },
    };
    const base = postgresSpec({ ...ctx('10.93.0.1'), postgresTls: await memberTls() }, one).hash;

    expect(postgresSpec({ ...ctx('10.93.0.1'), postgresTls: await memberTls() }, three).hash).toBe(base);
  });

  it('derives the platform backups from the bootstrap environment (gateway port override included)', () => {
    const key = randomBytes(32).toString('base64');

    expect(bootstrapPlatformBackups({ ENCRYPTION_KEY: key }, 'n1')).toEqual(memberPlatformBackups(key, 'n1'));
    expect(
      bootstrapPlatformBackups({ ENCRYPTION_KEY: key, LOADWEAVER_BACKUP_GATEWAY_PORT: '7490' }, 'n1')?.gatewayPort,
    ).toBe(7490);
  });
});
