/* Test helpers for the app store (P1): an in-memory data source, throwaway keys, signed catalogs and packages. */
import {
  buildPackageArchive,
  generateSigningKeyPair,
  sha256Digest,
  signBlob,
  type SigningKeyPair,
} from '@forepath/loadweaver/shared/util-app-catalog';
import { FindOperator } from 'typeorm';
import { stringify } from 'yaml';

export const WIKI_MANIFEST = `apiVersion: apps.loadweaver.com/v1
name: wiki
version: VERSION
title: Wiki
description: A small wiki.
publisher: acme
license: AGPL-3.0-only
homepage: https://example.com/wiki
docs: https://example.com/wiki/docs
channels: [stable]
parameters:
  type: object
  properties:
    hostname: { type: string, title: Hostname }
    port: { type: integer, default: 8080 }
    bundlePostgres: { type: boolean, default: true }
  required: [hostname]
secrets:
  - name: db-password
    description: Database password
dependencies:
  - name: postgres
    bundled: { parameter: bundlePostgres, services: [postgres], volumes: [pgdata] }
suggestions:
  groups:
    - kind: WorkloadGroup
      metadata: { name: wiki-web }
      spec: { selector: { matchLabels: { app: wiki } } }
  policies: []
  ingress: []
  dns:
    - kind: Cluster
      metadata: { name: nope }
      spec: {}
backups:
  - name: nightly
    schedule: "@daily"
    volumes: [pgdata]
    retention: 7 days
migrations:
  - version: 1.1.0
    steps:
      - { name: migrate schema, service: web, command: [wiki, migrate] }
  - version: 1.2.0
    steps:
      - { name: reindex, service: web, command: [wiki, reindex], phase: after }
`;

export const WIKI_COMPOSE = `services:
  web:
    image: ghcr.io/acme/wiki:1@sha256:${'a'.repeat(64)}
    environment:
      HOSTNAME: \${hostname}
      PORT: \${port}
      DB_PASSWORD_FILE: /run/secrets/db-password
    ports: ["8080"]
    secrets: [db-password]
    depends_on: [postgres]
    volumes: [data:/data]
  postgres:
    image: postgres:17@sha256:${'b'.repeat(64)}
    volumes: [pgdata:/var/lib/postgresql/data]
secrets:
  db-password:
    x-loadweaver-ref: \${secret:db-password}
volumes:
  data: {}
  pgdata: {}
`;

export function wikiPackage(version: string, overrides: { manifest?: string; compose?: string } = {}): Buffer {
  return buildPackageArchive({
    manifest: (overrides.manifest ?? WIKI_MANIFEST).replace('VERSION', version),
    compose: overrides.compose ?? WIKI_COMPOSE,
    readme: '# Wiki\n',
  });
}

export interface TestCatalog {
  catalogKey: SigningKeyPair;
  publisherKey: SigningKeyPair;
  packages: Map<string, Buffer>;
  index: Record<string, unknown>;
  indexBytes: () => Buffer;
}

