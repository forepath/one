import { createHash, hkdfSync, timingSafeEqual } from 'node:crypto';

import {
  combineShares,
  decodeShare,
  encodeShare,
  secretId,
  type Share,
} from '@forepath/loadweaver/shared/util-secrets';

/**
 * Backup key hierarchy (3.20), pure parts: everything below a generation's root key is derived (HKDF-SHA256),
 * so the recovery kit (the root, Shamir-split) or the KMS escrow is enough to rebuild the data key, every
 * repository password and the DR envelope key.
 */

export const DEFAULT_KIT_SHARES = 3;
export const DEFAULT_KIT_THRESHOLD = 2;
export const KIT_FORMAT = 'loadweaver-backup-recovery-share';

function derive(root: Buffer, info: string, bytes = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), Buffer.from(info, 'utf8'), bytes));
}

/** 32-byte data key of a generation (DR envelope, sealed catalog material). */
export function backupDataKey(root: Buffer, generation: number): Buffer {
  return derive(root, `loadweaver/backup/data/${generation}`);
}

/** Key sealing kit shares that wait for their one download. */
export function backupKitKey(root: Buffer, generation: number): Buffer {
  return derive(root, `loadweaver/backup/kit/${generation}`);
}

/**
 * Password of the Kopia repository of a trust boundary (`cluster`, `project:<name>`); Kopia derives its own
 * format / encryption keys from it. Printable, 43 characters.
 */
export function repositoryPassword(dataKey: Buffer, scope: string): string {
  return derive(dataKey, `loadweaver/backup/repository/${scope}`).toString('base64url');
}

/** Kopia server user password of a node (APPEND / READ) or the control plane (FULL) for one repository. */
export function repositoryUserPassword(dataKey: Buffer, scope: string, user: string): string {
  return derive(dataKey, `loadweaver/backup/repository/${scope}/user/${user}`).toString('base64url');
}

export function validateKitSize(shares: number, threshold: number): void {
  if (!Number.isInteger(shares) || !Number.isInteger(threshold) || threshold < 2 || shares < threshold || shares > 16)
    throw new RangeError('the recovery kit needs 2 <= threshold <= shares <= 16');
}

export interface KitShareDocument {
  format: typeof KIT_FORMAT;
  version: 1;
  cluster: string;
  generation: number;
  rootId: string;
  index: number;
  shares: number;
  threshold: number;
  share: string;
  createdAt: string;
  /** First 16 hex of SHA-256 over the other fields in this order (typos are caught before combining). */
  checksum: string;
}

function checksumOf(doc: Omit<KitShareDocument, 'checksum'>): string {
  return createHash('sha256')
    .update(
      [
        doc.format,
        doc.version,
        doc.cluster,
        doc.generation,
        doc.rootId,
        doc.index,
        doc.shares,
        doc.threshold,
        doc.share,
        doc.createdAt,
      ].join('\n'),
    )
    .digest('hex')
    .slice(0, 16);
}

export function kitShareDocument(input: {
  cluster: string;
  generation: number;
  shares: number;
  share: Share;
  createdAt: Date;
}): KitShareDocument {
  const doc: Omit<KitShareDocument, 'checksum'> = {
    format: KIT_FORMAT,
    version: 1,
    cluster: input.cluster,
    generation: input.generation,
    rootId: input.share.secretId,
    index: input.share.index,
    shares: input.shares,
    threshold: input.share.threshold,
    share: encodeShare(input.share),
    createdAt: input.createdAt.toISOString(),
  };

  return { ...doc, checksum: checksumOf(doc) };
}

/** Printable text form: a short instruction block plus the JSON document (no PDF needed). */
export function kitShareText(doc: KitShareDocument): string {
  return [
    `Loadweaver backup recovery kit — share ${doc.index} of ${doc.shares} (any ${doc.threshold} recover the backups)`,
    `Cluster: ${doc.cluster}   Key generation: ${doc.generation}   Root id: ${doc.rootId}`,
    'Keep this share offline and separate from the other shares. It is shown only once.',
    '',
    JSON.stringify(doc, null, 2),
    '',
  ].join('\n');
}

/**
 * Parses a share as entered back: the JSON document (checksum verified), the text kit around it, or the bare
 * `lws1.` share string.
 */
export function parseKitShare(input: string): { share: Share; generation: number | null } {
  const text = input.trim();
  const start = text.indexOf('{');

  if (start >= 0) {
    let doc: KitShareDocument;

    try {
      doc = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)) as KitShareDocument;
    } catch {
      throw new Error('the share is not valid JSON');
    }

    if (doc.format !== KIT_FORMAT || doc.version !== 1) throw new Error('not a Loadweaver recovery-kit share');

    const { checksum, ...rest } = doc;
    const expected = checksumOf(rest);

    if (
      typeof checksum !== 'string' ||
      checksum.length !== expected.length ||
      !timingSafeEqual(Buffer.from(checksum), Buffer.from(expected))
    )
      throw new Error(`share ${doc.index ?? '?'} has a wrong checksum (typo?)`);

    const share = decodeShare(doc.share);

    if (share.index !== doc.index || share.secretId !== doc.rootId) throw new Error('share fields do not match');

    return { share, generation: doc.generation };
  }

  return { share: decodeShare(text), generation: null };
}

/**
 * Recombines kit shares into the root key; verifies against the expected root id (wrong / mixed / too few
 * shares fail, they never yield a wrong key silently).
 */
export function combineKit(inputs: string[], expectedRootId?: string): Buffer {
  const parsed = inputs.map((i) => parseKitShare(i).share);

  if (parsed.length === 0) throw new Error('no shares given');

  const ids = new Set(parsed.map((s) => s.secretId));

  if (ids.size !== 1) throw new Error('the shares belong to different recovery kits');

  if (expectedRootId && parsed[0].secretId !== expectedRootId)
    throw new Error('the shares belong to another key generation');

  if (new Set(parsed.map((s) => s.index)).size !== parsed.length) throw new Error('a share was entered twice');

  if (parsed.length < parsed[0].threshold) throw new Error(`${parsed[0].threshold} shares are needed`);

  const root = combineShares(parsed);

  if (secretId(root) !== parsed[0].secretId) throw new Error('shares do not reconstruct the key');

  return root;
}

export function backupKeyAad(generation: number): string {
  return `backup-key/${generation}`;
}

export function kitShareAad(generation: number, index: number): string {
  return `backup-kit/${generation}/${index}`;
}
