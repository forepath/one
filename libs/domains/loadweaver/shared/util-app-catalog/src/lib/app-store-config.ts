import { z } from 'zod';

import { APP_NAME_PATTERN, isRecord, parseWithSchema, TRUST_LABELS, type ParseResult, type TrustLabel } from './common';

export const CATALOG_TYPES = ['oci', 'git', 'fleet'] as const;
export type CatalogType = (typeof CATALOG_TYPES)[number];

/** Name of the preconfigured official ForePath catalog. */
export const OFFICIAL_CATALOG_NAME = 'official';

/** Trust labels projects may install when `allowedTrust` is not set. */
export const DEFAULT_ALLOWED_TRUST: readonly TrustLabel[] = ['official', 'verified'];

const URL_PREFIXES: Record<CatalogType, RegExp> = {
  oci: /^oci:\/\/[a-z0-9.-]+(:\d+)?\/[a-z0-9]+([._/-][a-z0-9]+)*$/,
  git: /^(https?|ssh):\/\/\S+$/,
  fleet: /^https?:\/\/\S+$/,
};

const URL_HINTS: Record<CatalogType, string> = {
  oci: 'oci://<registry>/<repository>',
  git: 'https://… or ssh://…',
  fleet: 'https://<fleet>',
};

/** A full commit id (SHA-1 or SHA-256). */
export const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A branch / tag name as `git check-ref-format` allows it (restricted to a safe character set). */
const GIT_REF_NAME =
  /^(?!-)(?!\/)(?!.*\/\/)(?!.*\.\.)(?!.*\.lock(\/|$))(?!.*\/$)(?!.*\.$)(?!.*\/\.)(?!\.)[A-Za-z0-9._/+-]{1,200}$/;

/** What a Git catalog `ref` names: a full commit, `refs/heads/<branch>`, `refs/tags/<tag>`, or a branch / tag name. */
export type GitCatalogRef =
  | { kind: 'commit'; commit: string }
  | { kind: 'branch' | 'tag'; name: string }
  | { kind: 'name'; name: string };

/**
 * Parses a Git catalog `ref`: a branch (`main`), a tag (`v1.2.0`), either spelled out (`refs/heads/main`,
 * `refs/tags/v1.2.0`), or a full commit SHA (40 / 64 hex). A bare name is resolved on the remote (a branch or a
 * tag; both = ambiguous). Null when it is none of these.
 */
export function parseGitCatalogRef(ref: string): GitCatalogRef | null {
  if (GIT_COMMIT_PATTERN.test(ref)) return { kind: 'commit', commit: ref };

  const spelled = /^refs\/(heads|tags)\/(.+)$/.exec(ref);

  if (spelled)
    return GIT_REF_NAME.test(spelled[2]) ? { kind: spelled[1] === 'heads' ? 'branch' : 'tag', name: spelled[2] } : null;

  return GIT_REF_NAME.test(ref) && !ref.startsWith('refs/') ? { kind: 'name', name: ref } : null;
}

/**
 * One catalog source. `oci`: `oci://registry/repo` (packages `repo/<app>:<version>`, index `repo:index`); `git`: a
 * repository with `index.yaml` + package archives at `ref` (a branch, tag or full commit SHA; `main` when omitted); `fleet`: the catalog the
 * fleet hosts (its key comes from the fleet link when `publicKeys` is empty). Keys are PEM public keys
 * (ECDSA P-256 / Ed25519); `official: true` uses the ForePath key that ships with Loadweaver. `publicKey` (one key)
 * is accepted and normalized to `publicKeys`.
 */
