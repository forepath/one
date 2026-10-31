import type {
  ConsoleResource,
  GitConnection,
  ResourceKey,
  SiemDeliveryStatus,
} from '@forepath/loadweaver/frontend/data-access-console';

/**
 * Setup (3.41, `/setup`): every external provider of the cluster as one grouped list — what is configured, where,
 * its state, and what the caller may do with it (edit in the existing modal / page, test the connection). Pure, so the
 * page stays a thin view and the rules are specced.
 */

export type IntegrationArea =
  | 'source'
  | 'dns'
  | 'addresses'
  | 'backups'
  | 'observability'
  | 'certificates'
  | 'registry'
  | 'updates'
  | 'routing'
  | 'security'
  | 'environment';

export const INTEGRATION_AREAS: readonly IntegrationArea[] = [
  'source',
  'dns',
  'addresses',
  'backups',
  'observability',
  'certificates',
  'registry',
  'updates',
  'routing',
  'security',
  'environment',
];

/** `configured` = in use; `error` = its last delivery / sync failed; `off` = not set up; `env` = set in the environment. */
export type IntegrationState = 'configured' | 'error' | 'off' | 'env';

/** What `POST /integrations/test` checks (3.41). */
export type IntegrationTestKind = 'DnsProvider' | 'BackupTarget' | 'IpPool' | 'SiemTarget';

export interface IntegrationRow {
  id: string;
  area: IntegrationArea;
  name: string;
  /** Provider / type label (`cloudflare`, `s3`, `GitHub App`, …). */
  type: string;
  details: string;
  state: IntegrationState;
  /** Why it is in `error` (last error), shown as the row's hint. */
  error?: string | null;
  /** Edit in the resource modal (on a step, e.g. the Cluster's "services"). */
  edit?: { key: ResourceKey; step?: string };
  /** Create the first one of a kind (empty areas). */
  create?: string;
  /** A dedicated page (Git connections, posture, webhooks, certificates, updates). */
  link?: string;
  test?: { kind: IntegrationTestKind; name: string };
}

/** `GET /integrations` (3.41): an env-configured integration, values without secrets. */
export interface IntegrationEnvStatusLike {
  id: string;
  label: string;
  active: boolean;
  details: Record<string, string>;
}

export interface IntegrationSources {
  resources: readonly ConsoleResource[];
  gitConnections: readonly GitConnection[];
  siem: readonly SiemDeliveryStatus[];
  env: readonly IntegrationEnvStatusLike[];
}

type Spec = Record<string, unknown>;

function obj(value: unknown): Spec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Spec) : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function key(resource: ConsoleResource): ResourceKey {
  return { kind: resource.kind, name: resource.metadata.name, project: resource.metadata.project ?? null };
}

const T = {
  githubApp: $localize`:@@lwConsoleIntegrations-githubApp:GitHub App (plan bot)`,
  gitlabApp: $localize`:@@lwConsoleIntegrations-gitlabApp:GitLab application (plan bot)`,
  clusterScope: $localize`:@@lwConsoleIntegrations-clusterScope:Cluster`,
  notConfigured: $localize`:@@lwConsoleIntegrations-notConfigured:Not configured`,
  noneYet: $localize`:@@lwConsoleIntegrations-noneYet:None yet`,
  dnsProviders: $localize`:@@lwConsoleIntegrations-dnsProviders:DNS providers`,
  registrar: $localize`:@@lwConsoleIntegrations-registrar:Registrar`,
  failoverProviders: $localize`:@@lwConsoleIntegrations-failoverProviders:Failover-IP providers`,
  backupTargets: $localize`:@@lwConsoleIntegrations-backupTargets:Backup targets`,
  platformTargets: $localize`:@@lwConsoleIntegrations-platformTargets:Control-plane backups`,
  siem: $localize`:@@lwConsoleIntegrations-siem:SIEM forwarding`,
  alertEmails: $localize`:@@lwConsoleIntegrations-alertEmails:Alert emails`,
  webhooks: $localize`:@@lwConsoleIntegrations-webhooks:Webhooks`,
  acme: $localize`:@@lwConsoleIntegrations-acme:ACME certificates`,
  customCerts: $localize`:@@lwConsoleIntegrations-customCerts:Custom certificates`,
  mirrors: $localize`:@@lwConsoleIntegrations-mirrors:Registry mirrors`,
  updateSource: $localize`:@@lwConsoleIntegrations-updateSource:Release source`,
  bgpPeers: $localize`:@@lwConsoleIntegrations-bgpPeers:BGP peers`,
  rpki: $localize`:@@lwConsoleIntegrations-rpki:RPKI validators`,
  posture: $localize`:@@lwConsoleIntegrations-posture:Device posture (MDM / EDR)`,
  gitConnections: $localize`:@@lwConsoleIntegrations-gitConnections:Git connections`,
  forwarded: $localize`:@@lwConsoleIntegrations-forwarded:forwarded`,
  failures: $localize`:@@lwConsoleIntegrations-failures:failures`,
  enabled: $localize`:@@lwConsoleIntegrations-enabled:enabled`,
  disabled: $localize`:@@lwConsoleIntegrations-disabled:disabled`,
};

