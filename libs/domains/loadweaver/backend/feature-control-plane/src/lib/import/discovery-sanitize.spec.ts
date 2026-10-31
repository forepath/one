import { discoveryReportSchema } from '@forepath/loadweaver/shared/util-agent-protocol';

import { sanitizeDiscovery } from './discovery-sanitize';

describe('sanitizeDiscovery (3.21, defense in depth)', () => {
  it('redacts what an agent forgot: compose secrets, .env values, foreign labels', () => {
    const report = discoveryReportSchema.parse({
      version: 1,
      at: '2026-10-20T10:00:00.000Z',
      hostname: 'h',
      docker: { available: true },
      composeProjects: [
        {
          name: 'shop',
          configFiles: [
            { path: '/a.yaml', content: 'services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: s3cret\n' },
            { path: '/b.yaml', content: 'services: [broken' },
          ],
          envFile: {
            path: '/.env',
            variables: [
              { name: 'URL_OF_DB', value: 'postgres://u:pw@db/x', sensitive: false },
              { name: 'MODE', value: 'prod', sensitive: false },
            ],
          },
          services: ['db'],
          containers: [],
        },
      ],
      containers: [
        {
          id: 'a'.repeat(64),
          name: 'x',
          image: 'i',
          state: 'running',
          ports: [],
          mounts: [],
          networks: [],
          labels: { 'com.docker.compose.project': 'shop', 'app.secret': 'v' },
          managed: false,
        },
      ],
      volumes: [],
      networks: [],
      listeners: [],
      interfaces: [],
      routes: [],
      vpns: [],
      nftables: [],
      former: null,
      warnings: [],
    });
    const clean = sanitizeDiscovery(report);

    expect(JSON.stringify(clean)).not.toMatch(/s3cret|u:pw@|app\.secret/);
    expect(clean.composeProjects[0].configFiles[0]).toEqual({
      path: '/a.yaml',
      content: 'services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}\n',
      redacted: [{ variable: 'POSTGRES_PASSWORD', path: 'services.db.environment.POSTGRES_PASSWORD' }],
    });
    expect(clean.composeProjects[0].configFiles[1]).toEqual({ path: '/b.yaml', error: 'not valid YAML; not stored' });
    expect(clean.composeProjects[0].envFile?.variables).toEqual([
      { name: 'URL_OF_DB', sensitive: true },
      { name: 'MODE', value: 'prod', sensitive: false },
    ]);
  });
});
