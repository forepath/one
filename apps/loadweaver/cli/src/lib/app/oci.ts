import {
  APP_INDEX_MEDIA_TYPE,
  APP_PACKAGE_MEDIA_TYPE,
  buildOciArtifactManifest,
  buildSimpleSigningPayload,
  COSIGN_SIGNATURE_ANNOTATION,
  cosignSignatureTag,
  OCI_MANIFEST_MEDIA_TYPE,
  sha256Digest,
  signBlob,
  SIMPLE_SIGNING_MEDIA_TYPE,
  verifySimpleSigning,
} from '@forepath/loadweaver/shared/util-app-catalog';

import type { BuiltCatalog, LoadedCatalog } from './catalog';
import type { SigningKey } from './keys';

/** `artifactType` of app package artifacts. */
export const APP_ARTIFACT_TYPE = 'application/vnd.loadweaver.app.v1';
/** `artifactType` of the catalog index artifact. */
export const APP_INDEX_ARTIFACT_TYPE = 'application/vnd.loadweaver.app-index.v1';
/** Tag of the index artifact in the catalog repository (`<catalog repo>:index`). */
export const INDEX_TAG = 'index';
/** Committed OCI signature of a package (simple-signing over its artifact manifest; `lw app sign --oci`). */
export const PACKAGE_OCI_SIGNATURE_FILE = 'package.oci.sig';

export interface OciTarget {
  /** `ghcr.io` */
  registry: string;
  /** `forepath/loadweaver-apps` */
  repository: string;
  /** `https://ghcr.io` (plain HTTP only for localhost / 127.0.0.1, i.e. tests and local registries). */
  base: string;
}

/** `oci://registry/repository` → target. */
export function parseOciTarget(reference: string): OciTarget {
  const match = /^oci:\/\/([^\s/]+)\/([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)$/.exec(
    reference.trim(),
  );

  if (!match) throw new Error(`invalid OCI repository ${reference}: expected oci://<registry>/<repository>`);

  const [, registry, repository] = match;
  const host = registry.split(':')[0];
  const plain = host === 'localhost' || host === '127.0.0.1';

  return { registry, repository, base: `${plain ? 'http' : 'https'}://${registry}` };
}

/** Repository of an app's package artifacts: `<catalog repo>/<app>`. */
export function packageRepository(target: OciTarget, app: string): string {
  return `${target.repository}/${app}`;
}

export interface OciArtifact {
  manifest: Buffer;
  digest: string;
  /** Blobs referenced by the manifest (config + layers). */
  blobs: Buffer[];
}

const EMPTY_CONFIG = Buffer.from('{}');

/**
 * The OCI tag of a package version. Tags can't hold `+`, so build metadata is written as `_` (as Helm does); the
 * control plane maps a version the same way when it fetches a package.
 */
export function ociVersionTag(version: string): string {
  return version.replace(/\+/g, '_');
}

export function packageArtifact(app: string, version: string, archive: Buffer): OciArtifact {
  const { manifest, digest } = buildOciArtifactManifest({
    layer: archive,
    layerMediaType: APP_PACKAGE_MEDIA_TYPE,
    artifactType: APP_ARTIFACT_TYPE,
    annotations: {
      'org.opencontainers.image.title': `${app}-${version}.tar.gz`,
      'org.opencontainers.image.version': version,
    },
  });

  return { manifest, digest, blobs: [EMPTY_CONFIG, archive] };
}

export function indexArtifact(indexYaml: string): OciArtifact {
  const layer = Buffer.from(indexYaml, 'utf8');
  const { manifest, digest } = buildOciArtifactManifest({
    layer,
    layerMediaType: APP_INDEX_MEDIA_TYPE,
    artifactType: APP_INDEX_ARTIFACT_TYPE,
    annotations: { 'org.opencontainers.image.title': 'index.yaml' },
  });

  return { manifest, digest, blobs: [EMPTY_CONFIG, layer] };
}

/**
 * cosign's signature artifact for a signed manifest (pushed as `<repo>:sha256-<hex>.sig`): the simple-signing payload
 * as the layer, its base64 signature in the layer annotation, and the config cosign writes.
 */
export function cosignSignatureArtifact(payload: Buffer, signature: string): OciArtifact {
  const payloadDigest = sha256Digest(payload);
  const config = Buffer.from(
    JSON.stringify({
      architecture: '',
      config: {},
      created: '0001-01-01T00:00:00Z',
      history: [{ created: '0001-01-01T00:00:00Z' }],
      os: '',
      rootfs: { type: 'layers', diff_ids: [payloadDigest] },
    }),
  );
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: OCI_MANIFEST_MEDIA_TYPE,
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        size: config.length,
        digest: sha256Digest(config),
      },
      layers: [
        {
          mediaType: SIMPLE_SIGNING_MEDIA_TYPE,
          size: payload.length,
          digest: payloadDigest,
          annotations: { [COSIGN_SIGNATURE_ANNOTATION]: signature },
        },
      ],
    }),
  );

  return { manifest, digest: sha256Digest(manifest), blobs: [config, payload] };
}

