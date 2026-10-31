import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BundleError,
  buildManifest,
  canonicalJson,
  RELEASE_DEV_KEYS_ENV,
  trustedReleaseKeys,
  verifyManifest,
} from '@forepath/loadweaver/shared/util-release';
import { RELEASE_SIGNING_KEYS } from '@forepath/shared/shared/util-release-keys';
import {
  createProductReleaseManifest,
  generateReleaseKeyPair,
  productReleaseManifestBytes,
  signManifest,
  verifyProductReleaseManifest,
} from '@forepath/shared/shared/util-release-signing';

import {
  assertTrustedSigningKey,
  collectReleaseFiles,
  discoverReleaseImages,
  parseImageArgument,
  pinReleaseImages,
} from './release-manifest';

const DIGEST = `sha256:${'d'.repeat(64)}`;

describe('release keys', () => {
  it('signs Loadweaver releases with exactly the keys its control plane, agent and CLI trust', () => {
    expect(trustedReleaseKeys({ NODE_ENV: 'production', [RELEASE_DEV_KEYS_ENV]: '' })).toEqual([
      ...RELEASE_SIGNING_KEYS.loadweaver,
    ]);
  });

  it('refuses a signing key the product does not trust', () => {
    const pair = generateReleaseKeyPair();

    expect(() => assertTrustedSigningKey(pair.keyId, [], 'agenstra')).toThrow(/add its public key first/);
    expect(() => assertTrustedSigningKey(pair.keyId, [pair.publicKeyPem], 'agenstra')).not.toThrow();
  });
});

describe('release images', () => {
  let apps: string;

  beforeEach(() => {
    apps = mkdtempSync(join(tmpdir(), 'release-apps-'));
    mkdirSync(join(apps, 'demo', 'api'), { recursive: true });
    mkdirSync(join(apps, 'demo', 'console'), { recursive: true });
    mkdirSync(join(apps, 'demo', 'lib-without-project'), { recursive: true });
    writeFileSync(
      join(apps, 'demo', 'api', 'project.json'),
      JSON.stringify({
        targets: {
          'api-container-image': {
            configurations: {
              test: { tags: ['ghcr.io/forepath/demo-api:latest'] },
              release: { tags: ['ghcr.io/forepath/demo-api:latest', 'ghcr.io/forepath/demo-api:$VERSION'] },
            },
          },
          build: {},
        },
      }),
    );
    writeFileSync(
      join(apps, 'demo', 'console', 'project.json'),
      JSON.stringify({
        targets: {
          'server-container-image': {
            configurations: { release: { tags: ['ghcr.io/forepath/other-console:$VERSION'] } },
          },
        },
      }),
    );
  });

  afterEach(() => rmSync(apps, { recursive: true, force: true }));

  it('discovers the versioned release tags of a product and pins them by digest', () => {
    const found = discoverReleaseImages(apps, 'demo');

    expect(found).toEqual([
      { name: 'api', repository: 'ghcr.io/forepath/demo-api' },
      { name: 'other-console', repository: 'ghcr.io/forepath/other-console' },
    ]);
    expect(discoverReleaseImages(apps, 'missing')).toEqual([]);

    const resolve = jest.fn().mockReturnValue(DIGEST);

    expect(pinReleaseImages(found, '3.5.0', resolve)[0]).toEqual({
      name: 'api',
      repository: 'ghcr.io/forepath/demo-api',
      tag: '3.5.0',
      digest: DIGEST,
    });
    expect(resolve).toHaveBeenCalledWith('ghcr.io/forepath/demo-api:3.5.0');
  });

  it('finds the images of the repository products', () => {
    const names = discoverReleaseImages(join(__dirname, '..', '..', '..', 'apps'), 'decabill').map((i) => i.name);

    expect(names).toEqual(expect.arrayContaining(['billing-api', 'billing-console-server']));
  });

  it('finds the Loadweaver release images', () => {
    const names = discoverReleaseImages(join(__dirname, '..', '..', '..', 'apps'), 'loadweaver').map((i) => i.name);

    expect(names).toEqual(expect.arrayContaining(['control-plane-api', 'console-server']));
  });

  it('parses explicit image arguments', () => {
    expect(parseImageArgument(`api=ghcr.io/forepath/demo-api:3.5.0@${DIGEST}`)).toEqual({
      name: 'api',
      repository: 'ghcr.io/forepath/demo-api',
      tag: '3.5.0',
      digest: DIGEST,
    });
    expect(parseImageArgument(`api=localhost:5000/demo@${DIGEST}`)).toEqual({
      name: 'api',
      repository: 'localhost:5000/demo',
      digest: DIGEST,
    });
    expect(() => parseImageArgument('api=ghcr.io/forepath/demo-api:latest')).toThrow();
  });
});

