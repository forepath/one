import { z } from 'zod';

import {
  APP_NAME_PATTERN,
  APP_STORE_API_VERSION,
  compareVersions,
  DIGEST_PATTERN,
  KEY_ID_PATTERN,
  parseWithSchema,
  SEMVER_PATTERN,
  trustRank,
  TRUST_LABELS,
  type ParseResult,
  type TrustLabel,
} from './common';

const nameSchema = z.string().regex(APP_NAME_PATTERN, 'must be a DNS label (a-z, 0-9, -; max. 63)');
const semverSchema = z.string().regex(SEMVER_PATTERN, 'must be a semantic version (e.g. 1.2.3)');
const timestampSchema = z.iso.datetime({ offset: true });

/**
 * A publisher key, keyed by its key id in `publishers`. A publisher (by `name`) can have several keys (rotation).
 * `label` caps the trust label of the publisher's apps.
 */
export const catalogPublisherSchema = z.object({
  name: z.string().min(1).max(100),
  publicKey: z.string().includes('-----BEGIN PUBLIC KEY-----', { message: 'must be a PEM public key' }),
  label: z.enum(TRUST_LABELS),
});
export type CatalogPublisher = z.infer<typeof catalogPublisherSchema>;

export const catalogAppVersionSchema = z.object({
  version: semverSchema,
  channel: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  /** Digest of the package archive (`sha256:<hex>`). */
  digest: z.string().regex(DIGEST_PATTERN, 'must be sha256:<64 hex>'),
  published: timestampSchema,
  /** The package manifest's `minLoadweaver` (lists can show older clusters can't install it without the package). */
  minLoadweaver: semverSchema.optional(),
});
export type CatalogAppVersion = z.infer<typeof catalogAppVersionSchema>;

export const catalogAppSchema = z.object({
  name: nameSchema,
  title: z.string().min(1).max(100),
  summary: z.string().max(500),
  /** Publisher name (`publishers[*].name`). */
  publisher: z.string().min(1).max(100),
  trust: z.enum(TRUST_LABELS),
  versions: z.array(catalogAppVersionSchema).min(1),
  deprecated: z.boolean().optional(),
});
export type CatalogApp = z.infer<typeof catalogAppSchema>;

export const catalogTakedownSchema = z.object({
  app: nameSchema,
  /** Affected versions, or `all`. */
  versions: z.union([z.literal('all'), z.array(semverSchema).min(1)]),
  reason: z.string().min(1).max(2000),
  at: timestampSchema,
});
export type CatalogTakedown = z.infer<typeof catalogTakedownSchema>;

/**
 * `index.yaml` of a catalog (signed by the catalog key). Unknown keys are dropped rather than refused, so older
 * clusters keep reading newer indexes.
 */
export const catalogIndexSchema = z
  .object({
    apiVersion: z.literal(APP_STORE_API_VERSION),
    kind: z.literal('CatalogIndex'),
    catalog: z.object({ name: nameSchema, title: z.string().min(1).max(100), trust: z.enum(TRUST_LABELS) }),
    publishers: z.record(z.string(), catalogPublisherSchema),
    apps: z.array(catalogAppSchema).default([]),
    takedowns: z.array(catalogTakedownSchema).default([]),
    generatedAt: timestampSchema,
  })
  .superRefine((index, ctx) => {
    const publisherLabels = new Map<string, TrustLabel>();

    for (const [keyId, p] of Object.entries(index.publishers)) {
      if (!KEY_ID_PATTERN.test(keyId))
        ctx.addIssue({
          code: 'custom',
          path: ['publishers', keyId],
          message: 'publishers are keyed by key id (SHA-256 hex of the SPKI DER)',
        });

      const current = publisherLabels.get(p.name);

      if (!current || trustRank(p.label) < trustRank(current)) publisherLabels.set(p.name, p.label);
    }

    const names = new Set<string>();

    index.apps.forEach((app, i) => {
      if (names.has(app.name))
        ctx.addIssue({ code: 'custom', path: ['apps', i, 'name'], message: `duplicate app ${app.name}` });

      names.add(app.name);

      const label = publisherLabels.get(app.publisher);

      if (!label)
        ctx.addIssue({ code: 'custom', path: ['apps', i, 'publisher'], message: `unknown publisher ${app.publisher}` });
      else if (trustRank(app.trust) < trustRank(label))
        ctx.addIssue({
          code: 'custom',
          path: ['apps', i, 'trust'],
          message: `trust ${app.trust} exceeds the publisher's label ${label}`,
        });

      const versions = new Set<string>();

      app.versions.forEach((v, j) => {
        if (versions.has(v.version))
          ctx.addIssue({
            code: 'custom',
            path: ['apps', i, 'versions', j, 'version'],
            message: `duplicate version ${v.version}`,
          });

        versions.add(v.version);
      });
    });
  });
export type CatalogIndex = z.infer<typeof catalogIndexSchema>;

/**
 * Parses `index.yaml` (YAML text, bytes or an already parsed object). Only call this on bytes whose signature was
 * verified, or use `verifyIndex`, which verifies and parses in one step.
 */
export function parseIndex(source: string | Uint8Array | unknown): ParseResult<CatalogIndex> {
  return parseWithSchema(source, catalogIndexSchema, 'index.yaml');
}

/** The takedown covering an app version (or the whole app when `version` is omitted), if any. */
export function findTakedown(index: CatalogIndex, app: string, version?: string): CatalogTakedown | undefined {
  return index.takedowns.find(
    (t) => t.app === app && (t.versions === 'all' || (version !== undefined && t.versions.includes(version))),
  );
}

/**
 * The apps a cluster may show: taken-down versions removed, apps without versions left out, versions sorted newest
 * first.
 */
export function listedApps(index: CatalogIndex): CatalogApp[] {
  return index.apps.flatMap((app) => {
    const versions = app.versions
      .filter((v) => !findTakedown(index, app.name, v.version))
      .sort((a, b) => compareVersions(b.version, a.version));

    return versions.length > 0 ? [{ ...app, versions }] : [];
  });
}

/** Newest listed version of an app in a channel (taken-down versions skipped). */
export function latestVersion(index: CatalogIndex, app: string, channel = 'stable'): CatalogAppVersion | undefined {
  return listedApps(index)
    .find((a) => a.name === app)
    ?.versions.find((v) => v.channel === channel);
}

/**
 * The trust label a cluster shows for an app: `official` only from a catalog configured as the official one
 * (`official: true`); any other catalog is capped at `verified`, whatever its index claims.
 */
export function effectiveTrust(app: Pick<CatalogApp, 'trust'>, source: { official?: boolean }): TrustLabel {
  return app.trust === 'official' && !source.official ? 'verified' : app.trust;
}
