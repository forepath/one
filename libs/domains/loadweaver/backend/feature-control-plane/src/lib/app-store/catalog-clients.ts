import {
  APP_INDEX_MEDIA_TYPE,
  APP_NAME_PATTERN,
  APP_PACKAGE_MEDIA_TYPE,
  COSIGN_SIGNATURE_ANNOTATION,
  cosignSignatureTag,
  findOciLayer,
  MAX_PACKAGE_SIZE,
  SEMVER_PATTERN,
  sha256Digest,
  SIMPLE_SIGNING_MEDIA_TYPE,
  type CatalogSource,
  type DetachedSignature,
} from '@forepath/loadweaver/shared/util-app-catalog';

import type { CatalogHttp } from './catalog-http';

/** Signed content as a catalog source hands it out; verification happens in the service (`verifyIndex` / `verifyPackage`). */
export interface SignedContent {
  bytes: Buffer;
  signature: DetachedSignature;
  /** Git catalogs: the commit the ref resolved to for this read. */
  commit?: string | null;
}

/** Fetches a catalog's index and packages (OCI registry, Git repository, fleet). */
export interface CatalogClient {
  fetchIndex(source: CatalogSource): Promise<SignedContent>;
  fetchPackage(source: CatalogSource, app: string, version: string): Promise<SignedContent>;
}

export const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 64 * 1024;
const MAX_TOKEN_BYTES = 64 * 1024;

function assertPackageRef(app: string, version: string): void {
  if (!APP_NAME_PATTERN.test(app)) throw new Error(`invalid app name ${app}`);

  if (!SEMVER_PATTERN.test(version)) throw new Error(`invalid version ${version}`);
}

/** A cosign `sign-blob` signature file: base64, one line. */
export function parseBlobSignature(bytes: Buffer): DetachedSignature {
  const text = bytes.toString('utf8').trim();

  if (!text || !/^[A-Za-z0-9+/=_-]+$/.test(text)) throw new Error('the signature file is not a cosign blob signature');

  return { kind: 'blob', signature: text };
}

// ------------------------------------------------------------------------------------------------------------ OCI

/** `oci://registry[:port]/repository` → its parts. */
export function parseOciUrl(url: string): { host: string; repository: string } {
  const match = /^oci:\/\/([a-z0-9.-]+(?::\d+)?)\/([a-z0-9]+(?:[._/-][a-z0-9]+)*)$/.exec(url);

  if (!match) throw new Error(`invalid OCI catalog URL ${url}`);

  return { host: match[1], repository: match[2] };
}

/** One way to reach a registry: the upstream itself, or the cluster's built-in registry / a mirror over the overlay. */
export interface OciEndpoint {
  /** `https://ghcr.io` or `http://[fd00::1]:5001`. */
  base: string;
  /** Overlay endpoints: plain http, private addresses. */
  internal: boolean;
  /** A bearer token to send right away (built-in registry). */
  token?: string;
  label: string;
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** `Bearer realm="…",service="…",scope="…"` → its parameters. */
export function parseBearerChallenge(header: string | null): Record<string, string> | null {
  if (!header || !/^bearer\s/i.test(header)) return null;

  const params: Record<string, string> = {};

  for (const match of header.slice(7).matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) params[match[1].toLowerCase()] = match[2];

  return params['realm'] ? params : null;
}

/**
 * OCI catalogs through the registry HTTP API (P1): the index is the artifact `<repo>:index` (layer
 * `application/vnd.loadweaver.app-index.v1+yaml`), a package is `<repo>/<app>:<version>` (layer
 * `application/vnd.loadweaver.app.v1+tar+gzip`); each is signed with cosign's simple signing (`sha256-<hex>.sig`).
 * Anonymous pulls with the registry's token dance; the endpoints to try (built-in registry, mirror, upstream) come
 * from `endpoints`. Every blob is checked against its digest.
 */
export class OciCatalogClient implements CatalogClient {
  private readonly tokens = new Map<string, { token: string; until: number }>();

  constructor(
    private readonly http: CatalogHttp,
    private readonly endpoints: (host: string, repository: string) => Promise<OciEndpoint[]>,
  ) {}

  async fetchIndex(source: CatalogSource): Promise<SignedContent> {
    const { host, repository } = parseOciUrl(source.url);

    return await this.fetchArtifact(host, repository, 'index', APP_INDEX_MEDIA_TYPE, MAX_INDEX_BYTES);
  }

  async fetchPackage(source: CatalogSource, app: string, version: string): Promise<SignedContent> {
    assertPackageRef(app, version);

    const { host, repository } = parseOciUrl(source.url);

    // OCI tags can't hold `+`: build metadata is published as `_` (as Helm does).
    return await this.fetchArtifact(
      host,
      `${repository}/${app}`,
      version.replace(/\+/g, '_'),
      APP_PACKAGE_MEDIA_TYPE,
      MAX_PACKAGE_SIZE,
    );
  }

