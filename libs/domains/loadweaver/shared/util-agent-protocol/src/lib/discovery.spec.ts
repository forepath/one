import { parse } from 'yaml';

import {
  discoveryReportSchema,
  hasUrlCredentials,
  importStepCommandSchema,
  isSensitiveVariable,
  redactCompose,
} from './discovery';
import { joinRequestSchema } from './messages';

describe('discovery redaction (3.21)', () => {
  it('treats sensitive names and URL credentials as secrets', () => {
    expect(isSensitiveVariable('DB_PASSWORD')).toBe(true);
    expect(isSensitiveVariable('DATABASE_URL', 'x')).toBe(true);
    expect(isSensitiveVariable('MONGO_URI')).toBe(true);
    expect(isSensitiveVariable('AMQP_CONN')).toBe(true);
    expect(isSensitiveVariable('UPSTREAM', 'redis://:pw@redis:6379')).toBe(true);
    expect(isSensitiveVariable('GREETING', 'hello')).toBe(false);
    expect(hasUrlCredentials('postgres://app:pw@db/app')).toBe(true);
    expect(hasUrlCredentials('postgres://app:${DB_PASSWORD}@db/app')).toBe(false);
    expect(hasUrlCredentials('https://example.com/a@b')).toBe(false);
  });

  it('replaces secret environment values and URL credentials with placeholders, keeping comments', () => {
    const result = redactCompose(`# shop
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: s3cret # keep me
      POSTGRES_USER: app
      TEMPLATED_URL: postgres://app:\${DB_PASSWORD}@db/app
  app:
    image: app:1
    environment:
      - DATABASE_URL=postgres://app:pw@db/app
      - MODE=prod
    command: ["worker", "--broker", "amqp://guest:guest@mq:5672/"]
`);

    expect(result).not.toBeNull();
    expect(result?.content).toContain('# keep me');
    expect(result?.content).not.toMatch(/s3cret|:pw@|guest:guest/);

    const doc = parse(result?.content ?? '') as { services: Record<string, Record<string, unknown>> };

    expect(doc.services['db']['environment']).toEqual({
      POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}',
      POSTGRES_USER: 'app',
      TEMPLATED_URL: 'postgres://app:${DB_PASSWORD}@db/app',
    });
    expect(doc.services['app']['environment']).toEqual(['DATABASE_URL=${DATABASE_URL}', 'MODE=prod']);
    expect(doc.services['app']['command']).toEqual(['worker', '--broker', 'amqp://guest:${LW_REDACTED_3}@mq:5672/']);
    expect(result?.redacted).toEqual([
      { variable: 'POSTGRES_PASSWORD', path: 'services.db.environment.POSTGRES_PASSWORD' },
      { variable: 'DATABASE_URL', path: 'services.app.environment[0]' },
      { variable: 'LW_REDACTED_3', path: 'services.app.command' },
    ]);
  });

  it('reports nothing for files it cannot parse', () => {
    expect(redactCompose('services: [unclosed')).toBeNull();
  });
});

describe('discovery messages', () => {
  const report = {
    version: 1,
    at: '2026-10-20T10:00:00.000Z',
    hostname: 'host1',
    docker: { available: true },
    composeProjects: [],
    containers: [],
    volumes: [],
    networks: [],
    listeners: [],
    interfaces: [],
    routes: [],
    vpns: [],
    nftables: [],
    former: null,
    warnings: [],
  };

  it('needs a discovery report for a discover join', () => {
    const hello = {
      nodeName: 'host1',
      agentVersion: '0.1.0',
      os: { id: 'debian', versionId: '13', kernel: '6.12.0', arch: 'amd64' },
      capabilities: {
        runtimes: ['runc'],
        sandboxProbe: 'missing',
        wireguard: true,
        nftables: true,
        bird: true,
        drbd: false,
        criu: false,
      },
      capacity: { cpuMillis: 4000, memoryBytes: 8e9, diskBytes: 1e11 },
      wireguardPublicKey: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
      appliedRevision: 0,
    };
    const base = { token: 'lwj_' + 'a'.repeat(30), nodeName: 'host1', csrPem: 'csr', hello };

    expect(discoveryReportSchema.safeParse(report).success).toBe(true);
    expect(joinRequestSchema.safeParse(base).success).toBe(true);
    expect(
      joinRequestSchema
        .safeParse({ ...base, discover: true })
        .error?.issues.some((i) => i.path.join('.') === 'discovery'),
    ).toBe(true);
    expect(joinRequestSchema.safeParse({ ...base, discover: true, discovery: report }).success).toBe(true);
  });

  it('accepts import steps and refuses relative copy sources', () => {
    const step = (source: string) => ({
      import: '7f1c4d3e-2b1a-4c5d-8e9f-0a1b2c3d4e5f',
      step: 'shop/shop/precopy',
      action: { kind: 'precopy', copies: [{ source, volume: 'lw-vol-shop.shop.html' }] },
    });

    expect(importStepCommandSchema.safeParse(step('/var/lib/docker/volumes/shop_html/_data')).success).toBe(true);
    expect(importStepCommandSchema.safeParse(step('../etc')).success).toBe(false);
  });
});
