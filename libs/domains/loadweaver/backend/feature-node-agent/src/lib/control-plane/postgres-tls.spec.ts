import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  POSTGRES_TLS_SERVER_NAME,
  type ControlPlaneRole,
  type PostgresTls,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
  type CertificateAuthority,
} from '@forepath/loadweaver/shared/util-pki';

import { controlPlaneApiSpec, controlPlaneImages, postgresSpec, type MemberContext } from './control-plane-containers';
import { postgresCloneSpec } from './platform-backups';
import {
  apiDatabaseTlsEnvironment,
  choosePostgresTls,
  ensurePostgresTls,
  postgresTlsProblem,
  spiloTlsEnvironment,
} from './postgres-tls';

const DAY = 86_400_000;
const T0 = new Date('2026-10-01T00:00:00Z');

async function issue(
  ca: CertificateAuthority,
  options: { address?: string; names?: string[]; now?: Date; days?: number } = {},
): Promise<PostgresTls> {
  const keys = await generateKeyPair();
  const issued = await issueCertificate({
    ca,
    csrPem: await createCsr(keys, 'postgres'),
    clusterId: 'lw-abc',
    kind: 'control-plane',
    name: 'postgres/n1',
    dnsNames: options.names ?? [POSTGRES_TLS_SERVER_NAME],
    ipAddresses: [options.address ?? '10.93.0.1'],
    validityHours: (options.days ?? 365) * 24,
    now: options.now ?? T0,
  });

  return {
    certificatePem: issued.certificatePem,
    privateKeyPem: keys.privateKeyPem,
    caCertificatePem: ca.certificatePem,
  };
}

