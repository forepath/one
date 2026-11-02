import {
  APP_INDEX_MEDIA_TYPE,
  APP_PACKAGE_MEDIA_TYPE,
  buildOciArtifactManifest,
  buildSimpleSigningPayload,
  COSIGN_SIGNATURE_ANNOTATION,
  cosignSignatureTag,
  sha256Digest,
  signBlob,
  SIMPLE_SIGNING_MEDIA_TYPE,
  verifyIndex,
  verifyPackage,
  type CatalogSource,
} from '@forepath/loadweaver/shared/util-app-catalog';

import { blobSignature, testCatalog } from './app-store.testing';
import { fleetCatalogAllowsHttp, fleetCatalogTlsRejectUnauthorized } from './app-store-config';
import {
  FleetCatalogClient,
  GitCatalogClient,
  OciCatalogClient,
  parseBearerChallenge,
  parseOciUrl,
  splitGitCatalogUrl,
  type OciEndpoint,
} from './catalog-clients';
import { CatalogHttp } from './catalog-http';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });

    return await handler(url, init);
  });

  return { fetchImpl, calls };
}

const ok = (body: Buffer | string, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200, headers });

const oci = (url: string): CatalogSource => ({ name: 'acme', type: 'oci', url, publicKeys: ['k'], enabled: true });

/** A registry serving one signed artifact per `repo:tag`, behind an anonymous token dance. */
function registry(artifacts: Record<string, { layer: Buffer; mediaType: string }>, signer: string, host = 'ghcr.io') {
  const blobs = new Map<string, Buffer>();
  const manifests = new Map<string, Buffer>();

  for (const [ref, artifact] of Object.entries(artifacts)) {
    const [repo, tag] = ref.split(':');
    const { manifest, digest } = buildOciArtifactManifest({
      layer: artifact.layer,
      layerMediaType: artifact.mediaType,
    });
    const payload = buildSimpleSigningPayload({ dockerReference: `${host}/${repo}`, manifestDigest: digest });
    const sigManifest = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        layers: [
          {
            mediaType: SIMPLE_SIGNING_MEDIA_TYPE,
            digest: sha256Digest(payload),
            size: payload.length,
            annotations: { [COSIGN_SIGNATURE_ANNOTATION]: signBlob(payload, signer) },
          },
        ],
      }),
    );

    blobs.set(`${repo}@${sha256Digest(artifact.layer)}`, artifact.layer);
    blobs.set(`${repo}@${sha256Digest(payload)}`, payload);
    manifests.set(`${repo}:${tag}`, manifest);
    manifests.set(`${repo}:${cosignSignatureTag(digest)}`, sigManifest);
  }

  return { blobs, manifests };
}

describe('CatalogHttp (P1)', () => {
  it('refuses http and credentials, checks every hop and drops credentials on cross-origin redirects', async () => {
    const validated: string[] = [];
    const { fetchImpl, calls } = fakeFetch((url) =>
      url.startsWith('https://reg.example.com')
        ? new Response(null, { status: 307, headers: { location: 'https://cdn.example.net/blob' } })
        : ok('data'),
    );
    const http = new CatalogHttp(fetchImpl, async (url) => validated.push(url));

    await expect(http.get('http://reg.example.com/x', { maxBytes: 10 })).rejects.toThrow('must use https');
    await expect(http.get('https://u:p@reg.example.com/x', { maxBytes: 10 })).rejects.toThrow('credentials');

    const response = await http.get('https://reg.example.com/x', {
      maxBytes: 10,
      headers: { authorization: 'Bearer t' },
    });

    expect(response.body.toString()).toBe('data');
    expect(validated).toEqual(['https://reg.example.com/x', 'https://cdn.example.net/blob']);
    expect(calls[0].headers['authorization']).toBe('Bearer t');
    expect(calls[1].headers['authorization']).toBeUndefined();
  });

  it('enforces the size cap and the redirect limit; internal endpoints skip the address check', async () => {
    const validate = jest.fn(async () => undefined);
    const big = new CatalogHttp(fakeFetch(() => ok('x'.repeat(20))).fetchImpl, validate);

    await expect(big.get('https://a.example.com/', { maxBytes: 10 })).rejects.toThrow('larger than 10 bytes');

    const loop = new CatalogHttp(
      fakeFetch(() => new Response(null, { status: 302, headers: { location: '/again' } })).fetchImpl,
      validate,
    );

    await expect(loop.get('https://a.example.com/', { maxBytes: 10 })).rejects.toThrow('too many redirects');

    validate.mockClear();

    const internal = new CatalogHttp(fakeFetch(() => ok('y')).fetchImpl, validate);

    await expect(internal.get('http://[fd00::1]:5000/v2/', { maxBytes: 10, internal: true })).resolves.toMatchObject({
      status: 200,
    });
    expect(validate).not.toHaveBeenCalled();
  });
});