  private async fetchArtifact(
    host: string,
    repository: string,
    tag: string,
    mediaType: string,
    maxBytes: number,
  ): Promise<SignedContent> {
    const endpoints = await this.endpoints(host, repository);
    const errors: string[] = [];

    for (const endpoint of endpoints) {
      try {
        const manifest = await this.get(endpoint, repository, `manifests/${tag}`, MAX_MANIFEST_BYTES, {
          accept: MANIFEST_ACCEPT,
        });
        const layer = findOciLayer(manifest, mediaType);

        if (!layer) throw new Error(`${repository}:${tag} has no ${mediaType} layer`);

        if (layer.size > maxBytes) throw new Error(`${repository}:${tag} is larger than ${maxBytes} bytes`);

        const bytes = await this.blob(endpoint, repository, layer.digest, maxBytes);
        const manifestDigest = sha256Digest(manifest);
        const sigManifest = await this.get(
          endpoint,
          repository,
          `manifests/${cosignSignatureTag(manifestDigest)}`,
          MAX_MANIFEST_BYTES,
          { accept: MANIFEST_ACCEPT },
          `${repository}:${tag} is not signed (no ${cosignSignatureTag(manifestDigest)})`,
        );
        const { payloadDigest, signature } = signatureLayer(sigManifest);
        const payload = await this.blob(endpoint, repository, payloadDigest, MAX_SIGNATURE_BYTES);

        return {
          bytes,
          signature: { kind: 'oci', manifest, payload, signature, dockerReference: `${host}/${repository}` },
        };
      } catch (error) {
        errors.push(`${endpoint.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(errors.join('; ') || `no way to reach ${host}`);
  }

  private async blob(endpoint: OciEndpoint, repository: string, digest: string, maxBytes: number): Promise<Buffer> {
    const body = await this.get(endpoint, repository, `blobs/${digest}`, maxBytes, {});

    if (sha256Digest(body) !== digest) throw new Error(`blob ${digest} does not match its digest`);

    return body;
  }

  /** GET `/v2/<repo>/<path>` with the token dance (401 → token from the realm → retry once). */
  private async get(
    endpoint: OciEndpoint,
    repository: string,
    path: string,
    maxBytes: number,
    headers: Record<string, string>,
    notFound?: string,
  ): Promise<Buffer> {
    const url = `${endpoint.base}/v2/${repository}/${path}`;
    const cacheKey = `${endpoint.base} ${repository}`;
    const cached = this.tokens.get(cacheKey);
    const token = endpoint.token ?? (cached && cached.until > Date.now() ? cached.token : undefined);
    const first = await this.http.get(url, {
      headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      maxBytes,
      internal: endpoint.internal,
      accept: [401, 404],
    });

    if (first.status === 404) throw new Error(notFound ?? `${repository}/${path}: not found`);

    if (first.status !== 401) return first.body;

    const challenge = parseBearerChallenge(first.headers.get('www-authenticate'));

    if (!challenge || endpoint.token) throw new Error(`${repository}: the registry refused access (401)`);

    const fresh = await this.token(endpoint, challenge, repository);

    this.tokens.set(cacheKey, { token: fresh, until: Date.now() + 60_000 });

    const second = await this.http.get(url, {
      headers: { ...headers, authorization: `Bearer ${fresh}` },
      maxBytes,
      internal: endpoint.internal,
      accept: [404],
    });

    if (second.status === 404) throw new Error(notFound ?? `${repository}/${path}: not found`);

    return second.body;
  }

  private async token(endpoint: OciEndpoint, challenge: Record<string, string>, repository: string): Promise<string> {
    const realm = new URL(challenge['realm']);

    if (challenge['service']) realm.searchParams.set('service', challenge['service']);

    realm.searchParams.set('scope', challenge['scope'] ?? `repository:${repository}:pull`);

    const response = await this.http.get(realm.toString(), { maxBytes: MAX_TOKEN_BYTES, internal: endpoint.internal });
    const body = JSON.parse(response.body.toString('utf8')) as { token?: unknown; access_token?: unknown };
    const token = typeof body.token === 'string' ? body.token : body.access_token;

    if (typeof token !== 'string' || !token) throw new Error(`${realm.host}: no token in the answer`);

    return token;
  }
}

/** The cosign signature manifest's simple-signing layer: payload digest and the signature annotation. */
export function signatureLayer(manifest: Buffer): { payloadDigest: string; signature: string } {
  let parsed: { layers?: { mediaType?: unknown; digest?: unknown; annotations?: Record<string, unknown> }[] };

  try {
    parsed = JSON.parse(manifest.toString('utf8'));
  } catch {
    throw new Error('the signature manifest is not JSON');
  }

  const layer = (parsed.layers ?? []).find(
    (l) =>
      l.mediaType === SIMPLE_SIGNING_MEDIA_TYPE && typeof l.annotations?.[COSIGN_SIGNATURE_ANNOTATION] === 'string',
  );

  if (!layer || typeof layer.digest !== 'string') throw new Error('the signature manifest has no cosign signature');

  return { payloadDigest: layer.digest, signature: String(layer.annotations?.[COSIGN_SIGNATURE_ANNOTATION]) };
}

// ------------------------------------------------------------------------------------------------------------ Git

/** Read access to one checkout of a catalog repository. */
export interface CatalogCheckout {
  readFile(path: string): Promise<Buffer>;
  dispose(): Promise<void>;
  /** The checked-out commit (the ref resolved), when known. */
  commit?: string | null;
}

/** `https://host/repo.git#apps/catalog` → the repository URL and the catalog's directory inside it. */
export function splitGitCatalogUrl(url: string): { repository: string; dir: string } {
  const [repository, fragment = ''] = url.split('#', 2);
  const dir = fragment.replace(/^\/+|\/+$/g, '');

  if (dir && (dir.split('/').some((s) => s === '' || s === '.' || s === '..') || !/^[A-Za-z0-9._/-]+$/.test(dir)))
    throw new Error(`invalid catalog directory ${dir}`);

  return { repository, dir };
}

/**
 * Git catalogs (P1): `index.yaml` + `index.yaml.sig` and `<app>/<version>.tar.gz` + `.sig` (cosign `sign-blob`) at
 * `ref` (a branch, a tag or a full commit SHA; default `main`), optionally in a directory given as the URL fragment (`…/repo.git#catalog`).
 * Shallow checkouts through the control plane's Git client.
 */
export class GitCatalogClient implements CatalogClient {
  constructor(private readonly open: (repository: string, ref: string) => Promise<CatalogCheckout>) {}

  async fetchIndex(source: CatalogSource): Promise<SignedContent> {
    return await this.read(source, 'index.yaml');
  }

  async fetchPackage(source: CatalogSource, app: string, version: string): Promise<SignedContent> {
    assertPackageRef(app, version);

    return await this.read(source, `${app}/${version}.tar.gz`);
  }

  private async read(source: CatalogSource, file: string): Promise<SignedContent> {
    const { repository, dir } = splitGitCatalogUrl(source.url);
    const path = dir ? `${dir}/${file}` : file;
    const checkout = await this.open(repository, source.ref ?? 'main');

    try {
      const bytes = await checkout.readFile(path);
      const signature = await checkout.readFile(`${path}.sig`).catch(() => {
        throw new Error(`${path} is not signed (no ${path}.sig)`);
      });

      return { bytes, signature: parseBlobSignature(signature), commit: checkout.commit ?? null };
    } finally {
      await checkout.dispose();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------- fleet

/**
 * The catalog a fleet hosts (P1): `GET <fleet>/api/catalog/index.yaml` (+ `.sig`) and
 * `GET <fleet>/api/catalog/packages/<app>/<version>.tar.gz` (+ `.sig`), cosign `sign-blob` signatures made with the
 * fleet's catalog key. `internal`: the fleet is registered as trusted for this URL (private addresses allowed).
 */
export class FleetCatalogClient implements CatalogClient {
  constructor(
    private readonly http: CatalogHttp,
    private readonly internal: (source: CatalogSource) => Promise<boolean>,
    /** `LOADWEAVER_APP_CATALOG_FLEET_ALLOW_INSECURE_HTTP` (labs): plain http for trusted fleets' catalogs. */
    private readonly allowHttp: () => boolean = () => false,
    /** `LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED` (labs): false = trusted fleets' certificates unchecked. */
    private readonly tlsRejectUnauthorized: () => boolean = () => true,
  ) {}

  async fetchIndex(source: CatalogSource): Promise<SignedContent> {
    return await this.read(source, 'index.yaml', MAX_INDEX_BYTES);
  }

  async fetchPackage(source: CatalogSource, app: string, version: string): Promise<SignedContent> {
    assertPackageRef(app, version);

    return await this.read(source, `packages/${app}/${encodeURIComponent(version)}.tar.gz`, MAX_PACKAGE_SIZE);
  }

  private async read(source: CatalogSource, path: string, maxBytes: number): Promise<SignedContent> {
    const base = `${source.url.replace(/\/+$/, '')}/api/catalog/${path}`;
    const internal = await this.internal(source);

    const protocol = new URL(base).protocol;

    // Plain http only when allowed and for a trusted fleet (the http client refuses http for anything else).
    if (protocol !== 'https:' && !(protocol === 'http:' && internal && this.allowHttp()))
      throw new Error('fleet catalogs must use https');

    // A self-signed certificate is accepted only for a trusted fleet, and only when allowed.
    const insecureTls = internal && !this.tlsRejectUnauthorized();
    const bytes = await this.http.get(base, { maxBytes, internal, insecureTls });
    const signature = await this.http.get(`${base}.sig`, { maxBytes: MAX_SIGNATURE_BYTES, internal, insecureTls });

    return { bytes: bytes.body, signature: parseBlobSignature(signature.body) };
  }
}
