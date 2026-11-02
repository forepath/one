import { UserRole } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { S3CopyDestination, SftpCopyDestination } from '../backups/platform/platform-copy.destinations';
import { ClusterAccessService } from '../services/cluster-access.service';
import { integrationEnvStatus } from './integrations-env';
import { IntegrationsService, sanitizeTestError, type IntegrationTestKind } from './integrations.service';

const SECRET_TOKEN = 'cf-SECRET-token-1234567890';

type Role = 'cluster-admin' | 'infra-operator' | 'auditor' | null;

function setup(options: { role?: Role } = {}) {
  const members = { findByUserId: jest.fn().mockResolvedValue(options.role ? { role: options.role } : null) };
  const access = new ClusterAccessService(members as never);
  const audit = { recordStandalone: jest.fn().mockResolvedValue({}) };
  const resources: Record<string, { metadata: { name: string }; spec: unknown }[]> = {
    DnsProvider: [
      { metadata: { name: 'cf' }, spec: { type: 'cloudflare', credentials: 'secret://infra/cf' } },
      { metadata: { name: 'ns' }, spec: { type: 'bind9' } },
      { metadata: { name: 'ns-edge' }, spec: { type: 'bind9', nodeGroup: 'edge' } },
      { metadata: { name: 'ns-gone' }, spec: { type: 'bind9', nodeGroup: 'missing' } },
      {
        metadata: { name: 'ext' },
        spec: { type: 'axfr', servers: ['192.0.2.1', '192.0.2.2'], credentials: 'secret://infra/tsig' },
      },
    ],
    DnsZone: [
      { metadata: { name: 'example' }, spec: { zone: 'example.com', provider: 'cf', secondaries: ['ext'] } },
      { metadata: { name: 'other' }, spec: { zone: 'other.org', provider: 'cf', secondaries: [] } },
    ],
    NodeGroup: [{ metadata: { name: 'edge' }, spec: { selector: { matchLabels: { role: 'edge' } } } }],
    BackupTarget: [
      {
        metadata: { name: 'offsite' },
        spec: {
          type: 's3',
          endpoint: 'https://s3.example.com',
          bucket: 'backups',
          region: 'eu-central-1',
          prefix: '',
          credentials: 'secret://infra/s3',
          objectLock: { mode: 'COMPLIANCE', days: 30 },
        },
      },
      {
        metadata: { name: 'nas' },
        spec: {
          type: 'sftp',
          host: 'nas.example.com',
          port: 22,
          user: 'backup',
          path: '/srv/backups',
          keySecret: 'secret://infra/nas-key',
          knownHosts: 'nas.example.com ssh-ed25519 AAAA',
        },
      },
    ],
    IpPool: [
      {
        metadata: { name: 'public' },
        spec: {
          cidrs: ['203.0.113.10/32'],
          nodeGroup: 'edge',
          failover: 'provider',
          provider: { type: 'hetzner', credentials: 'secret://infra/hcloud' },
        },
      },
      { metadata: { name: 'vrrp' }, spec: { cidrs: ['198.51.100.0/29'], nodeGroup: 'edge', failover: 'vrrp' } },
    ],
  };
  const store = {
    get: jest.fn(async (kind: string, name: string) => resources[kind]?.find((r) => r.metadata.name === name) ?? null),
    list: jest.fn(async (kind: string) => resources[kind] ?? []),
    clusterSpec: jest.fn(async () => ({
      observability: {
        siem: [
          {
            name: 'splunk',
            type: 'webhook',
            url: 'https://siem.example.com/hook',
            sources: ['audit'],
            credentials: 'secret://infra/siem',
          },
          { name: 'syslog', type: 'syslog', url: 'udp://192.0.2.9:514', sources: ['audit'] },
        ],
      },
    })),
  };
  const credentials = {
    providerConfig: jest.fn(async (ref: string) =>
      ref === 'secret://infra/s3'
        ? { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI-secret' }
        : { apiToken: SECRET_TOKEN },
    ),
    read: jest.fn(async () => Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nkeymaterial\n')),
  };
  const dnsProvider = {
    listZones: jest.fn().mockResolvedValue([
      { id: 'z1', name: 'example.com' },
      { id: 'z2', name: 'other.org' },
    ]),
  };
  const dnsProviders = { create: jest.fn(() => dnsProvider) };
  const failoverProvider = { holder: jest.fn().mockResolvedValue('4711') };
  const failoverIps = { create: jest.fn(() => failoverProvider) };
  const siem = { sendTest: jest.fn().mockResolvedValue(undefined) };
  const sessions = { get: jest.fn((name: string) => (name === 'cp1' ? {} : undefined)) };
  const nodes = [
    { name: 'cp1', site: 'a', labels: {}, lifecycle: 'active', controlPlane: true, endpointHost: '192.0.2.10' },
    { name: 'cp2', site: 'b', labels: {}, lifecycle: 'active', controlPlane: true, endpointHost: '192.0.2.11' },
    {
      name: 'edge1',
      site: 'a',
      labels: { role: 'edge' },
      lifecycle: 'active',
      controlPlane: false,
      endpointHost: null,
    },
  ];
  const addresses = [{ address: '203.0.113.10', pool: 'public', state: 'assigned' }];
  const dataSource = {
    getRepository: jest.fn((entity: { name: string }) => ({
      find: jest.fn(async () => (entity.name === 'NodeEntity' ? nodes : addresses)),
    })),
  };
  const service = new IntegrationsService(
    dataSource as never,
    access,
    audit as never,
    store as never,
    credentials as never,
    dnsProviders as never,
    failoverIps as never,
    siem as never,
    sessions as never,
  );

  service.soaQuery = jest.fn().mockResolvedValue(2026102901);

  return { service, members, audit, credentials, dnsProvider, dnsProviders, failoverProvider, siem, sessions };
}

const interactive = (role: UserRole = UserRole.USER) => ({ user: { id: 'u1', roles: [role], amr: ['pwd'] } }) as never;
const pat = (scopes: string[], role: UserRole = UserRole.USER) =>
  ({ user: { id: 'u1', roles: [role], amr: ['pat'], scopes } }) as never;
const admin = interactive(UserRole.ADMIN);

describe('IntegrationsService', () => {
  describe('status (GET /integrations)', () => {
    it('is for cluster admins only', async () => {
      await expect(setup().service.status(admin)).resolves.toHaveLength(8);
      await expect(setup({ role: 'cluster-admin' }).service.status(pat(['cluster:read']))).resolves.toHaveLength(8);

      for (const role of ['infra-operator', 'auditor', null] as Role[])
        await expect(setup({ role }).service.status(interactive())).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never contains secrets, even with secret-looking env values set', async () => {
      const { service } = setup();

      service.env = {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'mailer-user-name',
        SMTP_PASSWORD: 'smtp-PASSWORD-xyz',
        EMAIL_FROM: 'ops@example.com',
        OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel-user:otel-PASS-123@collector.example.com/v1?token=otel-TOKEN-q',
        OTEL_USERNAME: 'otel-user',
        OTEL_PASSWORD: 'otel-PASS-123',
        LOADWEAVER_MASTER_KEY_KMS: 'vault-transit',
        VAULT_ADDR: 'https://vault.example.com:8200',
        VAULT_TOKEN: 'hvs.VAULT-TOKEN-abc',
        VAULT_NAMESPACE: 'ops',
        AUTHENTICATION_METHOD: 'keycloak',
        KEYCLOAK_SERVER_URL: 'https://id.example.com',
        KEYCLOAK_REALM: 'loadweaver',
        KEYCLOAK_CLIENT_ID: 'console',
        KEYCLOAK_CLIENT_SECRET: 'kc-CLIENT-SECRET',
        STATIC_API_KEY: 'static-API-KEY-1',
        JWT_SECRET: 'jwt-SECRET-1',
        DYNAMIC_DNS_PROVIDERS: '@acme/dns-hetzner,file:plugins/route53',
        DYNAMIC_KMS_PROVIDERS: 'https://deploy:npm-TOKEN-9@registry.example.com/kms.tgz',
      };

      const serialized = JSON.stringify(await service.status(admin));

      for (const secret of [
        'smtp-PASSWORD-xyz',
        'mailer-user-name',
        'otel-PASS-123',
        'otel-user',
        'otel-TOKEN-q',
        'hvs.VAULT-TOKEN-abc',
        'kc-CLIENT-SECRET',
        'static-API-KEY-1',
        'jwt-SECRET-1',
        'npm-TOKEN-9',
      ])
        expect(serialized).not.toContain(secret);

      expect(serialized).toContain('smtp.example.com:587');
      expect(serialized).toContain('@acme/dns-hetzner, file:plugins/route53');
    });
  });

  describe('integrationEnvStatus', () => {
    it('reports defaults when nothing is configured', () => {
      const status = Object.fromEntries(integrationEnvStatus({}, () => false).map((s) => [s.id, s]));

      expect(status['smtp']).toMatchObject({
        active: false,
        details: { from: 'noreply@localhost', authentication: 'off' },
      });
      expect(status['otlp']).toMatchObject({ active: false, details: { enabled: 'false' } });
      expect(status['geoip']).toMatchObject({ active: false, details: { source: 'bundled' } });
      expect(status['releases']).toMatchObject({
        active: true,
        details: { repository: 'forepath/one', updateCheck: 'on', cron: '17 */6 * * *', rollout: 'on' },
      });
      expect(status['postureSync']).toMatchObject({ details: { cron: '*/2 * * * *', source: 'default' } });
      expect(status['kms']).toMatchObject({ active: false, details: { provider: 'shamir' } });
      expect(status['auth']).toMatchObject({ details: { method: 'keycloak' } });
      expect(status['plugins']).toMatchObject({ active: false, details: {} });
    });

    it('reports the configured values', () => {
      const status = Object.fromEntries(
        integrationEnvStatus(
          {
            LOADWEAVER_GEOIP_DB: '/data/geo.mmdb',
            LOADWEAVER_UPDATE_CHECK: 'off',
            LOADWEAVER_UPDATE_POLICY: 'off',
            LOADWEAVER_RELEASES_REPOSITORY: 'acme/loadweaver',
            LOADWEAVER_POSTURE_SYNC_CRON: '*/5 * * * *',
            LOADWEAVER_MASTER_KEY_KMS: 'vault-transit',
            LOADWEAVER_VAULT_TRANSIT_MOUNT: 'kms',
            LOADWEAVER_VAULT_TRANSIT_KEY: 'cluster',
            AUTHENTICATION_METHOD: 'users',
            DYNAMIC_POSTURE_PLUGINS: 'Jamf=@acme/jamf',
          },
          (path) => path === '/data/geo.mmdb',
        ).map((s) => [s.id, s]),
      );

      expect(status['geoip']).toEqual(
        expect.objectContaining({ active: true, details: { source: 'custom', path: '/data/geo.mmdb' } }),
      );
      expect(status['releases'].details).toEqual({ repository: 'acme/loadweaver', updateCheck: 'off', rollout: 'off' });
      expect(status['postureSync'].details).toEqual({ cron: '*/5 * * * *', source: 'env' });
      expect(status['kms'].details).toEqual({ provider: 'vault-transit', mount: 'kms', key: 'cluster' });
      expect(status['auth'].details).toEqual({ method: 'users' });
      expect(status['plugins']).toMatchObject({ active: true, details: { posturePlugins: '@acme/jamf' } });
    });
  });

  describe('test (POST /integrations/test)', () => {
    const cases: [IntegrationTestKind, string][] = [
      ['DnsProvider', 'cf'],
      ['BackupTarget', 'nas'],
      ['IpPool', 'public'],
      ['SiemTarget', 'splunk'],
    ];

    beforeEach(() => {
      jest.spyOn(SftpCopyDestination.prototype, 'probe').mockResolvedValue({ exists: true, directory: true });
      jest.spyOn(SftpCopyDestination.prototype, 'close').mockResolvedValue(undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    it('applies the write rule of the tested resource', async () => {
      const allowed: Record<string, IntegrationTestKind[]> = {
        'cluster-admin': ['DnsProvider', 'BackupTarget', 'IpPool', 'SiemTarget'],
        'infra-operator': ['DnsProvider', 'BackupTarget', 'IpPool'],
        auditor: [],
        none: [],
      };

      for (const role of ['cluster-admin', 'infra-operator', 'auditor', null] as Role[])
        for (const [kind, name] of cases) {
          const { service } = setup({ role });
          const call = service.test(interactive(), { kind, name });

          if (allowed[role ?? 'none'].includes(kind)) await expect(call).resolves.toMatchObject({ ok: true });
          else await expect(call).rejects.toBeInstanceOf(ForbiddenException);
        }
    });

    it('treats project admins and viewers (no cluster role) like everyone else: forbidden', async () => {
      const { service, audit } = setup({ role: null });

      for (const [kind, name] of cases)
        await expect(service.test(interactive(), { kind, name })).rejects.toBeInstanceOf(ForbiddenException);

      expect(audit.recordStandalone).not.toHaveBeenCalled();
    });

    it('requires the PAT scope of the kind: cluster:nodes for infra kinds, cluster:admin for SIEM targets', async () => {
      const { service } = setup({ role: 'cluster-admin' });

      await expect(
        service.test(pat(['cluster:read', 'cluster:nodes']), { kind: 'DnsProvider', name: 'cf' }),
      ).resolves.toMatchObject({ ok: true });
      await expect(service.test(pat(['cluster:read']), { kind: 'DnsProvider', name: 'cf' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.test(pat(['cluster:read', 'cluster:nodes']), { kind: 'SiemTarget', name: 'splunk' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.test(pat(['cluster:read', 'cluster:admin']), { kind: 'SiemTarget', name: 'splunk' }),
      ).resolves.toMatchObject({ ok: true });
    });

    it('denies before revealing whether the resource exists', async () => {
      await expect(
        setup({ role: 'auditor' }).service.test(interactive(), { kind: 'DnsProvider', name: 'nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        setup({ role: 'cluster-admin' }).service.test(pat(['cluster:read']), { kind: 'BackupTarget', name: 'nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(setup().service.test(admin, { kind: 'DnsProvider', name: 'nope' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(setup().service.test(admin, { kind: 'SiemTarget', name: 'nope' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects an IpPool without a failover-IP provider as bad input', async () => {
      await expect(setup().service.test(admin, { kind: 'IpPool', name: 'vrrp' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('audits every test with kind, name and the result, without secrets', async () => {
      const { service, audit, dnsProvider } = setup();

      dnsProvider.listZones.mockRejectedValue(new Error(`invalid token ${SECRET_TOKEN}`));

      const result = await service.test(admin, { kind: 'DnsProvider', name: 'cf' });

      expect(result.ok).toBe(false);
      expect(audit.recordStandalone).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'integration.test',
          target: 'DnsProvider/cf',
          details: expect.objectContaining({ kind: 'DnsProvider', name: 'cf', ok: false }),
        }),
      );
      expect(JSON.stringify(audit.recordStandalone.mock.calls)).not.toContain(SECRET_TOKEN);
    });

    describe('DnsProvider', () => {
      it('lists the zones and checks the zones using the provider exist there', async () => {
        const { service, dnsProviders } = setup();
        const result = await service.test(admin, { kind: 'DnsProvider', name: 'cf' });

        expect(dnsProviders.create).toHaveBeenCalledWith('cloudflare', { apiToken: SECRET_TOKEN });
        expect(result).toMatchObject({
          ok: true,
          message: 'authenticated; 2 zones visible',
          details: { provider: 'cloudflare', zonesAtProvider: '2', zonesUsingIt: '2' },
        });
        expect(result.durationMs).toEqual(expect.any(Number));
        expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
      });

      it('fails when a zone is missing at the provider', async () => {
        const { service, dnsProvider } = setup();

        dnsProvider.listZones.mockResolvedValue([{ id: 'z1', name: 'example.com' }]);

        await expect(service.test(admin, { kind: 'DnsProvider', name: 'cf' })).resolves.toMatchObject({
          ok: false,
          details: { missingZones: 'other.org' },
        });
      });

      it('answers 200 ok:false with a sanitized message and the HTTP status when the provider rejects', async () => {
        const { service, dnsProvider } = setup();
        const error = Object.assign(
          new Error(`Request failed with status code 403 Authorization: Bearer ${SECRET_TOKEN}`),
          {
            response: { status: 403, data: { errors: [{ message: `token ${SECRET_TOKEN} invalid` }] } },
          },
        );

        dnsProvider.listZones.mockRejectedValue(error);

        const result = await service.test(admin, { kind: 'DnsProvider', name: 'cf' });

        expect(result).toMatchObject({ ok: false, details: { httpStatus: '403' } });
        expect(result.message).toContain('status code 403');
        expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
        expect(JSON.stringify(result)).not.toContain('invalid"');
      });

      it('bind9: the node group exists and its nodes are connected', async () => {
        const { service } = setup();

        await expect(service.test(admin, { kind: 'DnsProvider', name: 'ns' })).resolves.toMatchObject({
          ok: true,
          message: '1 of 2 name-server nodes connected',
          details: { nodeGroup: 'control plane', nodes: '2', connected: '1' },
        });
        await expect(service.test(admin, { kind: 'DnsProvider', name: 'ns-edge' })).resolves.toMatchObject({
          ok: false,
          message: 'no name-server node is connected',
        });
        await expect(service.test(admin, { kind: 'DnsProvider', name: 'ns-gone' })).resolves.toMatchObject({
          ok: false,
          message: 'node group missing does not exist',
        });
      });

      it('axfr: every server answers the SOA of a zone using it', async () => {
        const { service } = setup();

        await expect(service.test(admin, { kind: 'DnsProvider', name: 'ext' })).resolves.toMatchObject({
          ok: true,
          details: { zone: 'example.com', servers: '192.0.2.1, 192.0.2.2' },
        });

        (service.soaQuery as jest.Mock).mockImplementation(async (server: string) =>
          server === '192.0.2.1' ? 1 : null,
        );

        await expect(service.test(admin, { kind: 'DnsProvider', name: 'ext' })).resolves.toMatchObject({
          ok: false,
          details: { noAnswer: '192.0.2.2' },
        });
      });
    });

    describe('BackupTarget', () => {
      it('S3: head-bucket and the declared object lock', async () => {
        const send = jest.spyOn(S3CopyDestination.prototype, 'objectLockDays').mockResolvedValue(30);
        const { service } = setup();
        const head = jest.fn().mockResolvedValue({});

        jest.spyOn(service, 'backupDestination').mockImplementation(async (spec, secrets) => {
          secrets.push('wJalrXUtnFEMI-secret');
          const destination = new S3CopyDestination(spec as never, { accessKeyId: 'a', secretAccessKey: 'b' });

          (destination as unknown as { client: { send: jest.Mock; destroy: jest.Mock } }).client.send = head;

          return destination;
        });

        await expect(service.test(admin, { kind: 'BackupTarget', name: 'offsite' })).resolves.toMatchObject({
          ok: true,
          details: { type: 's3', endpoint: 's3.example.com', bucket: 'backups', objectLock: 'COMPLIANCE, 30 days' },
        });
        expect(head.mock.calls[0][0].input).toEqual({ Bucket: 'backups' });
        expect(send).toHaveBeenCalled();
      });

      it('S3: a bucket without the declared object lock fails, credentials redacted', async () => {
        jest
          .spyOn(S3CopyDestination.prototype, 'objectLockDays')
          .mockRejectedValue(new Error('bucket backups has no object lock'));
        const { service } = setup();

        jest.spyOn(service, 'backupDestination').mockImplementation(async (spec, secrets) => {
          secrets.push('wJalrXUtnFEMI-secret');
          const destination = new S3CopyDestination(spec as never, { accessKeyId: 'a', secretAccessKey: 'b' });

          (destination as unknown as { client: { send: jest.Mock } }).client.send = jest.fn().mockResolvedValue({});

          return destination;
        });

        await expect(service.test(admin, { kind: 'BackupTarget', name: 'offsite' })).resolves.toMatchObject({
          ok: false,
          message: 'bucket backups has no object lock',
        });
      });

      it('S3: access denied answers the status, never the secret key', async () => {
        const { service } = setup();
        const denied = Object.assign(new Error('UnknownError'), {
          name: 'Forbidden',
          $metadata: { httpStatusCode: 403 },
        });

        jest.spyOn(service, 'backupDestination').mockImplementation(async (spec, secrets) => {
          secrets.push('wJalrXUtnFEMI-secret');
          const destination = new S3CopyDestination(spec as never, { accessKeyId: 'a', secretAccessKey: 'b' });

          (destination as unknown as { client: { send: jest.Mock } }).client.send = jest.fn().mockRejectedValue(denied);

          return destination;
        });

        await expect(service.test(admin, { kind: 'BackupTarget', name: 'offsite' })).resolves.toEqual({
          ok: false,
          message: 'Forbidden',
          details: { httpStatus: '403' },
          durationMs: expect.any(Number),
        });
      });

      it('SFTP: connects with the key from the secret and stats the path', async () => {
        const { service, credentials } = setup();

        await expect(service.test(admin, { kind: 'BackupTarget', name: 'nas' })).resolves.toMatchObject({
          ok: true,
          message: 'connected; /srv/backups exists',
          details: { type: 'sftp', host: 'nas.example.com:22', path: '/srv/backups' },
        });
        expect(credentials.read).toHaveBeenCalledWith('secret://infra/nas-key');
      });

      it('SFTP: a missing path or a failed connection is ok:false, the key never echoed', async () => {
        const { service } = setup();

        (SftpCopyDestination.prototype.probe as jest.Mock).mockResolvedValueOnce({ exists: false, directory: false });
        await expect(service.test(admin, { kind: 'BackupTarget', name: 'nas' })).resolves.toMatchObject({ ok: false });

        (SftpCopyDestination.prototype.probe as jest.Mock).mockRejectedValueOnce(
          new Error('All configured authentication methods failed for keymaterial'),
        );

        const result = await service.test(admin, { kind: 'BackupTarget', name: 'nas' });

        expect(result.ok).toBe(false);
        expect(result.message).not.toContain('keymaterial');
      });
    });

    describe('IpPool', () => {
      it('reads the holders of the pool addresses at the provider', async () => {
        const { service, failoverProvider } = setup();

        await expect(service.test(admin, { kind: 'IpPool', name: 'public' })).resolves.toMatchObject({
          ok: true,
          details: { provider: 'hetzner', holders: '203.0.113.10: 4711' },
        });
        expect(failoverProvider.holder).toHaveBeenCalledWith('203.0.113.10');
      });

      it('fails when the provider does not know the address', async () => {
        const { service, failoverProvider } = setup();

        failoverProvider.holder.mockRejectedValue(
          new Error('floating IP 203.0.113.10 not found in this Hetzner project'),
        );

        await expect(service.test(admin, { kind: 'IpPool', name: 'public' })).resolves.toMatchObject({
          ok: false,
          message: 'floating IP 203.0.113.10 not found in this Hetzner project',
        });
      });
    });

    describe('SiemTarget', () => {
      it('sends one test event through the forwarder', async () => {
        const { service, siem } = setup();

        await expect(service.test(admin, { kind: 'SiemTarget', name: 'splunk' })).resolves.toMatchObject({
          ok: true,
          message: 'test event accepted by the target',
          details: { type: 'webhook', endpoint: 'siem.example.com' },
        });
        expect(siem.sendTest).toHaveBeenCalledWith(expect.objectContaining({ name: 'splunk' }));

        await expect(service.test(admin, { kind: 'SiemTarget', name: 'syslog' })).resolves.toMatchObject({
          ok: true,
          message: expect.stringContaining('UDP'),
        });
      });

      it('reports a rejected event without the credentials', async () => {
        const { service, siem } = setup();

        siem.sendTest.mockRejectedValue(new Error(`HTTP 401 for token=${SECRET_TOKEN}`));

        const result = await service.test(admin, { kind: 'SiemTarget', name: 'splunk' });

        expect(result).toMatchObject({ ok: false });
        expect(result.message).toContain('HTTP 401');
        expect(result.message).not.toContain(SECRET_TOKEN);
      });
    });

    it('gives up after the timeout and still audits', async () => {
      const { service, dnsProvider, audit } = setup();

      service.timeoutMs = 20;
      dnsProvider.listZones.mockReturnValue(new Promise(() => undefined));

      await expect(service.test(admin, { kind: 'DnsProvider', name: 'cf' })).resolves.toMatchObject({
        ok: false,
        message: 'no answer within 0 s',
      });
      expect(audit.recordStandalone).toHaveBeenCalledWith(
        expect.objectContaining({ details: expect.objectContaining({ ok: false }) }),
      );
    });
  });

  describe('sanitizeTestError', () => {
    it('redacts known secrets, URL user info, bearer values and token pairs', () => {
      expect(
        sanitizeTestError(
          new Error('failed https://user:pw@host/x Bearer abc.def api_key=XYZ password: hunter2 s3cr3t-value\nnext'),
          ['s3cr3t-value'],
        ),
      ).toBe('failed https://host/x Bearer *** api_key=*** password: *** *** next');
    });

    it('never uses non-errors and bounds the length', () => {
      expect(sanitizeTestError({ body: SECRET_TOKEN })).toBe('connection failed');
      expect(sanitizeTestError(new Error('x'.repeat(1000)))).toHaveLength(300);
      expect(sanitizeTestError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toBe(
        'fetch failed (ECONNREFUSED)',
      );
    });
  });
});
