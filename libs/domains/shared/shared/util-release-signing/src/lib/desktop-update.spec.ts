import {
  channelAcceptsRelease,
  compareReleaseVersions,
  createDesktopUpdateFeed,
  desktopUpdateChannelsFor,
  desktopUpdateFileUrl,
  evaluateDesktopUpdate,
  parseDesktopUpdateFeed,
  releaseChannelOf,
  verifyDesktopUpdateDownload,
  type DesktopUpdateChannel,
  type DesktopUpdateEvaluation,
} from './desktop-update';
import { createProductReleaseManifest, productReleaseManifestBytes, type ReleaseFile } from './product-manifest';
import { generateReleaseKeyPair, signManifest } from './signature';

const COMMIT = 'c'.repeat(40);
const BASE = 'https://downloads.example.com';
const pair = generateReleaseKeyPair();
const other = generateReleaseKeyPair();

const macZip = (version: string): ReleaseFile => ({
  path: `desktop/app-darwin-arm64-${version}.zip`,
  sha256: 'd'.repeat(64),
  size: 1234,
});

function release(version: string, opts: { product?: string; channel?: DesktopUpdateChannel; key?: string } = {}) {
  const manifest = createProductReleaseManifest({
    product: opts.product ?? 'agenstra',
    version,
    channel: opts.channel,
    source: { repository: 'forepath/one', commit: COMMIT },
    images: [],
    files: [macZip(version), { path: `desktop/app_${version}_amd64.deb`, sha256: 'e'.repeat(64), size: 99 }],
  });
  const manifestBytes = productReleaseManifestBytes(manifest);

  return { manifestBytes, signature: signManifest(manifestBytes, opts.key ?? pair.privateKeyPem) };
}

function feed(version: string, channel: DesktopUpdateChannel = 'stable') {
  return createDesktopUpdateFeed({
    product: 'agenstra',
    channel,
    version,
    manifestUrl: `${BASE}/releases/${version}/agenstra-release-manifest-${version}.json`,
    signatureUrl: `${BASE}/releases/${version}/agenstra-release-manifest-${version}.json.sig`,
    filesBaseUrl: `${BASE}/releases/${version}/`,
  });
}

function evaluate(over: Partial<DesktopUpdateEvaluation> & { releaseVersion?: string } = {}) {
  const version = over.releaseVersion ?? '1.3.0';
  const signed = release(version);

  return evaluateDesktopUpdate({
    product: 'agenstra',
    channel: 'stable',
    currentVersion: '1.2.0',
    feed: feed(version),
    trustedKeysPem: [pair.publicKeyPem],
    selectFile: (files) => files.find((f) => /darwin-arm64-.*\.zip$/.test(f.path)),
    ...signed,
    ...over,
  });
}

describe('release version order', () => {
  it('follows semantic-version precedence', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.2.0',
      '1.10.0',
      '2.0.0',
    ];

    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareReleaseVersions(ordered[i], ordered[i + 1])).toBe(-1);
      expect(compareReleaseVersions(ordered[i + 1], ordered[i])).toBe(1);
    }

    expect(compareReleaseVersions('3.4.5', '3.4.5')).toBe(0);
    expect(() => compareReleaseVersions('v1.0.0', '1.0.0')).toThrow();
  });

  it('derives channels and what a channel accepts', () => {
    expect(releaseChannelOf('1.0.0')).toBe('stable');
    expect(releaseChannelOf('1.0.0-beta.1')).toBe('beta');
    expect(channelAcceptsRelease('stable', 'stable')).toBe(true);
    expect(channelAcceptsRelease('stable', 'beta')).toBe(false);
    expect(channelAcceptsRelease('beta', 'stable')).toBe(true);
    expect(channelAcceptsRelease('beta', 'beta')).toBe(true);
  });
});

describe('update feed', () => {
  it('accepts a matching feed and refuses foreign products, channels and origins', () => {
    const raw = JSON.parse(JSON.stringify(feed('1.3.0')));

    expect(parseDesktopUpdateFeed(raw, { product: 'agenstra', channel: 'stable', trustedOrigin: BASE }).ok).toBe(true);
    expect(parseDesktopUpdateFeed(raw, { product: 'loadweaver', channel: 'stable' })).toMatchObject({
      ok: false,
      code: 'product-mismatch',
    });
    expect(parseDesktopUpdateFeed(raw, { product: 'agenstra', channel: 'beta' })).toMatchObject({
      ok: false,
      code: 'channel-mismatch',
    });
    expect(
      parseDesktopUpdateFeed(
        { ...raw, filesBaseUrl: 'https://evil.example.org/x/' },
        { product: 'agenstra', channel: 'stable', trustedOrigin: BASE },
      ),
    ).toMatchObject({ ok: false, code: 'untrusted-origin' });
  });

  it('refuses plain http, credentials in URLs and malformed documents', () => {
    const raw = JSON.parse(JSON.stringify(feed('1.3.0')));
    const expected = { product: 'agenstra', channel: 'stable' as const };

    expect(parseDesktopUpdateFeed({ ...raw, manifestUrl: 'http://downloads.example.com/m.json' }, expected).ok).toBe(
      false,
    );
    expect(parseDesktopUpdateFeed({ ...raw, filesBaseUrl: 'https://u:p@downloads.example.com/' }, expected).ok).toBe(
      false,
    );
    expect(parseDesktopUpdateFeed({ ...raw, version: 'latest' }, expected)).toMatchObject({ code: 'malformed-feed' });
    expect(parseDesktopUpdateFeed('nope', expected)).toMatchObject({ code: 'malformed-feed' });
  });

  it('resolves file URLs below the files base', () => {
    const f = feed('1.3.0');

    expect(desktopUpdateFileUrl(f, macZip('1.3.0'))).toBe(`${BASE}/releases/1.3.0/desktop/app-darwin-arm64-1.3.0.zip`);
    expect(desktopUpdateFileUrl({ ...f, filesBaseUrl: `${BASE}/r` }, { ...macZip('1'), path: 'desktop/a b.zip' })).toBe(
      `${BASE}/r/desktop/a%20b.zip`,
    );
  });
});

