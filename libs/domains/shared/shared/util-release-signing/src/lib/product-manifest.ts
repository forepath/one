import { join } from 'node:path';

import { z } from 'zod';

import { canonicalJson } from './canonical-json';
import { sha256File } from './file-digest';
import { verifyManifestSignature } from './signature';

/**
 * A product release manifest: one signed document per product and release that names what the release ships — the
 * container images by digest and the downloadable files by SHA-256 — and the commit it was built from. Published next
 * to the release (`<product>-release-manifest-<version>.json` + `.sig`), so operators and self-hosted installs can pin
 * images by a verified digest and check downloads against a signed checksum instead of a checksum stored next to the
 * file. Products, images and keys are supplied by the caller; nothing here knows one.
 *
 * The schema is forward compatible: unknown top-level fields are kept (the signature covers the bytes as received).
 */
export const PRODUCT_RELEASE_MANIFEST_SCHEMA_VERSION = 1;

export const productSlugSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'invalid product');
/** A release version as tagged (`3.5.0`, `3.6.0-beta.1`), without a leading `v`. */
export const productReleaseVersionSchema = z
  .string()
  .max(64)
  .regex(
    /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/,
    'invalid release version',
  );
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'invalid SHA-256');
const imageDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'invalid image digest');
/** `registry/namespace/name` without tag or digest. */
const imageRepository = z
  .string()
  .max(255)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(\/[a-z0-9]+([._-][a-z0-9]+)*)+$/, 'invalid image repository');
/** A relative, `/`-separated path: no absolute paths, no `.` / `..` segments, no backslashes or control characters. */
export const releaseFilePathSchema = z
  .string()
  .min(1)
  .max(300)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^/\\\u0000-\u001f\u007f]+(\/[^/\\\u0000-\u001f\u007f]+)*$/, 'invalid file path')
  .refine((p) => p.split('/').every((s) => s !== '.' && s !== '..'), 'invalid file path');

export const releaseImageSchema = z
  .object({
    /** Name of the image within the product (`controller-api`). */
    name: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/, 'invalid image name'),
    repository: imageRepository,
    tag: z.string().max(128).optional(),
    digest: imageDigest,
  })
  .strict();
export type ReleaseImage = z.infer<typeof releaseImageSchema>;

export const releaseFileSchema = z
  .object({
    path: releaseFilePathSchema,
    sha256: sha256Hex,
    size: z
      .number()
      .int()
      .min(0)
      .max(64 * 1024 ** 3),
  })
  .strict();
export type ReleaseFile = z.infer<typeof releaseFileSchema>;

export const productReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal(PRODUCT_RELEASE_MANIFEST_SCHEMA_VERSION),
    product: productSlugSchema,
    version: productReleaseVersionSchema,
    channel: z.enum(['stable', 'beta']),
    source: z
      .object({
        /** `owner/repo` the release was built from. */
        repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, 'invalid repository'),
        commit: z.string().regex(/^[0-9a-f]{40}$/, 'invalid commit'),
      })
      .strict(),
    images: z.array(releaseImageSchema).max(256),
    files: z.array(releaseFileSchema).max(4096),
  })
  .loose();
export type ProductReleaseManifest = z.infer<typeof productReleaseManifestSchema>;

export interface ProductReleaseManifestInput {
  product: string;
  version: string;
  /** Defaults from the version: prereleases are the beta channel. */
  channel?: ProductReleaseManifest['channel'];
  source: ProductReleaseManifest['source'];
  images: readonly ReleaseImage[];
  files: readonly ReleaseFile[];
}

/** A validated manifest with images sorted by name and files by path; duplicates are refused. */
export function createProductReleaseManifest(input: ProductReleaseManifestInput): ProductReleaseManifest {
  const manifest = productReleaseManifestSchema.parse({
    ...input,
    schemaVersion: PRODUCT_RELEASE_MANIFEST_SCHEMA_VERSION,
    channel: input.channel ?? (input.version.includes('-') ? 'beta' : 'stable'),
    images: [...input.images].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    files: [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });

  for (const [what, keys] of [
    ['image', manifest.images.map((i) => i.name)],
    ['file', manifest.files.map((f) => f.path)],
  ] as const) {
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);

    if (dup) throw new Error(`duplicate ${what} in the release manifest: ${dup}`);
  }

  return manifest;
}

/** The bytes that are signed and published: the manifest's canonical JSON. */
export function productReleaseManifestBytes(manifest: ProductReleaseManifest): Buffer {
  return Buffer.from(canonicalJson(manifest), 'utf8');
}

export type ProductManifestCheck =
  | { ok: true; manifest: ProductReleaseManifest; keyId: string }
  | { ok: false; reason: string };

/**
 * Verifies a published manifest: canonical form, schema, the expected product and the signature against the trusted
 * keys. Only a manifest that passes every check is returned.
 */
export function verifyProductReleaseManifest(
  manifestBytes: Uint8Array,
  signature: unknown,
  trustedKeysPem: readonly string[],
  expectedProduct: string,
): ProductManifestCheck {
  const text = Buffer.from(manifestBytes).toString('utf8');
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'the manifest is not JSON' };
  }

  if (canonicalJson(json) !== text) return { ok: false, reason: 'the manifest is not in canonical form' };

  const parsed = productReleaseManifestSchema.safeParse(json);

  if (!parsed.success) return { ok: false, reason: `the manifest is malformed: ${parsed.error.issues[0]?.message}` };

  if (parsed.data.product !== expectedProduct)
    return { ok: false, reason: `the manifest is for ${parsed.data.product}, not ${expectedProduct}` };

  const check = verifyManifestSignature(manifestBytes, signature, trustedKeysPem);

  if ('reason' in check) return { ok: false, reason: check.reason };

  return { ok: true, manifest: parsed.data, keyId: check.keyId };
}

export type ReleaseFileStatus = 'ok' | 'missing' | 'mismatch';

/**
 * Checks the manifest's files that exist below `root` (laid out as in the manifest). A download usually holds only
 * some files, so absent ones are `missing`, not an error; a present file with another digest or size is `mismatch`.
 */
export async function checkReleaseFiles(
  files: readonly ReleaseFile[],
  root: string,
): Promise<{ path: string; status: ReleaseFileStatus }[]> {
  const out: { path: string; status: ReleaseFileStatus }[] = [];

  for (const file of files) {
    try {
      const actual = await sha256File(join(root, ...file.path.split('/')));

      out.push({
        path: file.path,
        status: actual.sha256 === file.sha256 && actual.size === file.size ? 'ok' : 'mismatch',
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

      out.push({ path: file.path, status: 'missing' });
    }
  }

  return out;
}
