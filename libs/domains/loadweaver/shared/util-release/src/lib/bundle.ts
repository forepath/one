import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json';
import { missingComponents, releaseManifestSchema, type ArtifactFile, type ReleaseManifest } from './manifest';
import { verifyManifestSignature, type ReleaseSignature } from './signature';
import { readAll, readTar } from './tar';

export const MANIFEST_ENTRY = 'manifest.json';
export const SIGNATURE_ENTRY = 'manifest.sig';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 4096;

export class BundleError extends Error {
  constructor(
    message: string,
    /** `signature`: refused because of its signature (never imported); `format`: malformed / inconsistent. */
    readonly kind: 'signature' | 'format' | 'size',
  ) {
    super(message);
  }
}

/** Parses and checks a manifest document: canonical bytes, schema, required components. */
export function parseManifest(bytes: Uint8Array): ReleaseManifest {
  const text = Buffer.from(bytes).toString('utf8');
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    throw new BundleError('manifest.json is not JSON', 'format');
  }

  if (canonicalJson(json) !== text) throw new BundleError('manifest.json is not in canonical form', 'format');

  const parsed = releaseManifestSchema.safeParse(json);

  if (!parsed.success)
    throw new BundleError(
      `manifest.json is invalid: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      'format',
    );

  const missing = missingComponents(parsed.data);

  if (missing.length) throw new BundleError(`manifest.json is incomplete: ${missing.join('; ')}`, 'format');

  return parsed.data;
}

export interface VerifiedManifest {
  manifest: ReleaseManifest;
  /** The signed bytes (canonical JSON). */
  manifestBytes: Buffer;
  signature: ReleaseSignature | null;
  /** Key that verified the signature; null for an accepted unsigned development bundle. */
  keyId: string | null;
}

/**
 * Verifies a manifest and its signature document (null / `{"algorithm":"none"}` = unsigned). Unsigned manifests pass
 * only with `allowUnsigned` (development, explicit opt-in).
 */
export function verifyManifest(
  manifestBytes: Uint8Array,
  signature: unknown,
  options: { trustedKeys: readonly string[]; allowUnsigned: boolean },
): VerifiedManifest {
  const manifest = parseManifest(manifestBytes);
  const unsigned =
    signature === null ||
    signature === undefined ||
    (typeof signature === 'object' && (signature as { algorithm?: unknown }).algorithm === 'none');

  if (unsigned) {
    if (!options.allowUnsigned) throw new BundleError('the bundle is not signed', 'signature');

    return { manifest, manifestBytes: Buffer.from(manifestBytes), signature: null, keyId: null };
  }

  const check = verifyManifestSignature(manifestBytes, signature, options.trustedKeys);

  if (check.ok === false) throw new BundleError(check.reason, 'signature');

  return {
    manifest,
    manifestBytes: Buffer.from(manifestBytes),
    signature: signature as ReleaseSignature,
    keyId: check.keyId,
  };
}

export interface ReadBundleOptions {
  trustedKeys: readonly string[];
  allowUnsigned: boolean;
  /** Cap on the whole bundle (bytes). */
  maxBytes: number;
  /** Called once the manifest is verified, before any artifact is read (e.g. to refuse a known version early). */
  onManifest?: (verified: VerifiedManifest) => Promise<void> | void;
  /**
   * Consumes one artifact. The body is checked while it streams: it throws at its end when the size or SHA-256
   * doesn't match the manifest, so the consumer must only commit what it stored after the body completed.
   */
  onArtifact: (file: ArtifactFile, body: AsyncIterable<Buffer>) => Promise<void>;
}

/** Carries an error thrown by a caller's callback through the reader unchanged. */
class CallbackFailure {
  constructor(readonly error: unknown) {}
}

async function callback<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new CallbackFailure(error);
  }
}

async function* counted(source: AsyncIterable<Uint8Array | string>, maxBytes: number): AsyncGenerator<Buffer> {
  let total = 0;

  for await (const chunk of source) {
    const buffer =
      typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);

    total += buffer.length;

    if (total > maxBytes) throw new BundleError(`the bundle exceeds ${maxBytes} bytes`, 'size');

    yield buffer;
  }
}

/** Streams `body` while checking it against the artifact entry. */
export async function* verifiedBody(file: ArtifactFile, body: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  const hash = createHash('sha256');
  let size = 0;

  for await (const chunk of body) {
    size += chunk.length;

    if (size > file.size) throw new BundleError(`${file.path} is larger than the manifest says`, 'format');

    hash.update(chunk);
    yield chunk;
  }

  if (size !== file.size)
    throw new BundleError(`${file.path} has ${size} bytes, the manifest says ${file.size}`, 'format');

  if (hash.digest('hex') !== file.sha256) throw new BundleError(`${file.path} does not match its SHA-256`, 'format');
}

/**
 * Reads a bundle (tar): `manifest.json` first, then `manifest.sig`, then the artifacts. The manifest is verified
 * before any artifact is read, so a bundle with a bad signature is refused without touching storage. Every artifact
 * must be listed and is verified while it streams; every listed artifact must be present.
 */
export async function readBundle(
  source: AsyncIterable<Uint8Array | string>,
  options: ReadBundleOptions,
): Promise<VerifiedManifest> {
  let manifestBytes: Buffer | null = null;
  let signature: unknown = null;
  let verified: VerifiedManifest | null = null;
  const seen = new Set<string>();

  const verify = async (): Promise<VerifiedManifest> => {
    if (verified) return verified;

    if (!manifestBytes) throw new BundleError('the bundle does not start with manifest.json', 'format');

    verified = verifyManifest(manifestBytes, signature, options);

    const result = verified;

    await callback(() => options.onManifest?.(result));

    return verified;
  };

  try {
    for await (const entry of readTar(counted(source, options.maxBytes))) {
      if (entry.type === 'directory') {
        if (entry.name !== 'artifacts' && !entry.name.startsWith('artifacts/'))
          throw new BundleError(`unexpected directory ${entry.name}`, 'format');

        continue;
      }

      if (entry.name === MANIFEST_ENTRY) {
        if (manifestBytes) throw new BundleError('duplicate manifest.json', 'format');

        manifestBytes = await readAll(entry.body, MAX_MANIFEST_BYTES).catch((error: unknown) => {
          throw error instanceof BundleError ? error : new BundleError('manifest.json is too large', 'format');
        });
        continue;
      }

      if (entry.name === SIGNATURE_ENTRY) {
        if (!manifestBytes || verified || signature !== null)
          throw new BundleError('manifest.sig must directly follow manifest.json', 'format');

        try {
          signature = JSON.parse((await readAll(entry.body, MAX_SIGNATURE_BYTES)).toString('utf8'));
        } catch (error) {
          throw error instanceof BundleError ? error : new BundleError('manifest.sig is malformed', 'signature');
        }

        continue;
      }

      const { manifest } = await verify();
      const file = manifest.artifacts.find((a) => a.path === entry.name);

      if (!file) throw new BundleError(`unexpected file ${entry.name}`, 'format');

      if (seen.has(file.path)) throw new BundleError(`duplicate file ${entry.name}`, 'format');

      seen.add(file.path);
      await callback(() => options.onArtifact(file, verifiedBody(file, entry.body)));
    }
  } catch (error) {
    // Errors of the caller's callbacks (e.g. a conflict) pass unchanged; a body failing its check is a BundleError.
    if (error instanceof CallbackFailure) throw error.error;

    if (error instanceof BundleError) throw error;

    throw new BundleError(error instanceof Error ? error.message : String(error), 'format');
  }

  const result = await verify().catch((error: unknown) => {
    throw error instanceof CallbackFailure ? error.error : error;
  });
  const missing = result.manifest.artifacts.filter((a) => !seen.has(a.path)).map((a) => a.path);

  if (missing.length) throw new BundleError(`the bundle lacks ${missing.slice(0, 5).join(', ')}`, 'format');

  return result;
}