export const catalogSourceSchema = z.preprocess(
  (raw) => {
    if (!isRecord(raw) || raw['publicKey'] === undefined) return raw;

    const { publicKey, ...rest } = raw;
    const keys = Array.isArray(rest['publicKeys']) ? rest['publicKeys'] : [];

    return { ...rest, publicKeys: [publicKey, ...keys] };
  },
  z
    .strictObject({
      name: z.string().regex(APP_NAME_PATTERN, 'must be a DNS label (a-z, 0-9, -; max. 63)'),
      type: z.enum(CATALOG_TYPES),
      url: z.string().min(1).max(2048),
      ref: z.string().min(1).max(255).optional(),
      publicKeys: z
        .array(z.string().includes('-----BEGIN PUBLIC KEY-----', { message: 'must be a PEM public key' }))
        .optional(),
      official: z.boolean().optional(),
      enabled: z.boolean().default(false),
    })
    .superRefine((c, ctx) => {
      if (!URL_PREFIXES[c.type].test(c.url))
        ctx.addIssue({ code: 'custom', path: ['url'], message: `${c.type} catalogs are ${URL_HINTS[c.type]}` });

      if (c.ref !== undefined && c.type !== 'git')
        ctx.addIssue({ code: 'custom', path: ['ref'], message: 'ref is only used by git catalogs' });
      else if (c.ref !== undefined && !parseGitCatalogRef(c.ref))
        ctx.addIssue({
          code: 'custom',
          path: ['ref'],
          message: 'ref is a branch, a tag (refs/heads/… / refs/tags/… to be explicit) or a full commit SHA',
        });

      if (c.official && c.publicKeys?.length)
        ctx.addIssue({ code: 'custom', path: ['publicKeys'], message: 'the official catalog uses the shipped key' });

      if (!c.official && c.type !== 'fleet' && !c.publicKeys?.length)
        ctx.addIssue({
          code: 'custom',
          path: ['publicKeys'],
          message: 'a catalog needs its public key(s) or official: true',
        });
    }),
);
export type CatalogSource = z.infer<typeof catalogSourceSchema>;

/** `Cluster.spec.appStore`. */
export const appStoreConfigSchema = z
  .strictObject({
    catalogs: z.array(catalogSourceSchema).default([]),
    allowedTrust: z.array(z.enum(TRUST_LABELS)).default([...DEFAULT_ALLOWED_TRUST]),
  })
  .superRefine((c, ctx) => {
    const names = new Set<string>();

    c.catalogs.forEach((catalog, i) => {
      if (names.has(catalog.name))
        ctx.addIssue({ code: 'custom', path: ['catalogs', i, 'name'], message: `duplicate catalog ${catalog.name}` });

      names.add(catalog.name);
    });

    if (c.catalogs.filter((x) => x.official).length > 1)
      ctx.addIssue({ code: 'custom', path: ['catalogs'], message: 'only one catalog can be the official one' });
  });
export type AppStoreConfig = z.infer<typeof appStoreConfigSchema>;

/** Parses `Cluster.spec.appStore` (YAML text, bytes or an already parsed object). */
export function parseAppStoreConfig(source: string | Uint8Array | unknown): ParseResult<AppStoreConfig> {
  return parseWithSchema(source, appStoreConfigSchema, 'appStore');
}

/** The default `appStore`: the official catalog preconfigured and disabled, `allowedTrust` official + verified. */
export function defaultAppStoreConfig(official: { type: CatalogType; url: string; ref?: string }): AppStoreConfig {
  return {
    catalogs: [{ name: OFFICIAL_CATALOG_NAME, ...official, official: true, enabled: false }],
    allowedTrust: [...DEFAULT_ALLOWED_TRUST],
  };
}

/**
 * Same origin and path (trailing slashes ignored): how a `type: fleet` source finds its trusted fleet, and how the
 * fleet finds its own catalog entry in a cluster.
 */
export function sameCatalogUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);

    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
}

/** Whether projects may install an app with this (effective) trust label. */
export function isTrustAllowed(trust: TrustLabel, config: Pick<AppStoreConfig, 'allowedTrust'>): boolean {
  return config.allowedTrust.includes(trust);
}