/** Simple-signing payload for an artifact in a repository (`registry/repo`). */
export function simpleSigningPayload(target: OciTarget, repository: string, manifestDigest: string): Buffer {
  return buildSimpleSigningPayload({ dockerReference: `${target.registry}/${repository}`, manifestDigest });
}

export interface RegistryCredentials {
  username?: string;
  password?: string;
}

type Fetch = typeof fetch;

function parseChallenge(header: string | null): { scheme: string; params: Record<string, string> } | null {
  if (!header) return null;

  const space = header.indexOf(' ');
  const scheme = (space < 0 ? header : header.slice(0, space)).toLowerCase();
  const params: Record<string, string> = {};

  for (const match of header.slice(space + 1).matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) params[match[1]] = match[2];

  return { scheme, params };
}

/**
 * A minimal OCI distribution client (push / pull of blobs and manifests) with the registry token flow: a 401 with a
 * `Bearer realm=…` challenge is answered with a token for `repository:<repo>:<actions>` (Basic credentials when
 * given, anonymous otherwise), or Basic auth when the registry asks for it.
 */
export class OciRegistryClient {
  private readonly tokens = new Map<string, string>();

  constructor(
    private readonly target: OciTarget,
    private readonly credentials: RegistryCredentials = {},
    private readonly fetchImpl: Fetch = fetch,
    /** Token scope actions: `pull,push` to publish, `pull` for anonymous reads. */
    private readonly actions = 'pull,push',
  ) {}

  private basic(): string | undefined {
    const { username, password } = this.credentials;

    return username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : undefined;
  }

  private async token(repository: string, challenge: Record<string, string>): Promise<string> {
    const url = new URL(challenge['realm']);

    if (challenge['service']) url.searchParams.set('service', challenge['service']);

    url.searchParams.set('scope', `repository:${repository}:${this.actions}`);

    const basic = this.basic();
    const res = await this.fetchImpl(url, { headers: basic ? { authorization: basic } : {} });

    if (!res.ok) throw new Error(`registry token for ${repository}: HTTP ${res.status}`);

    const body = (await res.json()) as { token?: string; access_token?: string };
    const token = body.token ?? body.access_token;

    if (!token) throw new Error(`registry token for ${repository}: no token in the response`);

    return token;
  }

