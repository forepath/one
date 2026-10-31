import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RELEASE_SIGNING_KEYS } from '@forepath/shared/shared/util-release-keys';
import {
  createDesktopUpdateFeed,
  DESKTOP_UPDATE_CHANNELS,
  desktopUpdateChannelsFor,
  desktopUpdateFeedSchema,
  verifyProductReleaseManifest,
  type DesktopUpdateChannel,
  type DesktopUpdateFeed,
} from '@forepath/shared/shared/util-release-signing';

import { updateFeedUrl, type DesktopAppConfig } from '../apps';

export function manifestFileName(product: string, version: string): string {
  return `${product}-release-manifest-${version}.json`;
}

export type FetchLike = (url: string) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

/** The versions the app's feeds currently announce (absent feed: undefined). Anything but 200 / 404 fails. */
export async function currentFeedVersions(
  app: DesktopAppConfig,
  fetcher: FetchLike = (url) => fetch(url, { redirect: 'error', headers: { 'cache-control': 'no-cache' } }),
): Promise<Partial<Record<DesktopUpdateChannel, string>>> {
  const out: Partial<Record<DesktopUpdateChannel, string>> = {};

  for (const channel of DESKTOP_UPDATE_CHANNELS) {
    const url = updateFeedUrl(app, channel);
    const res = await fetcher(url);

    if (res.status === 404) continue;

    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);

    const feed = desktopUpdateFeedSchema.safeParse(JSON.parse(await res.text()));

    if (feed.success) out[channel] = feed.data.version;
  }

  return out;
}

/** The channels (feeds and package repositories) this release goes to; never moves a channel backwards. */
export async function releaseChannels(
  app: DesktopAppConfig,
  version: string,
  fetcher?: FetchLike,
): Promise<DesktopUpdateChannel[]> {
  return desktopUpdateChannelsFor(version, await currentFeedVersions(app, fetcher)).filter((c) =>
    app.channels.includes(c),
  );
}

export interface WriteFeedsInput {
  version: string;
  channels: readonly DesktopUpdateChannel[];
  manifestBytes: Uint8Array;
  signature: unknown;
  outDir: string;
  now?: Date;
  /** Defaults to the product's compiled-in keys. */
  trustedKeysPem?: readonly string[];
}

/**
 * Writes `<channel>.json` for each channel after verifying the signed release manifest exactly as the apps will
 * (signature with the compiled-in keys, product, version): a feed is never published for a manifest the apps would
 * refuse.
 */
export function writeUpdateFeeds(app: DesktopAppConfig, input: WriteFeedsInput): DesktopUpdateFeed[] {
  const check = verifyProductReleaseManifest(
    input.manifestBytes,
    input.signature,
    input.trustedKeysPem ?? RELEASE_SIGNING_KEYS[app.product],
    app.product,
  );

  if ('reason' in check) throw new Error(`release manifest refused: ${check.reason}`);

  if (check.manifest.version !== input.version)
    throw new Error(`release manifest is for ${check.manifest.version}, not ${input.version}`);

  const releaseBase = `${app.downloadsBaseUrl}/releases/${input.version}`;
  const name = manifestFileName(app.product, input.version);

  mkdirSync(input.outDir, { recursive: true });

  return input.channels.map((channel) => {
    const feed = createDesktopUpdateFeed({
      product: app.product,
      channel,
      version: input.version,
      manifestUrl: `${releaseBase}/${name}`,
      signatureUrl: `${releaseBase}/${name}.sig`,
      filesBaseUrl: `${releaseBase}/`,
      publishedAt: (input.now ?? new Date()).toISOString(),
    });

    writeFileSync(join(input.outDir, `${channel}.json`), `${JSON.stringify(feed, null, 2)}\n`);

    return feed;
  });
}