describe('release files', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-files-'));
    mkdirSync(join(dir, 'linux'));
    writeFileSync(join(dir, 'linux', 'app.deb'), 'abc');
    writeFileSync(join(dir, 'Agenstra Setup.exe'), 'xyz');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists files under their published prefix and signs a manifest operators can verify', async () => {
    const files = await collectReleaseFiles('desktop', dir);

    expect(files.map((f) => f.path)).toEqual(['desktop/Agenstra Setup.exe', 'desktop/linux/app.deb']);

    const pair = generateReleaseKeyPair();
    const bytes = productReleaseManifestBytes(
      createProductReleaseManifest({
        product: 'agenstra',
        version: '3.5.0',
        source: { repository: 'forepath/one', commit: 'e'.repeat(40) },
        images: [parseImageArgument(`api=ghcr.io/forepath/agenstra-controller-api:3.5.0@${DIGEST}`)],
        files,
      }),
    );
    const check = verifyProductReleaseManifest(
      bytes,
      signManifest(bytes, pair.privateKeyPem),
      [pair.publicKeyPem],
      'agenstra',
    );

    expect(check.ok && check.manifest.files).toHaveLength(2);
  });
});

describe('Loadweaver documents under one key', () => {
  const pair = generateReleaseKeyPair();
  const agent = Buffer.from('agent');

  it('never accepts a release bundle manifest as a product manifest, or the other way round', () => {
    const bundleBytes = Buffer.from(
      canonicalJson(
        buildManifest({
          version: '3.5.0',
          channel: 'stable',
          created: '2026-10-19T00:00:00.000Z',
          images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@${DIGEST}` },
          agentBinaries: {
            amd64: {
              path: 'artifacts/bin/loadweaver-agent-linux-amd64',
              sha256: createHash('sha256').update(agent).digest('hex'),
              size: agent.length,
            },
          },
        }),
      ),
    );
    const productBytes = productReleaseManifestBytes(
      createProductReleaseManifest({
        product: 'loadweaver',
        version: '3.5.0',
        source: { repository: 'forepath/one', commit: 'e'.repeat(40) },
        images: [parseImageArgument(`control-plane-api=ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@${DIGEST}`)],
        files: [],
      }),
    );
    const trustedKeys = [pair.publicKeyPem];

    // Each signature is valid for its own kind of document only.
    expect(
      verifyManifest(bundleBytes, signManifest(bundleBytes, pair.privateKeyPem), { trustedKeys, allowUnsigned: false })
        .keyId,
    ).toBe(pair.keyId);
    expect(
      verifyProductReleaseManifest(
        productBytes,
        signManifest(productBytes, pair.privateKeyPem),
        trustedKeys,
        'loadweaver',
      ).ok,
    ).toBe(true);

    expect(
      verifyProductReleaseManifest(
        bundleBytes,
        signManifest(bundleBytes, pair.privateKeyPem),
        trustedKeys,
        'loadweaver',
      ).ok,
    ).toBe(false);
    expect(() =>
      verifyManifest(productBytes, signManifest(productBytes, pair.privateKeyPem), {
        trustedKeys,
        allowUnsigned: false,
      }),
    ).toThrow(BundleError);
  });
});
