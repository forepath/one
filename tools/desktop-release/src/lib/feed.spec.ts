import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createProductReleaseManifest,
  generateReleaseKeyPair,
  parseDesktopUpdateFeed,
  productReleaseManifestBytes,
  signManifest,
} from '@forepath/shared/shared/util-release-signing';

import { DESKTOP_APPS } from '../apps';

import { currentFeedVersions, releaseChannels, writeUpdateFeeds, type FetchLike } from './feed';

const app = DESKTOP_APPS['agenstra'];
const pair = generateReleaseKeyPair();

function signed(version: string, product = 'agenstra', key = pair.privateKeyPem) {
  const manifest = createProductReleaseManifest({
    product,
    version,
    source: { repository: 'forepath/one', commit: 'a'.repeat(40) },
    images: [],
    files: [{ path: `desktop/agenstra_${version}_amd64.deb`, sha256: 'b'.repeat(64), size: 1 }],
  });
  const manifestBytes = productReleaseManifestBytes(manifest);

  return { manifestBytes, signature: signManifest(manifestBytes, key) };
}

const feedsAt =
  (versions: Record<string, string | number>): FetchLike =>
  async (url) => {
    const channel = /\/(stable|beta)\.json$/.exec(url)?.[1] ?? '';
    const v = versions[channel];

    if (typeof v === 'number') return { status: v, ok: false, text: async () => '' };

    if (!v) return { status: 404, ok: false, text: async () => '' };

    return {
      status: 200,
      ok: true,
      text: async () =>
        JSON.stringify({
          schemaVersion: 1,
          product: 'agenstra',
          channel,
          version: v,
          manifestUrl: 'https://downloads.agenstra.com/m.json',
          signatureUrl: 'https://downloads.agenstra.com/m.json.sig',
          filesBaseUrl: 'https://downloads.agenstra.com/releases/x/',
        }),
    };
  };

describe('update feeds', () => {
  let out: string;

  beforeEach(() => (out = mkdtempSync(join(tmpdir(), 'desktop-feed-spec-'))));
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  it('writes feeds the app accepts for a verified manifest', () => {
    const feeds = writeUpdateFeeds(app, {
      version: '1.2.3',
      channels: ['stable', 'beta'],
      outDir: out,
      trustedKeysPem: [pair.publicKeyPem],
      now: new Date('2026-10-20T00:00:00Z'),
      ...signed('1.2.3'),
    });

    expect(feeds.map((f) => f.channel)).toEqual(['stable', 'beta']);

    const stable = JSON.parse(readFileSync(join(out, 'stable.json'), 'utf8'));

    expect(stable).toMatchObject({
      version: '1.2.3',
      manifestUrl: 'https://downloads.agenstra.com/releases/1.2.3/agenstra-release-manifest-1.2.3.json',
      signatureUrl: 'https://downloads.agenstra.com/releases/1.2.3/agenstra-release-manifest-1.2.3.json.sig',
      filesBaseUrl: 'https://downloads.agenstra.com/releases/1.2.3/',
    });
    expect(
      parseDesktopUpdateFeed(stable, { product: 'agenstra', channel: 'stable', trustedOrigin: app.downloadsBaseUrl })
        .ok,
    ).toBe(true);
  });

  it('refuses manifests the app would refuse', () => {
    const other = generateReleaseKeyPair();
    const base = { channels: ['stable' as const], outDir: out, trustedKeysPem: [pair.publicKeyPem] };

    expect(() =>
      writeUpdateFeeds(app, { ...base, version: '1.2.3', ...signed('1.2.3', 'agenstra', other.privateKeyPem) }),
    ).toThrow(/refused/);
    expect(() => writeUpdateFeeds(app, { ...base, version: '1.2.3', ...signed('1.2.3', 'decabill') })).toThrow(
      /refused/,
    );
    expect(() => writeUpdateFeeds(app, { ...base, version: '1.2.4', ...signed('1.2.3') })).toThrow(/not 1.2.4/);
  });

  it('checks the production key set by default (no key in this test → refused)', () => {
    expect(() =>
      writeUpdateFeeds(app, { version: '1.2.3', channels: ['stable'], outDir: out, ...signed('1.2.3') }),
    ).toThrow(/refused/);
  });
});

describe('release channels', () => {
  it('reads the current feeds and never moves a channel backwards', async () => {
    expect(await currentFeedVersions(app, feedsAt({ stable: '1.2.0' }))).toEqual({ stable: '1.2.0' });
    expect(await releaseChannels(app, '1.3.0', feedsAt({}))).toEqual(['stable', 'beta']);
    expect(await releaseChannels(app, '1.3.0', feedsAt({ stable: '1.2.0', beta: '1.4.0-beta.1' }))).toEqual(['stable']);
    expect(await releaseChannels(app, '1.4.0-beta.2', feedsAt({ stable: '1.3.0', beta: '1.4.0-beta.1' }))).toEqual([
      'beta',
    ]);
  });

  it('fails instead of guessing when a feed cannot be read', async () => {
    await expect(releaseChannels(app, '1.3.0', feedsAt({ beta: 500 }))).rejects.toThrow(/HTTP 500/);
  });
});
