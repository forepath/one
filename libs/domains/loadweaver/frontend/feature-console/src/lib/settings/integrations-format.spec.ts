import type { ConsoleResource, GitConnection } from '@forepath/loadweaver/frontend/data-access-console';

import { filterIntegrationRows, integrationRows } from './integrations-format';

const res = (
  kind: string,
  name: string,
  spec: Record<string, unknown>,
  project: string | null = null,
): ConsoleResource =>
  ({ apiVersion: 'loadweaver.com/v1', kind, metadata: { name, project }, spec }) as unknown as ConsoleResource;

const cluster = (spec: Record<string, unknown>) => res('Cluster', 'default', spec);

describe('integrations hub rows (3.41)', () => {
  it('lists every provider kind with its edit / test / link and the area', () => {
    const rows = integrationRows({
      resources: [
        cluster({
          git: { github: { appId: 42, webUrl: 'https://github.com' } },
          observability: {
            siem: [{ name: 'splunk', type: 'webhook', url: 'https://siem.example' }],
            alertEmails: ['ops@x.io'],
          },
          ingress: { acme: { enabled: true, email: 'acme@x.io' } },
          registry: { mirrors: [{ host: 'docker.io', remoteUrl: 'https://registry-1.docker.io' }] },
          updates: { source: 'mirror', mirrorUrl: 'https://mirror.example', channel: 'stable' },
          backups: { platform: { targets: ['offsite'] } },
        }),
        res('DnsProvider', 'cf', { type: 'cloudflare', credentials: 'secret://ops/cf' }),
        res('DnsZone', 'example.com', { provider: 'cf', registrar: { type: 'inwx', credentials: 'secret://ops/r' } }),
        res('IpPool', 'public', { failover: 'provider', provider: { type: 'hetzner' }, cidrs: ['203.0.113.0/28'] }),
        res('IpPool', 'private', { failover: 'vrrp', cidrs: ['10.0.0.0/24'] }),
        res('BackupTarget', 'offsite', { type: 's3', endpoint: 'https://s3.example', bucket: 'lw' }),
        res('BgpPeer', 'upstream', { asn: 64500, address: '192.0.2.1' }),
      ],
      gitConnections: [
        {
          id: 'g1',
          project: 'shop',
          provider: 'github',
          repoUrl: 'https://github.com/a/b.git',
          lastError: 'auth failed',
        } as unknown as GitConnection,
      ],
      siem: [{ name: 'splunk', forwarded: 10, failures: 2, lastError: 'timeout', nextAttemptAt: null }],
      env: [],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get('git:g1')).toMatchObject({
      area: 'source',
      state: 'error',
      error: 'auth failed',
      link: '/delivery/git/g1',
    });
    expect(byId.get('cluster:github')).toMatchObject({
      state: 'configured',
      edit: { key: { kind: 'Cluster' }, step: 'services' },
    });
    expect(byId.get('cluster:gitlab')?.state).toBe('off');
    expect(byId.get('dns:cf')).toMatchObject({ type: 'cloudflare', test: { kind: 'DnsProvider', name: 'cf' } });
    expect(byId.get('registrar:example.com')).toMatchObject({ type: 'inwx', edit: { step: 'secondaries' } });
    // Only provider-failover pools are integrations.
    expect(byId.get('ip:public')).toMatchObject({
      type: 'hetzner',
      test: { kind: 'IpPool' },
      edit: { step: 'failover' },
    });
    expect(byId.has('ip:private')).toBe(false);
    expect(byId.get('backup:offsite')).toMatchObject({ type: 's3', test: { kind: 'BackupTarget' } });
    expect(byId.get('siem:splunk')).toMatchObject({ state: 'error', error: 'timeout', test: { kind: 'SiemTarget' } });
    expect(byId.get('siem:splunk')?.details).toContain('10');
    expect(byId.get('cluster:updates')).toMatchObject({ type: 'mirror', link: '/delivery/updates' });
    expect(byId.get('bgp:upstream')?.details).toContain('AS64500');
    // Credentials are references and never become details.
    expect(JSON.stringify(rows)).not.toContain('secret://');
  });

  it('offers set-up rows for empty areas and keeps env rows read-only', () => {
    const rows = integrationRows({
      resources: [cluster({})],
      gitConnections: [],
      siem: [],
      env: [{ id: 'smtp', label: 'Email (SMTP)', active: true, details: { host: 'mail.example:587' } }],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get('dns:none')).toMatchObject({ state: 'off', create: 'DnsProvider' });
    expect(byId.get('backup:none')).toMatchObject({ create: 'BackupTarget' });
    expect(byId.get('siem:none')).toMatchObject({ state: 'off', edit: { step: 'operations' } });
    expect(byId.get('env:smtp')).toMatchObject({
      area: 'environment',
      state: 'env',
      details: 'host: mail.example:587',
    });
    expect(byId.get('env:smtp')?.edit).toBeUndefined();
    expect(byId.get('env:smtp')?.test).toBeUndefined();
  });

  it('filters over name, type, details and area', () => {
    const rows = integrationRows({
      resources: [cluster({}), res('DnsProvider', 'cf', { type: 'cloudflare' })],
      gitConnections: [],
      siem: [],
      env: [],
    });

    expect(filterIntegrationRows(rows, 'cloudflare', (a) => a).map((r) => r.id)).toEqual(['dns:cf']);
    expect(filterIntegrationRows(rows, 'dns', (a) => a).length).toBeGreaterThan(0);
  });
});
