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

  it('lists the app store catalog sources and allowed trust labels, edited on the Cluster step (P1)', () => {
    const rows = integrationRows({
      resources: [
        cluster({
          appStore: {
            catalogs: [
              { name: 'official', type: 'oci', url: 'oci://registry.forepath.io/apps', official: true, enabled: true },
              { name: 'acme', type: 'git', url: 'https://git.acme/apps.git', ref: 'main', enabled: false },
            ],
            allowedTrust: ['official'],
          },
        }),
      ],
      gitConnections: [],
      siem: [],
      env: [],
      appCatalogs: [{ name: 'official', error: 'index signature invalid' }],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get('appstore:official')).toMatchObject({
      area: 'apps',
      type: 'oci',
      state: 'error',
      error: 'index signature invalid',
      edit: { key: { kind: 'Cluster' }, step: 'appStore' },
      link: '/delivery/apps',
      refreshCatalogs: true,
    });
    expect(byId.get('appstore:acme')).toMatchObject({ state: 'off', refreshCatalogs: false });
    expect(byId.get('appstore:acme')?.details).toContain('https://git.acme/apps.git @ main');
    expect(byId.get('appstore:acme')?.detailsTitle).toBeUndefined();
    expect(byId.get('appstore:trust')).toMatchObject({ details: 'official', edit: { step: 'appStore' } });

    const empty = integrationRows({ resources: [cluster({})], gitConnections: [], siem: [], env: [] });

    expect(empty.find((r) => r.id === 'appstore:none')).toMatchObject({ state: 'off', edit: { step: 'appStore' } });
    expect(empty.find((r) => r.id === 'appstore:trust')?.details).toBe('official, verified');
  });

  it('shows the commit a Git catalog resolved to: short in the details, full on hover', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const rows = integrationRows({
      resources: [
        cluster({
          appStore: {
            catalogs: [{ name: 'acme', type: 'git', url: 'https://git.acme/apps.git', ref: 'v2', enabled: true }],
          },
        }),
      ],
      gitConnections: [],
      siem: [],
      env: [],
      appCatalogs: [{ name: 'acme', error: null, resolvedCommit: sha }],
    });
    const row = rows.find((r) => r.id === 'appstore:acme');

    expect(row?.details).toContain('https://git.acme/apps.git @ v2 · commit 0123456 · ');
    expect(row?.details).not.toContain(sha);
    expect(row?.detailsTitle).toContain(`commit ${sha}`);
  });

  it('shows the catalog of a trusted fleet as managed by the fleet, without edit (2026-11-01)', () => {
    const managed = {
      name: 'acme-fleet',
      type: 'fleet' as const,
      url: 'https://fleet.acme.example/',
      enabled: true,
      fleetManaged: true,
      fleet: { issuer: 'fleet-1', name: 'Acme fleet' },
    };
    const sources = (appStore: Record<string, unknown>, appCatalogs: Record<string, unknown>[]) =>
      integrationRows({
        resources: [cluster({ appStore })],
        gitConnections: [],
        siem: [],
        env: [],
        appCatalogs: appCatalogs as never,
      });

    // Not stored: the cluster adds it; no "none yet" row then.
    let rows = sources({}, [managed]);
    let row = rows.find((r) => r.id === 'appstore:acme-fleet');

    expect(row).toMatchObject({ type: 'fleet', state: 'configured', link: '/delivery/apps', refreshCatalogs: true });
    expect(row?.edit).toBeUndefined();
    expect(row?.details).toBe('Managed by fleet Acme fleet · https://fleet.acme.example/ · enabled');
    expect(rows.some((r) => r.id === 'appstore:none')).toBe(false);

    // Stored for the same URL (switched off there): the cluster keeps it on, the row has no edit either.
    rows = sources(
      { catalogs: [{ name: 'acme-fleet', type: 'fleet', url: 'https://fleet.acme.example', enabled: false }] },
      [{ ...managed, error: 'unreachable' }],
    );
    row = rows.find((r) => r.id === 'appstore:acme-fleet');
    expect(rows.filter((r) => r.id === 'appstore:acme-fleet')).toHaveLength(1);
    expect(row).toMatchObject({ state: 'error', error: 'unreachable', refreshCatalogs: true });
    expect(row?.edit).toBeUndefined();
    expect(row?.details).toContain('Managed by fleet Acme fleet');

    // The fleet is no longer trusted: an ordinary stored entry again.
    row = sources({ catalogs: [{ name: 'acme-fleet', type: 'fleet', url: 'https://fleet.acme.example' }] }, []).find(
      (r) => r.id === 'appstore:acme-fleet',
    );
    expect(row).toMatchObject({ state: 'off', edit: { step: 'appStore' } });
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