describe('Postgres TLS on members (3.2)', () => {
  let ca: CertificateAuthority;
  let otherCa: CertificateAuthority;

  beforeAll(async () => {
    ca = await createCertificateAuthority({ commonName: 'Loadweaver cluster CA lw-abc', validityDays: 3650 });
    otherCa = await createCertificateAuthority({ commonName: 'Loadweaver cluster CA lw-xyz', validityDays: 3650 });
  });

  it('accepts only a certificate from its CA, with its key and the API name', async () => {
    const good = await issue(ca);
    const foreign = await issue(otherCa);

    expect(postgresTlsProblem(good, new Date(T0.getTime() + DAY))).toBeNull();
    expect(postgresTlsProblem({ ...good, caCertificatePem: otherCa.certificatePem }, T0)).toBe('not issued by the CA');
    expect(postgresTlsProblem({ ...good, privateKeyPem: foreign.privateKeyPem }, T0)).toBe('key does not match');
    expect(postgresTlsProblem(good, new Date(T0.getTime() + 400 * DAY))).toBe('not valid now');
    expect(postgresTlsProblem(await issue(ca, { names: ['api.example.com'] }), T0)).toBe(
      `no ${POSTGRES_TLS_SERVER_NAME}`,
    );
    expect(postgresTlsProblem({ ...good, certificatePem: 'garbage' }, T0)).toMatch(/^unreadable/);
  });

  it('keeps the installed certificate until another CA, address or renewal needs the offered one', async () => {
    const installed = await issue(ca);
    const offered = await issue(ca, { now: new Date(T0.getTime() + 10 * DAY) });
    const later = new Date(T0.getTime() + 20 * DAY);

    // Bootstrap: nothing offered yet, nothing installed.
    expect(choosePostgresTls(null, undefined, later)).toBeNull();
    expect(choosePostgresTls(null, offered, later)).toBe(offered);
    // Every push brings a fresh certificate; the installed one stays (no Spilo restart).
    expect(choosePostgresTls(installed, offered, later)).toBe(installed);
    expect(choosePostgresTls(installed, undefined, later)).toBe(installed);
    // An unusable offer never replaces anything.
    expect(choosePostgresTls(installed, { ...offered, privateKeyPem: installed.privateKeyPem }, later)).toBe(installed);
    // Another CA (a restored cluster), another address, a third of the lifetime left.
    const restored = await issue(otherCa, { now: later });

    expect(choosePostgresTls(installed, restored, later)).toBe(restored);

    const moved = await issue(ca, { address: '10.93.0.7', now: later });

    expect(choosePostgresTls(installed, moved, later)).toBe(moved);

    const renewal = new Date(T0.getTime() + 250 * DAY);
    const fresh = await issue(ca, { now: renewal });

    expect(choosePostgresTls(installed, fresh, renewal)).toBe(fresh);
    expect(choosePostgresTls(installed, fresh, new Date(T0.getTime() + 200 * DAY))).toBe(installed);
  });

  it('installs the chosen certificate 0600 in the state directory and keeps it across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-pg-tls-'));

    try {
      expect(await ensurePostgresTls(dir, undefined, T0)).toEqual({ tls: null, replaced: false });

      const first = await issue(ca);
      const installed = await ensurePostgresTls(dir, first, T0);

      expect(installed).toEqual({ tls: first, replaced: true });
      expect(await readFile(join(dir, 'postgres-tls', 'server.key'), 'utf8')).toBe(first.privateKeyPem);
      expect((await stat(join(dir, 'postgres-tls', 'server.key'))).mode & 0o777).toBe(0o600);

      const again = await ensurePostgresTls(dir, await issue(ca), new Date(T0.getTime() + DAY));

      expect(again.replaced).toBe(false);
      expect(again.tls?.certificatePem).toBe(first.certificatePem);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hands the certificate to Spilo and the CA / name to the API (require until the first one)', async () => {
    const tls = await issue(ca);
    const role: ControlPlaneRole = {
      role: 'member',
      members: [{ name: 'n1', address: '10.93.0.1', witness: false }],
      automaticFailover: false,
      scope: 'lw-abc',
      environment: { DB_PASSWORD: 'super' },
    };
    const ctx: MemberContext = {
      nodeName: 'n1',
      address: '10.93.0.1',
      stateDir: '/var/lib/loadweaver',
      images: controlPlaneImages({}),
    };

    expect(spiloTlsEnvironment(null)).toEqual({});
    expect(apiDatabaseTlsEnvironment(null)).toEqual({ DB_SSL_MODE: 'require' });
    expect(postgresSpec(ctx, role).env).not.toHaveProperty('SSL_CERTIFICATE');
    expect(controlPlaneApiSpec(ctx, role).env).toMatchObject({ DB_SSL_MODE: 'require' });

    const withTls = { ...ctx, postgresTls: tls };

    expect(postgresSpec(withTls, role).env).toMatchObject({
      SSL_CERTIFICATE: tls.certificatePem,
      SSL_PRIVATE_KEY: tls.privateKeyPem,
    });
    // Spilo's pg_hba keeps refusing TCP logins without TLS: no ALLOW_NOSSL.
    expect(postgresSpec(withTls, role).env).not.toHaveProperty('ALLOW_NOSSL');
    expect(postgresSpec(withTls, role).hash).not.toBe(postgresSpec(ctx, role).hash);
    expect(controlPlaneApiSpec(withTls, role).env).toMatchObject({
      DB_HOST: '127.0.0.1',
      DB_SSL_MODE: 'verify-full',
      DB_SSL_CA: ca.certificatePem,
      DB_SSL_SERVERNAME: POSTGRES_TLS_SERVER_NAME,
    });

    // A point-in-time clone serves the same certificate.
    const clone = postgresCloneSpec(
      withTls,
      {
        ...role,
        platformBackups: {
          gatewayPort: 7480,
          bucket: 'lw-platform',
          region: 'garage',
          postgres: { accessKeyId: 'LWPB0123456789ABCDEF01234567', secretAccessKey: 'a'.repeat(64) },
          postgresClone: {
            id: 'r1',
            scope: 'lw-abc-r1',
            sourceScope: 'lw-abc',
            targetTime: '',
            pgPort: 5442,
            apiPort: 8018,
          },
        },
      },
      '/var/lib/loadweaver/postgres-pitr',
      '10.93.0.1:2379',
    );

    expect(clone?.env).toMatchObject({ SSL_CERTIFICATE: tls.certificatePem });
  });
});