  async request(repository: string, method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.target.base}/v2/${repository}${path}`;
    const send = (authorization?: string) =>
      this.fetchImpl(url, {
        ...init,
        method,
        headers: { ...(init.headers as Record<string, string>), ...(authorization ? { authorization } : {}) },
      });
    const cached = this.tokens.get(repository);
    let res = await send(cached ? `Bearer ${cached}` : undefined);

    if (res.status !== 401) return res;

    const challenge = parseChallenge(res.headers.get('www-authenticate'));

    if (challenge?.scheme === 'bearer' && challenge.params['realm']) {
      const token = await this.token(repository, challenge.params);

      this.tokens.set(repository, token);
      res = await send(`Bearer ${token}`);
    } else if (challenge?.scheme === 'basic' && this.basic()) res = await send(this.basic());

    return res;
  }

  async hasBlob(repository: string, digest: string): Promise<boolean> {
    const res = await this.request(repository, 'HEAD', `/blobs/${digest}`);

    return res.ok;
  }

  async pushBlob(repository: string, data: Buffer): Promise<{ digest: string; uploaded: boolean }> {
    const digest = sha256Digest(data);

    if (await this.hasBlob(repository, digest)) return { digest, uploaded: false };

    const start = await this.request(repository, 'POST', '/blobs/uploads/');

    if (start.status !== 202) throw new Error(`blob upload to ${repository}: HTTP ${start.status}`);

    const location = start.headers.get('location');

    if (!location) throw new Error(`blob upload to ${repository}: no Location`);

    const url = new URL(location, this.target.base);

    url.searchParams.set('digest', digest);

    const put = await this.request(repository, 'PUT', url.toString(), {
      body: new Uint8Array(data),
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(data.length) },
    });

    if (put.status !== 201) throw new Error(`blob ${digest} to ${repository}: HTTP ${put.status}`);

    return { digest, uploaded: true };
  }

  async putManifest(repository: string, reference: string, manifest: Buffer, mediaType = OCI_MANIFEST_MEDIA_TYPE) {
    const res = await this.request(repository, 'PUT', `/manifests/${reference}`, {
      body: new Uint8Array(manifest),
      headers: { 'content-type': mediaType },
    });

    if (res.status !== 201) {
      const text = await res.text().catch(() => '');

      throw new Error(`manifest ${repository}:${reference}: HTTP ${res.status}${text ? ` ${text.slice(0, 300)}` : ''}`);
    }
  }

  /** The digest a tag points at, or null when the tag doesn't exist. */
  async manifestDigest(repository: string, reference: string): Promise<string | null> {
    const res = await this.request(repository, 'HEAD', `/manifests/${reference}`, {
      headers: { accept: OCI_MANIFEST_MEDIA_TYPE },
    });

    if (res.status === 404) return null;

    if (!res.ok) throw new Error(`manifest ${repository}:${reference}: HTTP ${res.status}`);

    return res.headers.get('docker-content-digest');
  }

  async pushArtifact(repository: string, reference: string, artifact: OciArtifact): Promise<void> {
    for (const blob of artifact.blobs) await this.pushBlob(repository, blob);

    await this.putManifest(repository, reference, artifact.manifest);
  }
}

export interface PublishStep {
  repository: string;
  tag: string;
  digest: string;
  what: string;
}

export interface PublishOptions {
  target: OciTarget;
  catalogKey: SigningKey;
  /** Signs package artifacts of its own publisher (default: catalogKey); others need a committed package.oci.sig. */
  packageKey?: SigningKey;
  /** Committed OCI signatures (`package.oci.sig`) by `<app>/<version>`. */
  committedSignatures?: Record<string, string>;
  dryRun?: boolean;
  /** Allow moving a version tag that already points at a different artifact. */
  force?: boolean;
}

/**
 * The pushes of an OCI catalog: per package the artifact (`<repo>/<app>:<version>`, `+` written as `_`) and its cosign signature
 * (`<repo>/<app>:sha256-<hex>.sig`, simple-signing by the publisher's key), then the index artifact (`<repo>:index`)
 * and its signature by the catalog key. Signatures are checked before anything is pushed.
 */
export function planOciPublish(
  catalog: LoadedCatalog,
  built: BuiltCatalog,
  options: PublishOptions,
): { steps: PublishStep[]; artifacts: { repository: string; tag: string; artifact: OciArtifact }[] } {
  const packageKey = options.packageKey ?? options.catalogKey;
  const artifacts: { repository: string; tag: string; artifact: OciArtifact; what: string }[] = [];
  const errors: string[] = [];

  for (const pkg of built.packages) {
    const repository = packageRepository(options.target, pkg.app);
    const artifact = packageArtifact(pkg.app, pkg.version, pkg.archive);
    const payload = simpleSigningPayload(options.target, repository, artifact.digest);
    const publisher = catalog.publishers[pkg.keyId];
    const publisherKeys = Object.entries(catalog.publishers)
      .filter(([, p]) => p.name === publisher.name)
      .map(([, p]) => p.publicKey);
    let signature = options.committedSignatures?.[`${pkg.app}/${pkg.version}`];

    if (signature) {
      const verified = verifySimpleSigning(payload, signature, publisherKeys, {
        manifestDigest: artifact.digest,
        dockerReference: `${options.target.registry}/${repository}`,
      });

      if (!verified.ok) {
        errors.push(`${pkg.app}/${pkg.version}/${PACKAGE_OCI_SIGNATURE_FILE}: ${verified.errors.join('; ')}`);
        continue;
      }
    } else if (catalog.publishers[packageKey.keyId]?.name === publisher.name)
      signature = signBlob(payload, packageKey.privateKeyPem, packageKey.passphrase);
    else {
      errors.push(
        `${pkg.app}/${pkg.version}: no OCI signature: commit ${PACKAGE_OCI_SIGNATURE_FILE} ` +
          `(lw app sign <archive> --oci oci://${options.target.registry}/${options.target.repository})`,
      );
      continue;
    }

    artifacts.push({ repository, tag: ociVersionTag(pkg.version), artifact, what: `${pkg.app} ${pkg.version}` });
    artifacts.push({
      repository,
      tag: cosignSignatureTag(artifact.digest),
      artifact: cosignSignatureArtifact(payload, signature),
      what: `${pkg.app} ${pkg.version} signature`,
    });
  }

  if (errors.length > 0) throw new Error(`cannot publish:\n  ${errors.join('\n  ')}`);

  const index = indexArtifact(built.indexYaml);
  const indexPayload = simpleSigningPayload(options.target, options.target.repository, index.digest);

  artifacts.push({ repository: options.target.repository, tag: INDEX_TAG, artifact: index, what: 'index' });
  artifacts.push({
    repository: options.target.repository,
    tag: cosignSignatureTag(index.digest),
    artifact: cosignSignatureArtifact(
      indexPayload,
      signBlob(indexPayload, options.catalogKey.privateKeyPem, options.catalogKey.passphrase),
    ),
    what: 'index signature',
  });

  return {
    steps: artifacts.map((a) => ({ repository: a.repository, tag: a.tag, digest: a.artifact.digest, what: a.what })),
    artifacts,
  };
}

/** Pushes a planned publish (packages and their signatures first, the index last, so clusters never see dangling entries). */
export async function pushOciPublish(
  client: OciRegistryClient,
  plan: ReturnType<typeof planOciPublish>,
  options: { force?: boolean },
  out: (line: string) => void,
): Promise<void> {
  for (const { repository, tag, artifact } of plan.artifacts) {
    const isVersionTag = !tag.endsWith('.sig') && tag !== INDEX_TAG;

    if (isVersionTag) {
      const current = await client.manifestDigest(repository, tag);

      if (current === artifact.digest) {
        out(`  = ${repository}:${tag} (${artifact.digest}, unchanged)`);
        continue;
      }

      if (current && !options.force)
        throw new Error(
          `${repository}:${tag} already points at ${current}, not ${artifact.digest}: versions are immutable ` +
            '(publish a new version, or --force)',
        );
    }

    await client.pushArtifact(repository, tag, artifact);
    out(`  + ${repository}:${tag} (${artifact.digest})`);
  }
}
