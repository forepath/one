import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APP_INDEX_MEDIA_TYPE,
  APP_PACKAGE_MEDIA_TYPE,
  buildPackageArchive,
  COSIGN_SIGNATURE_ANNOTATION,
  cosignSignatureTag,
  sha256Digest,
  signBlob,
  verifySignedContent,
} from '@forepath/loadweaver/shared/util-app-catalog';

import { asSigningKey, writeCatalog } from './__fixtures__/catalog-fixture';
import { buildCatalogIndex, loadCatalog } from './catalog';
import {
  cosignSignatureArtifact,
  INDEX_TAG,
  OciRegistryClient,
  ociVersionTag,
  packageArtifact,
  packageRepository,
  parseOciTarget,
  planOciPublish,
  pushOciPublish,
  simpleSigningPayload,
} from './oci';
import { readPackageDir } from './package-dir';

interface Registry {
  server: Server;
  base: string;
  blobs: Map<string, Buffer>;
  manifests: Map<string, Buffer>;
  requests: { method: string; path: string; auth?: string }[];
  tokenRequests: { scope: string | null; auth?: string }[];
}

/** A tiny OCI registry with the bearer token flow (401 → /token → retry). */
async function startRegistry(): Promise<Registry> {
  const blobs = new Map<string, Buffer>();
  const manifests = new Map<string, Buffer>();
  const requests: Registry['requests'] = [];
  const tokenRequests: Registry['tokenRequests'] = [];
  let uploads = 0;
  let base = '';
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const body = Buffer.concat(chunks);

      if (url.pathname === '/token') {
        tokenRequests.push({ scope: url.searchParams.get('scope'), auth: req.headers.authorization });

        return res.end(JSON.stringify({ token: 'tok-123' }));
      }

      requests.push({ method: req.method ?? '', path: url.pathname, auth: req.headers.authorization });

      if (req.headers.authorization !== 'Bearer tok-123') {
        res.statusCode = 401;
        res.setHeader('www-authenticate', `Bearer realm="${base}/token",service="test-registry"`);

        return res.end();
      }

      const m = /^\/v2\/(.+)\/(blobs|manifests)\/(.+)$/.exec(url.pathname);
      const upload = /^\/v2\/(.+)\/blobs\/uploads\/(\d*)$/.exec(url.pathname);

      if (upload && req.method === 'POST') {
        res.statusCode = 202;
        res.setHeader('location', `/v2/${upload[1]}/blobs/uploads/${++uploads}`);

        return res.end();
      }

      if (upload && req.method === 'PUT') {
        const digest = url.searchParams.get('digest') ?? '';

        if (sha256Digest(body) !== digest) {
          res.statusCode = 400;

          return res.end();
        }

        blobs.set(`${upload[1]}@${digest}`, body);
        res.statusCode = 201;

        return res.end();
      }

      if (m?.[2] === 'blobs') {
        res.statusCode = blobs.has(`${m[1]}@${m[3]}`) ? 200 : 404;

        return res.end();
      }

      if (m?.[2] === 'manifests' && req.method === 'PUT') {
        const config = JSON.parse(body.toString()) as { config: { digest: string }; layers: { digest: string }[] };

        for (const d of [config.config.digest, ...config.layers.map((l) => l.digest)]) {
          if (!blobs.has(`${m[1]}@${d}`)) {
            res.statusCode = 400;

            return res.end(`missing blob ${d}`);
          }
        }

        manifests.set(`${m[1]}:${m[3]}`, body);
        res.statusCode = 201;

        return res.end();
      }

      if (m?.[2] === 'manifests') {
        const manifest = manifests.get(`${m[1]}:${m[3]}`);

        if (!manifest) {
          res.statusCode = 404;

          return res.end();
        }

        res.setHeader('docker-content-digest', sha256Digest(manifest));

        return res.end(req.method === 'HEAD' ? undefined : manifest);
      }

      res.statusCode = 404;
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return { server, base, blobs, manifests, requests, tokenRequests };
}