describe('update decision', () => {
  it('offers a newer signed release with the platform file', () => {
    const decision = evaluate();

    expect(decision).toMatchObject({
      status: 'available',
      version: '1.3.0',
      channel: 'stable',
      file: macZip('1.3.0'),
      fileUrl: `${BASE}/releases/1.3.0/desktop/app-darwin-arm64-1.3.0.zip`,
    });
  });

  it('reports up to date for the installed version', () => {
    expect(evaluate({ currentVersion: '1.3.0' })).toEqual({ status: 'up-to-date', version: '1.3.0' });
  });

  it('never downgrades', () => {
    expect(evaluate({ currentVersion: '1.4.0' })).toMatchObject({ status: 'refused', code: 'downgrade' });
    // A beta install that switched to stable keeps its newer beta until stable passes it.
    expect(evaluate({ currentVersion: '1.3.0-beta.2', releaseVersion: '1.2.9' })).toMatchObject({
      status: 'refused',
      code: 'downgrade',
    });
  });

  it('refuses a manifest signed by an untrusted key, for another product or tampered with', () => {
    expect(evaluate({ ...release('1.3.0', { key: other.privateKeyPem }) })).toMatchObject({
      status: 'refused',
      code: 'manifest-invalid',
    });
    expect(evaluate({ ...release('1.3.0', { product: 'loadweaver' }) })).toMatchObject({
      status: 'refused',
      code: 'manifest-invalid',
    });

    const signed = release('1.3.0');
    const tampered = Buffer.from(
      Buffer.from(signed.manifestBytes).toString('utf8').replace('"size":1234', '"size":1235'),
    );
    const flipped = Buffer.from(signed.manifestBytes);

    flipped[flipped.length - 3] = flipped[flipped.length - 3] ^ 1;

    expect(evaluate({ manifestBytes: flipped, signature: signed.signature })).toMatchObject({
      status: 'refused',
      code: 'manifest-invalid',
    });
    expect(evaluate({ manifestBytes: tampered, signature: signed.signature })).toMatchObject({
      code: 'manifest-invalid',
    });
    expect(evaluate({ manifestBytes: signed.manifestBytes, signature: { nope: true } })).toMatchObject({
      code: 'manifest-invalid',
    });
    expect(Buffer.from(tampered).equals(Buffer.from(signed.manifestBytes))).toBe(false);
  });

  it('refuses a feed whose version differs from the signed manifest (replayed older manifest)', () => {
    expect(evaluate({ feed: feed('1.4.0') })).toMatchObject({ status: 'refused', code: 'version-mismatch' });
  });

  it('keeps stable installs off beta releases and honours the channel of the feed', () => {
    const beta = release('1.3.0-beta.1');

    expect(evaluate({ ...beta, feed: feed('1.3.0-beta.1', 'stable') })).toMatchObject({
      status: 'refused',
      code: 'channel-mismatch',
    });
    expect(evaluate({ feed: feed('1.3.0', 'beta') })).toMatchObject({ status: 'refused', code: 'channel-mismatch' });
    expect(
      evaluate({ ...beta, channel: 'beta', feed: feed('1.3.0-beta.1', 'beta'), releaseVersion: '1.3.0-beta.1' }),
    ).toMatchObject({ status: 'available', version: '1.3.0-beta.1', channel: 'beta' });
    // Beta installs also take stable releases.
    expect(evaluate({ channel: 'beta', feed: feed('1.3.0', 'beta') })).toMatchObject({ status: 'available' });
    // A manifest claiming stable for a prerelease version is refused.
    expect(
      evaluate({ ...release('1.3.0-beta.1', { channel: 'stable' }), feed: feed('1.3.0-beta.1', 'stable') }),
    ).toMatchObject({ status: 'refused', code: 'channel-mismatch' });
  });

  it('refuses a release without a file for this platform', () => {
    expect(evaluate({ selectFile: () => undefined })).toMatchObject({ status: 'refused', code: 'no-file' });
  });
});

describe('downloaded update', () => {
  it('must match the signed digest and size', () => {
    const file = macZip('1.3.0');

    expect(verifyDesktopUpdateDownload(file, { sha256: file.sha256, size: file.size })).toEqual({ ok: true });
    expect(verifyDesktopUpdateDownload(file, { sha256: 'f'.repeat(64), size: file.size }).ok).toBe(false);
    expect(verifyDesktopUpdateDownload(file, { sha256: file.sha256, size: 1 }).ok).toBe(false);
  });
});

describe('publishing channels', () => {
  it('publishes stable to stable and beta, prereleases to beta, and never moves a channel backwards', () => {
    expect(desktopUpdateChannelsFor('1.3.0', {})).toEqual(['stable', 'beta']);
    expect(desktopUpdateChannelsFor('1.3.0', { stable: '1.2.0', beta: '1.4.0-beta.1' })).toEqual(['stable']);
    expect(desktopUpdateChannelsFor('1.4.0-beta.2', { stable: '1.3.0', beta: '1.4.0-beta.1' })).toEqual(['beta']);
    expect(desktopUpdateChannelsFor('1.3.0', { stable: '1.3.0', beta: '1.3.0' })).toEqual([]);
  });
});