/** Readable names of the env-configured integrations (`GET /integrations` ids); unknown ids keep the API's label. */
const ENV_LABELS: Record<string, string> = {
  smtp: $localize`:@@lwConsoleIntegrations-envSmtp:Email (SMTP)`,
  otlp: $localize`:@@lwConsoleIntegrations-envOtlp:OpenTelemetry export`,
  geoip: $localize`:@@lwConsoleIntegrations-envGeoip:GeoIP database`,
  releases: $localize`:@@lwConsoleIntegrations-envReleases:Release checks`,
  postureSync: $localize`:@@lwConsoleIntegrations-envPostureSync:Posture sync schedule`,
  kms: $localize`:@@lwConsoleIntegrations-envKms:Master-key KMS`,
  auth: $localize`:@@lwConsoleIntegrations-envAuth:Sign-in`,
  plugins: $localize`:@@lwConsoleIntegrations-envPlugins:Plugins`,
};

/** The Cluster resource's spec (the `Cluster` kind, one per cluster). */
function clusterOf(resources: readonly ConsoleResource[]): ConsoleResource | null {
  return resources.find((r) => r.kind === 'Cluster') ?? null;
}

/** All rows of the hub, in area order (the table groups by `area`). */
export function integrationRows(sources: IntegrationSources): IntegrationRow[] {
  const rows: IntegrationRow[] = [];
  const of = (kind: string) => sources.resources.filter((r) => r.kind === kind);
  const cluster = clusterOf(sources.resources);
  const spec = obj(cluster?.spec);
  const clusterEdit = (step: string) => (cluster ? { edit: { key: key(cluster), step } } : {});

  // ------------------------------------------------------------------ source control
  for (const c of sources.gitConnections)
    rows.push({
      id: `git:${c.id}`,
      area: 'source',
      name: c.project ?? T.clusterScope,
      type: c.provider,
      details: [c.repoUrl, (c as { branch?: string }).branch].filter(Boolean).join(' @ '),
      state: c.lastError ? 'error' : 'configured',
      error: c.lastError,
      link: `/delivery/git/${encodeURIComponent(c.id)}`,
    });

  if (sources.gitConnections.length === 0)
    rows.push({
      id: 'git:none',
      area: 'source',
      name: T.gitConnections,
      type: 'git',
      details: T.noneYet,
      state: 'off',
      link: '/delivery/git',
    });

  const git = obj(spec['git']);
  const github = obj(git['github']);
  const gitlab = obj(git['gitlab']);

  rows.push({
    id: 'cluster:github',
    area: 'source',
    name: T.githubApp,
    type: 'github',
    details: git['github']
      ? [`App ${str(github['appId'])}`, str(github['webUrl'])].filter(Boolean).join(' · ')
      : T.notConfigured,
    state: git['github'] ? 'configured' : 'off',
    ...clusterEdit('services'),
  });
  rows.push({
    id: 'cluster:gitlab',
    area: 'source',
    name: T.gitlabApp,
    type: 'gitlab',
    details: git['gitlab'] ? str(gitlab['url']) || 'https://gitlab.com' : T.notConfigured,
    state: git['gitlab'] ? 'configured' : 'off',
    ...clusterEdit('services'),
  });

  // ------------------------------------------------------------------ DNS
  const dnsProviders = of('DnsProvider');

  for (const p of dnsProviders) {
    const s = obj(p.spec);

    rows.push({
      id: `dns:${p.metadata.name}`,
      area: 'dns',
      name: p.metadata.name,
      type: str(s['type']),
      details: [str(s['nodeGroup']), arr(s['servers']).map(str).join(', ')].filter(Boolean).join(' · '),
      state: 'configured',
      edit: { key: key(p) },
      test: { kind: 'DnsProvider', name: p.metadata.name },
    });
  }

  if (dnsProviders.length === 0)
    rows.push({
      id: 'dns:none',
      area: 'dns',
      name: T.dnsProviders,
      type: '—',
      details: T.noneYet,
      state: 'off',
      create: 'DnsProvider',
    });

  for (const z of of('DnsZone')) {
    const registrar = obj(obj(z.spec)['registrar']);

    if (!obj(z.spec)['registrar']) continue;

    rows.push({
      id: `registrar:${z.metadata.name}`,
      area: 'dns',
      name: `${T.registrar}: ${z.metadata.name}`,
      type: str(registrar['type']),
      details: z.metadata.name,
      state: 'configured',
      edit: { key: key(z), step: 'secondaries' },
    });
  }

  // ------------------------------------------------------------------ addresses
  const failoverPools = of('IpPool').filter((p) => obj(p.spec)['failover'] === 'provider');

  for (const p of failoverPools) {
    const provider = obj(obj(p.spec)['provider']);

    rows.push({
      id: `ip:${p.metadata.name}`,
      area: 'addresses',
      name: p.metadata.name,
      type: str(provider['type']),
      details: arr(obj(p.spec)['cidrs']).map(str).join(', '),
      state: 'configured',
      edit: { key: key(p), step: 'failover' },
      test: { kind: 'IpPool', name: p.metadata.name },
    });
  }

  if (failoverPools.length === 0)
    rows.push({
      id: 'ip:none',
      area: 'addresses',
      name: T.failoverProviders,
      type: '—',
      details: T.noneYet,
      state: 'off',
      create: 'IpPool',
    });

  // ------------------------------------------------------------------ backups
  const targets = of('BackupTarget');

  for (const t of targets) {
    const s = obj(t.spec);
    const where =
      s['type'] === 's3'
        ? [str(s['endpoint']), str(s['bucket'])].filter(Boolean).join(' / ')
        : [str(s['host']), str(s['path'])].filter(Boolean).join(':');

    rows.push({
      id: `backup:${t.metadata.name}`,
      area: 'backups',
      name: t.metadata.name,
      type: str(s['type']),
      details: where,
      state: 'configured',
      edit: { key: key(t) },
      test: { kind: 'BackupTarget', name: t.metadata.name },
    });
  }

  if (targets.length === 0)
    rows.push({
      id: 'backup:none',
      area: 'backups',
      name: T.backupTargets,
      type: '—',
      details: T.noneYet,
      state: 'off',
      create: 'BackupTarget',
    });

  const platformTargets = arr(obj(obj(spec['backups'])['platform'])['targets'])
    .map(str)
    .filter(Boolean);

  rows.push({
    id: 'cluster:platform-backups',
    area: 'backups',
    name: T.platformTargets,
    type: 'cluster',
    details: platformTargets.length ? platformTargets.join(', ') : T.notConfigured,
    state: platformTargets.length ? 'configured' : 'off',
    ...clusterEdit('operations'),
  });

  // ------------------------------------------------------------------ observability
  const observability = obj(spec['observability']);
  const siemTargets = arr(observability['siem']).map(obj);

  for (const target of siemTargets) {
    const name = str(target['name']);
    const status = sources.siem.find((s) => s.name === name);
    const failing = !!status?.lastError;

    rows.push({
      id: `siem:${name}`,
      area: 'observability',
      name,
      type: str(target['type']),
      details: [
        str(target['url']),
        status ? `${status.forwarded} ${T.forwarded}` : '',
        status?.failures ? `${status.failures} ${T.failures}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      state: failing ? 'error' : 'configured',
      error: status?.lastError ?? null,
      ...clusterEdit('operations'),
      test: { kind: 'SiemTarget', name },
    });
  }

  if (siemTargets.length === 0)
    rows.push({
      id: 'siem:none',
      area: 'observability',
      name: T.siem,
      type: '—',
      details: T.notConfigured,
      state: 'off',
      ...clusterEdit('operations'),
    });

  const alertEmails = arr(observability['alertEmails']).map(str).filter(Boolean);

  rows.push({
    id: 'cluster:alert-emails',
    area: 'observability',
    name: T.alertEmails,
    type: 'email',
    details: alertEmails.length ? alertEmails.join(', ') : T.notConfigured,
    state: alertEmails.length ? 'configured' : 'off',
    ...clusterEdit('operations'),
  });
  rows.push({
    id: 'webhooks',
    area: 'observability',
    name: T.webhooks,
    type: 'http',
    details: '',
    state: 'configured',
    link: '/webhooks',
  });

  // ------------------------------------------------------------------ certificates
  const acme = obj(obj(spec['ingress'])['acme']);
  const acmeOn = acme['enabled'] !== false && !!obj(spec['ingress'])['acme'];

  rows.push({
    id: 'cluster:acme',
    area: 'certificates',
    name: T.acme,
    type: 'acme',
    details: acmeOn ? [str(acme['email']), str(acme['directory'])].filter(Boolean).join(' · ') : T.disabled,
    state: acmeOn ? 'configured' : 'off',
    ...clusterEdit('services'),
  });
  rows.push({
    id: 'certificates',
    area: 'certificates',
    name: T.customCerts,
    type: 'x509',
    details: '',
    state: 'configured',
    link: '/delivery/certificates',
  });

  // ------------------------------------------------------------------ registry
  const mirrors = arr(obj(spec['registry'])['mirrors']).map(obj);

  rows.push({
    id: 'cluster:mirrors',
    area: 'registry',
    name: T.mirrors,
    type: 'oci',
    details:
      mirrors
        .map((m) => str(m['host']))
        .filter(Boolean)
        .join(', ') || T.notConfigured,
    state: mirrors.length ? 'configured' : 'off',
    ...clusterEdit('services'),
  });

  // ------------------------------------------------------------------ updates
  const updates = obj(spec['updates']);
  const source = str(updates['source']) || 'github';

  rows.push({
    id: 'cluster:updates',
    area: 'updates',
    name: T.updateSource,
    type: source,
    details: [str(updates['channel']) || 'stable', source === 'mirror' ? str(updates['mirrorUrl']) : '']
      .filter(Boolean)
      .join(' · '),
    state: 'configured',
    ...clusterEdit('operations'),
    link: '/delivery/updates',
  });

  // ------------------------------------------------------------------ routing
  for (const peer of of('BgpPeer')) {
    const s = obj(peer.spec);

    rows.push({
      id: `bgp:${peer.metadata.name}`,
      area: 'routing',
      name: peer.metadata.name,
      type: 'bgp',
      details: [`AS${str(s['asn'])}`, str(s['address'])].join(' · '),
      state: 'configured',
      edit: { key: key(peer) },
    });
  }

  for (const as of of('AutonomousSystem')) {
    const rtr = arr(obj(as.spec)['rtrServers']).map(obj);

    if (rtr.length === 0) continue;

    rows.push({
      id: `rpki:${as.metadata.name}`,
      area: 'routing',
      name: `${T.rpki}: ${as.metadata.name}`,
      type: 'rtr',
      details: rtr.map((r) => [str(r['address']), str(r['port'])].filter(Boolean).join(':')).join(', '),
      state: 'configured',
      edit: { key: key(as) },
    });
  }

  if (!rows.some((r) => r.area === 'routing'))
    rows.push({
      id: 'bgp:none',
      area: 'routing',
      name: T.bgpPeers,
      type: '—',
      details: T.noneYet,
      state: 'off',
      create: 'BgpPeer',
    });

  // ------------------------------------------------------------------ security
  rows.push({
    id: 'posture',
    area: 'security',
    name: T.posture,
    type: 'mdm / edr',
    details: '',
    state: 'configured',
    link: '/access/posture',
  });

  // ------------------------------------------------------------------ environment (read-only, cluster admins)
  for (const e of sources.env)
    rows.push({
      id: `env:${e.id}`,
      area: 'environment',
      name: ENV_LABELS[e.id] ?? e.label,
      type: 'env',
      details: Object.entries(e.details)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · '),
      state: e.active ? 'env' : 'off',
    });

  return rows;
}

/** Free-text filter over name, type, details and area label. */
export function filterIntegrationRows(
  rows: readonly IntegrationRow[],
  query: string,
  areaLabel: (area: IntegrationArea) => string,
): IntegrationRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return [...rows];

  return rows.filter((row) => {
    const text = [row.name, row.type, row.details, areaLabel(row.area), row.error ?? ''].join(' ').toLowerCase();

    return terms.every((term) => text.includes(term));
  });
}
