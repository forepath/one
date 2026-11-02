import { z } from 'zod';

import type { FileDigest } from './file-digest';
import {
  productReleaseVersionSchema,
  productSlugSchema,
  verifyProductReleaseManifest,
  type ProductReleaseManifest,
  type ReleaseFile,
} from './product-manifest';

/**
 * In-app updates of the ForePath desktop apps (shared desktop release pipeline, `tools/desktop-release`).
 *
 * The update feed per product and channel is an unsigned pointer (`<channel>.json`): it names the latest version and
 * where its signed product release manifest lives. Trust comes only from the manifest: its signature (ECDSA, the
 * product's compiled-in keys), its product, its version (must equal the feed's), its channel (a stable install never
 * takes a beta release) and the SHA-256 + size of the platform file. A feed can therefore at most withhold an update;
 * it can never make an app install something unsigned, foreign or older. Nothing here knows a product, a platform
 * file naming scheme or a key: the app supplies them.
 */
export const DESKTOP_UPDATE_CHANNELS = ['stable', 'beta'] as const;
export type DesktopUpdateChannel = (typeof DESKTOP_UPDATE_CHANNELS)[number];
export const DESKTOP_UPDATE_FEED_SCHEMA_VERSION = 1;

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

const httpsUrlSchema = z.string().max(2048).refine(isHttpsUrl, 'must be an https URL without credentials');

export const desktopUpdateFeedSchema = z
  .object({
    schemaVersion: z.literal(DESKTOP_UPDATE_FEED_SCHEMA_VERSION),
    product: productSlugSchema,
    channel: z.enum(DESKTOP_UPDATE_CHANNELS),
    version: productReleaseVersionSchema,
    /** `<product>-release-manifest-<version>.json` and its `.sig`. */
    manifestUrl: httpsUrlSchema,
    signatureUrl: httpsUrlSchema,
    /** The manifest's file paths (`desktop/<file>`) resolve below this URL. */
    filesBaseUrl: httpsUrlSchema,
    publishedAt: z.string().max(40).optional(),
  })
  .loose();
export type DesktopUpdateFeed = z.infer<typeof desktopUpdateFeedSchema>;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion {
  if (!productReleaseVersionSchema.safeParse(version).success) throw new Error(`invalid release version: ${version}`);

  const [core, ...rest] = version.split('-');
  const [major, minor, patch] = core.split('.').map((n) => Number(n));

  return { core: [major, minor, patch], prerelease: rest.length ? rest.join('-').split('.') : [] };
}

/** Semantic-version precedence of two release versions (`1.2.0-beta.2` < `1.2.0-beta.10` < `1.2.0`): -1, 0 or 1. */
export function compareReleaseVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a);
  const y = parseVersion(b);

  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;

  if (x.prerelease.length === 0 || y.prerelease.length === 0) {
    if (x.prerelease.length === y.prerelease.length) return 0;

    return x.prerelease.length === 0 ? 1 : -1;
  }

  for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
    const p = x.prerelease[i];
    const q = y.prerelease[i];

    if (p === undefined) return -1;

    if (q === undefined) return 1;

    if (p === q) continue;

    const pNum = /^\d+$/.test(p);
    const qNum = /^\d+$/.test(q);

    if (pNum && qNum) return Number(p) < Number(q) ? -1 : 1;

    if (pNum !== qNum) return pNum ? -1 : 1;

    return p < q ? -1 : 1;
  }

  return 0;
}

/** The channel a version belongs to: prereleases are beta (same rule as the release manifest). */
export function releaseChannelOf(version: string): DesktopUpdateChannel {
  return parseVersion(version).prerelease.length ? 'beta' : 'stable';
}

/** Stable installs take stable releases only; beta installs take both. */
export function channelAcceptsRelease(selected: DesktopUpdateChannel, release: DesktopUpdateChannel): boolean {
  return selected === 'beta' || release === 'stable';
}

export type DesktopUpdateRefusal =
  | 'malformed-feed'
  | 'product-mismatch'
  | 'channel-mismatch'
  | 'untrusted-origin'
  | 'manifest-invalid'
  | 'version-mismatch'
  | 'downgrade'
  | 'no-file';

export type DesktopFeedCheck =
  | { ok: true; feed: DesktopUpdateFeed }
  | { ok: false; code: DesktopUpdateRefusal; reason: string };

export interface DesktopFeedExpectation {
  product: string;
  channel: DesktopUpdateChannel;
  /** When set, every URL of the feed must have this origin (`https://downloads.example.com`). */
  trustedOrigin?: string;
}

/** Validates a fetched feed document against what the app asked for (product, channel, origin). */
export function parseDesktopUpdateFeed(raw: unknown, expected: DesktopFeedExpectation): DesktopFeedCheck {
  const parsed = desktopUpdateFeedSchema.safeParse(raw);

  if (!parsed.success)
    return {
      ok: false,
      code: 'malformed-feed',
      reason: `the update feed is malformed: ${parsed.error.issues[0]?.message}`,
    };

  const feed = parsed.data;

  if (feed.product !== expected.product)
    return { ok: false, code: 'product-mismatch', reason: `the update feed is for ${feed.product}` };

  if (feed.channel !== expected.channel)
    return { ok: false, code: 'channel-mismatch', reason: `the update feed is for the ${feed.channel} channel` };

  if (expected.trustedOrigin) {
    const origin = new URL(expected.trustedOrigin).origin;

    if ([feed.manifestUrl, feed.signatureUrl, feed.filesBaseUrl].some((u) => new URL(u).origin !== origin))
      return { ok: false, code: 'untrusted-origin', reason: `the update feed points outside ${origin}` };
  }

  return { ok: true, feed };
}

