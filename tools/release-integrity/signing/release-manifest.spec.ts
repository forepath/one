import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