/** A catalog with `wiki` in the given versions, signed by a throwaway catalog key; packages by the publisher key. */
export function testCatalog(
  versions: string[] = ['1.0.0', '1.2.0'],
  options: {
    takedowns?: unknown[];
    generatedAt?: string;
    trust?: 'official' | 'verified' | 'community';
    keys?: { catalogKey: SigningKeyPair; publisherKey: SigningKeyPair };
    /** Manifest text (`VERSION` is replaced) instead of the wiki's. */
    manifest?: string;
    /** `minLoadweaver` in every manifest and index version. */
    minLoadweaver?: string;
    /** Compose text instead of the wiki's. */
    compose?: string;
  } = {},
): TestCatalog {
  const catalogKey = options.keys?.catalogKey ?? generateSigningKeyPair('ecdsa-p256');
  const publisherKey = options.keys?.publisherKey ?? generateSigningKeyPair('ed25519');
  const manifest = (options.manifest ?? WIKI_MANIFEST).replace(
    'channels: [stable]\n',
    `channels: [stable]\n${options.minLoadweaver ? `minLoadweaver: ${options.minLoadweaver}\n` : ''}`,
  );
  const packages = new Map(versions.map((v) => [v, wikiPackage(v, { manifest, compose: options.compose })] as const));
  const trust = options.trust ?? 'verified';
  const index = {
    apiVersion: 'apps.loadweaver.com/v1',
    kind: 'CatalogIndex',
    catalog: { name: 'acme', title: 'Acme apps', trust },
    publishers: { [publisherKey.keyId]: { name: 'acme', publicKey: publisherKey.publicKeyPem, label: trust } },
    apps: [
      {
        name: 'wiki',
        title: 'Wiki',
        summary: 'A small wiki',
        publisher: 'acme',
        trust,
        versions: versions.map((v) => ({
          version: v,
          channel: 'stable',
          digest: sha256Digest(packages.get(v) as Buffer),
          published: '2026-10-30T00:00:00Z',
          ...(options.minLoadweaver ? { minLoadweaver: options.minLoadweaver } : {}),
        })),
      },
    ],
    takedowns: options.takedowns ?? [],
    generatedAt: options.generatedAt ?? '2026-10-31T00:00:00Z',
  };

  return { catalogKey, publisherKey, packages, index, indexBytes: () => Buffer.from(stringify(index)) };
}

export function blobSignature(bytes: Buffer, key: SigningKeyPair): { kind: 'blob'; signature: string } {
  return { kind: 'blob', signature: signBlob(bytes, key.privateKeyPem) };
}

type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;

  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];

    if (expected instanceof FindOperator) {
      const value = expected.value as unknown;

      if (expected.type === 'in') return (value as unknown[]).includes(actual);

      if (expected.type === 'like') {
        const pattern = new RegExp(
          `^${String(value)
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/%/g, '.*')}$`,
        );

        return pattern.test(String(actual));
      }

      if (expected.type === 'not') return actual !== value;

      return false;
    }

    return actual === expected;
  });
}

/** An in-memory TypeORM-like data source: repositories per entity with simple `where` matching (=, In, Like, Not). */
export function memoryDataSource(keys: Map<unknown, string[]> = new Map()) {
  const tables = new Map<unknown, Row[]>();
  const table = (entity: unknown) => {
    if (!tables.has(entity)) tables.set(entity, []);

    return tables.get(entity) as Row[];
  };
  const keyOf = (entity: unknown, row: Row) => (keys.get(entity) ?? ['id']).map((k) => String(row[k])).join('|');
  const repo = (entity: unknown) => ({
    find: async (options: { where?: Row } = {}) => table(entity).filter((r) => matches(r, options.where)),
    findOne: async (options: { where?: Row } = {}) => table(entity).find((r) => matches(r, options.where)) ?? null,
    exists: async (options: { where?: Row } = {}) => table(entity).some((r) => matches(r, options.where)),
    count: async (options: { where?: Row } = {}) => table(entity).filter((r) => matches(r, options.where)).length,
    create: (row: Row) => ({ ...row }),
    save: async (row: Row) => {
      const rows = table(entity);
      const i = rows.findIndex((r) => keyOf(entity, r) === keyOf(entity, row));

      if (i >= 0) rows[i] = row;
      else rows.push(row);

      return row;
    },
    remove: async (remove: Row[]) => {
      const rows = table(entity);

      for (const row of remove) {
        const i = rows.findIndex((r) => keyOf(entity, r) === keyOf(entity, row));

        if (i >= 0) rows.splice(i, 1);
      }

      return remove;
    },
  });
  const manager = {
    getRepository: repo,
    query: async () => [{ locked: true }],
    queryRunner: { isTransactionActive: true },
  };
  const dataSource = {
    getRepository: repo,
    manager,
    transaction: async <T>(fn: (m: typeof manager) => Promise<T>) => await fn(manager),
  };

  return { dataSource, table };
}
