import type {
  AppDetail,
  AppManifest,
  AppSummary,
  InstalledApp,
} from '@forepath/loadweaver/frontend/data-access-console';

/** A manifest with a plain parameter, a bundled-or-provided dependency, a secret, suggestions and migrations. */
export function testManifest(overrides: Partial<AppManifest> = {}): AppManifest {
  return {
    apiVersion: 'apps.loadweaver.com/v1',
    name: 'agenstra',
    version: '1.2.0',
    title: 'Agenstra',
    description: 'Agent orchestration.',
    publisher: 'ForePath',
    license: 'AGPL-3.0-only',
    homepage: 'https://agenstra.example',
    docs: 'https://docs.agenstra.example',
    channels: ['stable', 'beta'],
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', title: 'Domain', description: 'Public host name', pattern: '^[a-z.]+$' },
        replicas: { type: 'integer', title: 'Replicas', default: 1, minimum: 1 },
        bundledPostgres: { type: 'boolean', title: 'Bundled Postgres', default: true },
        postgresUrl: { type: 'string', title: 'Postgres URL' },
      },
      required: ['domain', 'postgresUrl'],
    },
    secrets: [{ name: 'admin-password', description: 'Initial admin password' }],
    dependencies: [
      {
        name: 'postgres',
        title: 'PostgreSQL',
        bundled: { parameter: 'bundledPostgres', services: ['postgres'], volumes: ['pgdata'] },
        provided: { parameters: ['postgresUrl'] },
      },
    ],
    suggestions: {
      groups: [],
      policies: [{ kind: 'Policy', metadata: { name: 'agenstra-ingress' } }],
      ingress: [],
      dns: [{ kind: 'DnsRecord', metadata: { name: 'agenstra' } }],
    },
    backups: [{ name: 'daily', schedule: '0 3 * * *', volumes: ['pgdata'] }],
    migrations: [
      { version: '1.1.0', steps: [{ name: 'schema 11', service: 'api', command: ['migrate'], phase: 'before' }] },
      { version: '1.2.0', steps: [{ name: 'schema 12', service: 'api', command: ['migrate'], phase: 'before' }] },
    ],
    ...overrides,
  };
}

export function testApp(overrides: Partial<AppSummary> = {}): AppSummary {
  return {
    catalog: 'official',
    name: 'agenstra',
    title: 'Agenstra',
    summary: 'Agent orchestration',
    publisher: 'ForePath',
    trust: 'official',
    latest: {
      version: '1.2.0',
      channel: 'stable',
      digest: `sha256:${'b'.repeat(64)}`,
      published: '2026-10-01T00:00:00Z',
    },
    installable: true,
    deprecated: false,
    ...overrides,
  };
}

export function testDetail(overrides: Partial<AppDetail> = {}): AppDetail {
  return {
    ...testApp(),
    versions: [
      { version: '1.0.0', channel: 'stable', digest: `sha256:${'a'.repeat(64)}`, published: '2026-09-01T00:00:00Z' },
      { version: '1.2.0', channel: 'stable', digest: `sha256:${'b'.repeat(64)}`, published: '2026-10-01T00:00:00Z' },
      {
        version: '1.3.0-beta.1',
        channel: 'beta',
        digest: `sha256:${'c'.repeat(64)}`,
        published: '2026-10-20T00:00:00Z',
      },
    ],
    manifest: testManifest(),
    readme: '# Agenstra\n\nHello.',
    ...overrides,
  };
}

export function testInstalled(overrides: Partial<InstalledApp> = {}): InstalledApp {
  return {
    project: 'shop',
    deployment: 'agenstra',
    app: {
      catalog: 'official',
      name: 'agenstra',
      version: '1.0.0',
      channel: 'stable',
      digest: `sha256:${'a'.repeat(64)}`,
    },
    title: 'Agenstra',
    parameters: {},
    updates: [
      { version: '1.2.0', channel: 'stable', digest: `sha256:${'b'.repeat(64)}`, published: '2026-10-01T00:00:00Z' },
    ],
    availability: 'ok',
    takedown: null,
    ...overrides,
  };
}