describe('OciCatalogClient (P1)', () => {
  const catalog = testCatalog(['1.2.0']);
  const served = registry(
    {
      'forepath/apps:index': { layer: catalog.indexBytes(), mediaType: APP_INDEX_MEDIA_TYPE },
      'forepath/apps/wiki:1.2.0': { layer: catalog.packages.get('1.2.0') as Buffer, mediaType: APP_PACKAGE_MEDIA_TYPE },
    },
    catalog.catalogKey.privateKeyPem,
  );

  function serve(tamper?: (url: string, body: Buffer) => Buffer) {
    return fakeFetch((url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;

      if (url.startsWith('https://ghcr.io/token')) return ok(JSON.stringify({ token: 'anon' }));

      if (headers['authorization'] !== 'Bearer anon')
        return new Response(null, {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:x:pull"',
          },
        });

      const match = /^https:\/\/ghcr\.io\/v2\/(.+)\/(manifests|blobs)\/(.+)$/.exec(url);

      if (!match) return new Response(null, { status: 404 });

      const [, repo, what, ref] = match;
      const body = what === 'manifests' ? served.manifests.get(`${repo}:${ref}`) : served.blobs.get(`${repo}@${ref}`);

      return body ? ok(tamper ? tamper(url, body) : body) : new Response(null, { status: 404 });
    });
  }

  const upstream = async (host: string): Promise<OciEndpoint[]> => [
    { base: `https://${host}`, internal: false, label: host },
  ];

  it('pulls the index and a package with the token dance; both verify with the right keys', async () => {
    const { fetchImpl } = serve();
    const client = new OciCatalogClient(new CatalogHttp(fetchImpl, async () => undefined), upstream);
    const index = await client.fetchIndex(oci('oci://ghcr.io/forepath/apps'));
    const verified = verifyIndex(index.bytes, index.signature, [catalog.catalogKey.publicKeyPem]);

    expect(verified.ok).toBe(true);
    expect(index.signature).toMatchObject({ kind: 'oci', dockerReference: 'ghcr.io/forepath/apps' });

    const pkg = await client.fetchPackage(oci('oci://ghcr.io/forepath/apps'), 'wiki', '1.2.0');

    if (verified.ok === false) throw new Error('index');

    // The package was signed with the catalog key here, not the publisher key: verifyPackage must refuse it.
    expect(
      verifyPackage({
        index: verified.value.index,
        app: 'wiki',
        version: '1.2.0',
        archive: pkg.bytes,
        signature: pkg.signature,
      }).ok,
    ).toBe(false);
  });

  it('refuses a tampered blob (digest) and a missing signature', async () => {
    const tampered = serve((url, body) => (url.includes('/blobs/') ? Buffer.concat([body, Buffer.from('x')]) : body));
    const client = new OciCatalogClient(new CatalogHttp(tampered.fetchImpl, async () => undefined), upstream);

    await expect(client.fetchIndex(oci('oci://ghcr.io/forepath/apps'))).rejects.toThrow('does not match its digest');

    const unsigned = fakeFetch((url) => {
      const match = /\/v2\/(.+)\/(manifests|blobs)\/(.+)$/.exec(url);

      if (match?.[3].endsWith('.sig')) return new Response(null, { status: 404 });

      const body =
        match?.[2] === 'manifests'
          ? served.manifests.get(`${match[1]}:${match[3]}`)
          : served.blobs.get(`${match?.[1]}@${match?.[3]}`);

      return body ? ok(body) : new Response(null, { status: 404 });
    });
    const plain = new OciCatalogClient(new CatalogHttp(unsigned.fetchImpl, async () => undefined), upstream);

    await expect(plain.fetchIndex(oci('oci://ghcr.io/forepath/apps'))).rejects.toThrow('is not signed');
  });

  it('tries the endpoints in order (mirror first, upstream as fallback)', async () => {
    const { fetchImpl, calls } = serve();
    const client = new OciCatalogClient(new CatalogHttp(fetchImpl, async () => undefined), async (host) => [
      { base: 'http://[fd00::1]:5001', internal: true, label: 'mirror' },
      { base: `https://${host}`, internal: false, label: host },
    ]);

    await expect(client.fetchIndex(oci('oci://ghcr.io/forepath/apps'))).resolves.toBeTruthy();
    expect(calls[0].url).toBe('http://[fd00::1]:5001/v2/forepath/apps/manifests/index');
  });

  it('parses URLs and challenges', () => {
    expect(parseOciUrl('oci://registry.lw/shop/apps')).toEqual({ host: 'registry.lw', repository: 'shop/apps' });
    expect(() => parseOciUrl('https://ghcr.io/x')).toThrow();
    expect(parseBearerChallenge('Bearer realm="https://a/token",service="a"')).toEqual({
      realm: 'https://a/token',
      service: 'a',
    });
    expect(parseBearerChallenge('Basic realm="x"')).toBeNull();
  });
});