describe('lw app: OCI publish', () => {
  let registry: Registry;
  let dir: string;

  beforeEach(async () => {
    registry = await startRegistry();
    dir = await mkdtemp(join(tmpdir(), 'lw-app-oci-'));
  });

  afterEach(async () => {
    await new Promise((resolve) => registry.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  it('parses oci:// targets (plain HTTP only for localhost)', () => {
    expect(parseOciTarget('oci://ghcr.io/forepath/loadweaver-apps')).toEqual({
      registry: 'ghcr.io',
      repository: 'forepath/loadweaver-apps',
      base: 'https://ghcr.io',
    });
    expect(parseOciTarget('oci://127.0.0.1:5000/a/b').base).toBe('http://127.0.0.1:5000');
    expect(() => parseOciTarget('ghcr.io/x')).toThrow('expected oci://');
    expect(() => parseOciTarget('oci://ghcr.io/Upper')).toThrow();
  });

  it('pushes packages, cosign signatures and the index with token auth; signatures verify', async () => {
    const fx = await writeCatalog(dir, { trust: 'official', publisherUsesCatalogKey: true });
    const catalog = await loadCatalog(dir);
    const catalogKey = asSigningKey(fx.catalogKey);
    const built = buildCatalogIndex(catalog, { catalogKey });
    const target = parseOciTarget(`oci://${registry.base.slice(7)}/acme/apps`);
    const plan = planOciPublish(catalog, built, { target, catalogKey });
    const lines: string[] = [];

    await pushOciPublish(new OciRegistryClient(target, { username: 'ci', password: 'secret-token' }), plan, {}, (l) =>
      lines.push(l),
    );

    expect(plan.steps.map((s) => `${s.repository}:${s.tag.endsWith('.sig') ? 'sig' : s.tag}`)).toEqual([
      'acme/apps/demo:1.0.0',
      'acme/apps/demo:sig',
      `acme/apps:${INDEX_TAG}`,
      'acme/apps:sig',
    ]);
    expect(registry.tokenRequests[0]).toEqual({
      scope: 'repository:acme/apps/demo:pull,push',
      auth: `Basic ${Buffer.from('ci:secret-token').toString('base64')}`,
    });
    expect(lines.join('\n')).not.toContain('secret-token');

    // What a cluster does: pull the artifact + its .sig and verify (cosign simple-signing).
    const manifest = registry.manifests.get('acme/apps/demo:1.0.0') as Buffer;
    const sigManifest = JSON.parse(
      (registry.manifests.get(`acme/apps/demo:${cosignSignatureTag(sha256Digest(manifest))}`) as Buffer).toString(),
    ) as { layers: { digest: string; annotations: Record<string, string> }[] };
    const payload = registry.blobs.get(`acme/apps/demo@${sigManifest.layers[0].digest}`) as Buffer;

    expect(
      verifySignedContent(
        built.packages[0].archive,
        {
          kind: 'oci',
          manifest,
          payload,
          signature: sigManifest.layers[0].annotations[COSIGN_SIGNATURE_ANNOTATION],
          dockerReference: `${target.registry}/acme/apps/demo`,
        },
        [fx.catalogKey.publicKeyPem],
        APP_PACKAGE_MEDIA_TYPE,
      ).ok,
    ).toBe(true);

    const indexManifest = registry.manifests.get(`acme/apps:${INDEX_TAG}`) as Buffer;
    const indexSig = JSON.parse(
      (registry.manifests.get(`acme/apps:${cosignSignatureTag(sha256Digest(indexManifest))}`) as Buffer).toString(),
    ) as { layers: { digest: string; annotations: Record<string, string> }[] };

    expect(
      verifySignedContent(
        Buffer.from(built.indexYaml),
        {
          kind: 'oci',
          manifest: indexManifest,
          payload: registry.blobs.get(`acme/apps@${indexSig.layers[0].digest}`) as Buffer,
          signature: indexSig.layers[0].annotations[COSIGN_SIGNATURE_ANNOTATION],
        },
        [fx.catalogKey.publicKeyPem],
        APP_INDEX_MEDIA_TYPE,
      ).ok,
    ).toBe(true);

    // A second publish leaves the unchanged version alone; a changed one is refused without --force.
    const again: string[] = [];

    await pushOciPublish(new OciRegistryClient(target), plan, {}, (l) => again.push(l));
    expect(again[0]).toContain('unchanged');

    registry.manifests.set(
      'acme/apps/demo:1.0.0',
      Buffer.from('{"schemaVersion":2,"config":{"digest":"x"},"layers":[]}'),
    );
    await expect(pushOciPublish(new OciRegistryClient(target), plan, {}, () => undefined)).rejects.toThrow(
      'versions are immutable',
    );
    await expect(pushOciPublish(new OciRegistryClient(target), plan, { force: true }, () => undefined)).resolves.toBe(
      undefined,
    );
  });

  it('writes `+` in a version as `_` in the OCI tag (as the control plane fetches it)', async () => {
    expect(ociVersionTag('1.2.3+build.4')).toBe('1.2.3_build.4');
    expect(ociVersionTag('1.0.0-rc.1')).toBe('1.0.0-rc.1');

    const fx = await writeCatalog(dir, {
      trust: 'official',
      publisherUsesCatalogKey: true,
      packages: [{ app: 'demo', version: '1.0.0+build.7' }],
    });
    const catalog = await loadCatalog(dir);
    const catalogKey = asSigningKey(fx.catalogKey);
    const built = buildCatalogIndex(catalog, { catalogKey });
    const target = parseOciTarget(`oci://${registry.base.slice(7)}/acme/apps`);
    const plan = planOciPublish(catalog, built, { target, catalogKey });

    expect(plan.steps[0]).toMatchObject({ repository: 'acme/apps/demo', tag: '1.0.0_build.7' });

    await pushOciPublish(new OciRegistryClient(target), plan, {}, () => undefined);

    expect(registry.manifests.has('acme/apps/demo:1.0.0_build.7')).toBe(true);
    expect([...registry.manifests.keys()].some((k) => k.includes('+'))).toBe(false);
  });

  it('uses a committed package.oci.sig for packages of other publishers, and checks it', async () => {
    const fx = await writeCatalog(dir);
    const pkgDir = join(dir, 'demo', '1.0.0');
    const archive = buildPackageArchive(await readPackageDir(pkgDir));

    await writeFile(join(pkgDir, 'package.sig'), signBlob(archive, fx.publisherKey.privateKeyPem));

    const catalog = await loadCatalog(dir);
    const catalogKey = asSigningKey(fx.catalogKey);
    const built = buildCatalogIndex(catalog, { catalogKey });
    const target = parseOciTarget('oci://ghcr.io/acme/community');

    expect(() => planOciPublish(catalog, built, { target, catalogKey })).toThrow('no OCI signature');

    const artifact = packageArtifact('demo', '1.0.0', archive);
    const payload = simpleSigningPayload(target, packageRepository(target, 'demo'), artifact.digest);
    const good = signBlob(payload, fx.publisherKey.privateKeyPem);
    const plan = planOciPublish(catalog, built, {
      target,
      catalogKey,
      committedSignatures: { 'demo/1.0.0': good },
    });

    expect(plan.steps).toHaveLength(4);

    const wrongRepo = signBlob(
      simpleSigningPayload(parseOciTarget('oci://ghcr.io/evil/apps'), 'evil/apps/demo', artifact.digest),
      fx.publisherKey.privateKeyPem,
    );

    expect(() =>
      planOciPublish(catalog, built, { target, catalogKey, committedSignatures: { 'demo/1.0.0': wrongRepo } }),
    ).toThrow('package.oci.sig');
  });

  it('builds cosign-compatible signature artifacts', () => {
    const payload = Buffer.from('{"critical":{}}');
    const artifact = cosignSignatureArtifact(payload, 'c2ln');
    const manifest = JSON.parse(artifact.manifest.toString()) as {
      config: { mediaType: string };
      layers: { mediaType: string; annotations: Record<string, string> }[];
    };

    expect(manifest.config.mediaType).toBe('application/vnd.oci.image.config.v1+json');
    expect(manifest.layers[0].mediaType).toBe('application/vnd.dev.cosign.simplesigning.v1+json');
    expect(manifest.layers[0].annotations[COSIGN_SIGNATURE_ANNOTATION]).toBe('c2ln');
    expect(artifact.blobs[1]).toBe(payload);
  });
});