/** Download URL of a manifest file below the feed's `filesBaseUrl`. */
export function desktopUpdateFileUrl(feed: DesktopUpdateFeed, file: ReleaseFile): string {
  const base = feed.filesBaseUrl.endsWith('/') ? feed.filesBaseUrl : `${feed.filesBaseUrl}/`;

  return base + file.path.split('/').map(encodeURIComponent).join('/');
}

export interface DesktopUpdateEvaluation {
  product: string;
  channel: DesktopUpdateChannel;
  currentVersion: string;
  feed: DesktopUpdateFeed;
  manifestBytes: Uint8Array;
  signature: unknown;
  trustedKeysPem: readonly string[];
  /** Picks this platform's file from the verified manifest (undefined: the release has none for this platform). */
  selectFile: (files: readonly ReleaseFile[]) => ReleaseFile | undefined;
}

export type DesktopUpdateDecision =
  | { status: 'up-to-date'; version: string }
  | {
      status: 'available';
      version: string;
      channel: DesktopUpdateChannel;
      file: ReleaseFile;
      fileUrl: string;
      manifest: ProductReleaseManifest;
      keyId: string;
    }
  | { status: 'refused'; code: DesktopUpdateRefusal; reason: string };

/**
 * Decides whether the release a feed points to may be installed: the manifest must verify (signature, canonical form,
 * product), name exactly the feed's version, belong to a channel the install accepts and be newer than the running
 * version; the returned file is what the download must match (`verifyDesktopUpdateDownload`).
 */
export function evaluateDesktopUpdate(input: DesktopUpdateEvaluation): DesktopUpdateDecision {
  const { feed } = input;

  if (feed.product !== input.product || feed.channel !== input.channel)
    return { status: 'refused', code: 'channel-mismatch', reason: 'the update feed does not match this install' };

  const check = verifyProductReleaseManifest(input.manifestBytes, input.signature, input.trustedKeysPem, input.product);

  if ('reason' in check) return { status: 'refused', code: 'manifest-invalid', reason: check.reason };

  const { manifest } = check;

  if (manifest.version !== feed.version)
    return {
      status: 'refused',
      code: 'version-mismatch',
      reason: `the feed announces ${feed.version} but the signed manifest is for ${manifest.version}`,
    };

  if (
    !channelAcceptsRelease(input.channel, manifest.channel) ||
    releaseChannelOf(manifest.version) !== manifest.channel
  )
    return {
      status: 'refused',
      code: 'channel-mismatch',
      reason: `release ${manifest.version} (${manifest.channel}) is not on the ${input.channel} channel`,
    };

  const order = compareReleaseVersions(manifest.version, input.currentVersion);

  if (order === 0) return { status: 'up-to-date', version: input.currentVersion };

  if (order < 0)
    return {
      status: 'refused',
      code: 'downgrade',
      reason: `release ${manifest.version} is older than the installed ${input.currentVersion}; downgrades are never applied`,
    };

  const file = input.selectFile(manifest.files);

  if (!file)
    return { status: 'refused', code: 'no-file', reason: `release ${manifest.version} has no file for this platform` };

  return {
    status: 'available',
    version: manifest.version,
    channel: manifest.channel,
    file,
    fileUrl: desktopUpdateFileUrl(feed, file),
    manifest,
    keyId: check.keyId,
  };
}

/** Whether a downloaded update matches the signed manifest entry (digest and size). */
export function verifyDesktopUpdateDownload(
  file: ReleaseFile,
  actual: FileDigest,
): { ok: true } | { ok: false; reason: string } {
  if (actual.size !== file.size)
    return { ok: false, reason: `${file.path}: ${actual.size} bytes downloaded, the manifest says ${file.size}` };

  if (actual.sha256 !== file.sha256) return { ok: false, reason: `${file.path}: SHA-256 does not match the manifest` };

  return { ok: true };
}

export interface DesktopUpdateFeedInput {
  product: string;
  channel: DesktopUpdateChannel;
  version: string;
  manifestUrl: string;
  signatureUrl: string;
  filesBaseUrl: string;
  publishedAt?: string;
}

/** A validated feed document (release pipeline). */
export function createDesktopUpdateFeed(input: DesktopUpdateFeedInput): DesktopUpdateFeed {
  return desktopUpdateFeedSchema.parse({ schemaVersion: DESKTOP_UPDATE_FEED_SCHEMA_VERSION, ...input });
}

/**
 * The feeds (and package-repository channels) a release is published to: a stable release goes to stable and beta, a
 * prerelease to beta only, and no channel ever moves backwards (a channel already at the same or a newer version is
 * left alone).
 */
export function desktopUpdateChannelsFor(
  version: string,
  current: Partial<Record<DesktopUpdateChannel, string | undefined>>,
): DesktopUpdateChannel[] {
  const targets: DesktopUpdateChannel[] = releaseChannelOf(version) === 'stable' ? ['stable', 'beta'] : ['beta'];

  return targets.filter((channel) => {
    const now = current[channel];

    return !now || compareReleaseVersions(version, now) > 0;
  });
}