describe('GitCatalogClient (P1)', () => {
  it('reads index.yaml + .sig and packages from the catalog directory at the ref', async () => {
    const catalog = testCatalog(['1.2.0']);
    const files = new Map<string, Buffer>([
      ['catalog/index.yaml', catalog.indexBytes()],
      ['catalog/index.yaml.sig', Buffer.from(blobSignature(catalog.indexBytes(), catalog.catalogKey).signature)],
      ['catalog/wiki/1.2.0.tar.gz', catalog.packages.get('1.2.0') as Buffer],
      [
        'catalog/wiki/1.2.0.tar.gz.sig',
        Buffer.from(blobSignature(catalog.packages.get('1.2.0') as Buffer, catalog.publisherKey).signature),
      ],
    ]);
    const opened: string[] = [];
    const disposed = jest.fn(async () => undefined);
    const client = new GitCatalogClient(async (repository, ref) => {
      opened.push(`${repository}@${ref}`);

      return {
        readFile: async (path) => {
          const file = files.get(path);

          if (!file) throw new Error(`${path} missing`);

          return file;
        },
        dispose: disposed,
        commit: 'd'.repeat(40),
      };
    });
    const source: CatalogSource = {
      name: 'acme',
      type: 'git',
      url: 'https://git.example.com/acme/apps.git#catalog',
      ref: 'release',
      publicKeys: ['k'],
      enabled: true,
    };
    const index = await client.fetchIndex(source);
    const verified = verifyIndex(index.bytes, index.signature, [catalog.catalogKey.publicKeyPem]);

    expect(opened).toEqual(['https://git.example.com/acme/apps.git@release']);
    expect(verified.ok).toBe(true);
    expect(index.commit).toBe('d'.repeat(40));

    const pkg = await client.fetchPackage(source, 'wiki', '1.2.0');

    if (verified.ok === false) throw new Error('index');

    expect(
      verifyPackage({
        index: verified.value.index,
        app: 'wiki',
        version: '1.2.0',
        archive: pkg.bytes,
        signature: pkg.signature,
      }).ok,
    ).toBe(true);
    expect(disposed).toHaveBeenCalledTimes(2);

    files.delete('catalog/index.yaml.sig');
    await expect(client.fetchIndex(source)).rejects.toThrow('is not signed');
    await expect(client.fetchPackage(source, '../x', '1.0.0')).rejects.toThrow('invalid app name');
  });

  it('splits the catalog directory from the URL and refuses traversal', () => {
    expect(splitGitCatalogUrl('https://g.example.com/r.git')).toEqual({
      repository: 'https://g.example.com/r.git',
      dir: '',
    });
    expect(splitGitCatalogUrl('https://g.example.com/r.git#/apps/x/')).toEqual({
      repository: 'https://g.example.com/r.git',
      dir: 'apps/x',
    });
    expect(() => splitGitCatalogUrl('https://g.example.com/r.git#a/../b')).toThrow();
  });
});

describe('FleetCatalogClient (P1)', () => {
  it('reads the fleet-hosted catalog from /api/catalog (private addresses only for a trusted fleet)', async () => {
    const catalog = testCatalog(['1.2.0']);
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.endsWith('/api/catalog/index.yaml')) return ok(catalog.indexBytes());

      if (url.endsWith('/api/catalog/index.yaml.sig'))
        return ok(blobSignature(catalog.indexBytes(), catalog.catalogKey).signature);

      if (url.endsWith('/api/catalog/packages/wiki/1.2.0.tar.gz')) return ok(catalog.packages.get('1.2.0') as Buffer);

      if (url.endsWith('/api/catalog/packages/wiki/1.2.0.tar.gz.sig'))
        return ok(blobSignature(catalog.packages.get('1.2.0') as Buffer, catalog.publisherKey).signature);

      return new Response(null, { status: 404 });
    });
    const validate = jest.fn(async () => undefined);
    const internal = jest.fn(async () => false);
    const client = new FleetCatalogClient(new CatalogHttp(fetchImpl, validate), internal);
    const source: CatalogSource = { name: 'fleet', type: 'fleet', url: 'https://fleet.example.com/', enabled: true };
    const index = await client.fetchIndex(source);

    expect(verifyIndex(index.bytes, index.signature, [catalog.catalogKey.publicKeyPem]).ok).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([
      'https://fleet.example.com/api/catalog/index.yaml',
      'https://fleet.example.com/api/catalog/index.yaml.sig',
    ]);
    expect(validate).toHaveBeenCalledTimes(2);

    internal.mockResolvedValue(true);
    validate.mockClear();
    await client.fetchPackage(source, 'wiki', '1.2.0');
    expect(validate).not.toHaveBeenCalled();
  });

  it('reads a trusted fleet’s catalog over http only with LOADWEAVER_APP_CATALOG_FLEET_ALLOW_INSECURE_HTTP', async () => {
    const catalog = testCatalog(['1.2.0']);
    const { fetchImpl, calls } = fakeFetch((url) =>
      url.endsWith('.sig')
        ? ok(blobSignature(catalog.indexBytes(), catalog.catalogKey).signature)
        : ok(catalog.indexBytes()),
    );
    const http = new CatalogHttp(fetchImpl, async () => undefined);
    const source: CatalogSource = { name: 'fleet', type: 'fleet', url: 'http://fleet.lab:3500', enabled: true };
    let allow = false;
    let trusted = true;
    const client = new FleetCatalogClient(
      http,
      async () => trusted,
      () => allow,
    );

    // Off (the default): https only.
    await expect(client.fetchIndex(source)).rejects.toThrow('fleet catalogs must use https');
    expect(calls).toHaveLength(0);

    // On: a trusted fleet's catalog over http; the signature is still checked by the caller.
    allow = true;
    const index = await client.fetchIndex(source);

    expect(verifyIndex(index.bytes, index.signature, [catalog.catalogKey.publicKeyPem]).ok).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([
      'http://fleet.lab:3500/api/catalog/index.yaml',
      'http://fleet.lab:3500/api/catalog/index.yaml.sig',
    ]);

    // On, but not a trusted fleet: still refused.
    trusted = false;
    await expect(client.fetchIndex(source)).rejects.toThrow('fleet catalogs must use https');
  });

  it('allows the flag only outside production', () => {
    const flag = { LOADWEAVER_APP_CATALOG_FLEET_ALLOW_INSECURE_HTTP: 'true' };

    expect(fleetCatalogAllowsHttp({})).toBe(false);
    expect(fleetCatalogAllowsHttp({ ...flag, NODE_ENV: 'development' })).toBe(true);
    expect(fleetCatalogAllowsHttp({ ...flag, NODE_ENV: 'production' })).toBe(false);
    expect(fleetCatalogAllowsHttp({ LOADWEAVER_APP_CATALOG_FLEET_ALLOW_INSECURE_HTTP: 'false' })).toBe(false);
  });

  it('skips certificate checks only for a trusted fleet with LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED=false', async () => {
    const catalog = testCatalog(['1.2.0']);
    const serve = (url: string) =>
      url.endsWith('.sig')
        ? ok(blobSignature(catalog.indexBytes(), catalog.catalogKey).signature)
        : ok(catalog.indexBytes());
    const verified = fakeFetch(serve);
    const unverified = fakeFetch(serve);
    const http = new CatalogHttp(verified.fetchImpl, async () => undefined, undefined, unverified.fetchImpl);
    const source: CatalogSource = { name: 'fleet', type: 'fleet', url: 'https://fleet.lab', enabled: true };
    let reject = true;
    let trusted = true;
    const client = new FleetCatalogClient(
      http,
      async () => trusted,
      () => false,
      () => reject,
    );

    // Default (true): the normal, verifying fetch.
    await client.fetchIndex(source);
    expect([verified.calls.length, unverified.calls.length]).toEqual([2, 0]);

    // false + trusted fleet: the dedicated unverified fetch; the signature still verifies.
    reject = false;
    const index = await client.fetchIndex(source);

    expect(verifyIndex(index.bytes, index.signature, [catalog.catalogKey.publicKeyPem]).ok).toBe(true);
    expect([verified.calls.length, unverified.calls.length]).toEqual([2, 2]);

    // false, but not a trusted fleet: verified as always.
    trusted = false;
    await client.fetchIndex(source);
    expect([verified.calls.length, unverified.calls.length]).toEqual([4, 2]);
  });

  it('verifies a redirect to another origin even when the start skips the check', async () => {
    const verified = fakeFetch(() => ok('moved'));
    const unverified = fakeFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com/index.yaml' } }),
    );
    const http = new CatalogHttp(verified.fetchImpl, async () => undefined, undefined, unverified.fetchImpl);

    await http.get('https://fleet.lab/api/catalog/index.yaml', { maxBytes: 100, internal: true, insecureTls: true });
    expect(unverified.calls.map((c) => c.url)).toEqual(['https://fleet.lab/api/catalog/index.yaml']);
    expect(verified.calls.map((c) => c.url)).toEqual(['https://elsewhere.example.com/index.yaml']);
  });

  it('turns certificate checks off only outside production', () => {
    const off = { LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED: 'false' };

    expect(fleetCatalogTlsRejectUnauthorized({})).toBe(true);
    expect(fleetCatalogTlsRejectUnauthorized({ LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED: 'true' })).toBe(
      true,
    );
    expect(fleetCatalogTlsRejectUnauthorized({ ...off, NODE_ENV: 'development' })).toBe(false);
    expect(fleetCatalogTlsRejectUnauthorized({ ...off, NODE_ENV: 'production' })).toBe(true);
  });
});
