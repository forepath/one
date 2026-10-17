import { parseImageReference, registryApiHost } from '@forepath/loadweaver/shared/util-compose';
import { validateWebhookUrlWithDnsOrThrow } from '@forepath/shared/backend/util-webhook';
import { Injectable } from '@nestjs/common';

import type { RepositoryReader } from '../images/image-signature';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');
const REQUEST_TIMEOUT_MS = 10_000;

function parseBearerChallenge(header: string | null): { realm: string; service?: string; scope?: string } | null {
  if (!header || !/^Bearer\s/i.test(header)) return null;

  const params = Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));

  return params['realm'] ? { realm: params['realm'], service: params['service'], scope: params['scope'] } : null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Pins images to digests at plan time (3.22), so an apply deploys exactly what was reviewed even if a tag moves.
 * Registry and token URLs come from user input; both must be HTTPS and resolve to public addresses (SSRF).
 */
@Injectable()
export class ImageResolverService {
  async resolve(
    reference: string,
    fetchImpl: FetchLike = fetch,
    validateUrl: (url: string) => Promise<unknown> = validateWebhookUrlWithDnsOrThrow,
  ): Promise<string> {
    const ref = parseImageReference(reference);

    if (!ref) throw new Error(`invalid image reference ${reference}`);

    if (ref.digest) return reference;

    const registry = registryApiHost(ref.host);
    const manifestUrl = `https://${registry}/v2/${ref.repository}/manifests/${ref.tag ?? 'latest'}`;

    await validateUrl(manifestUrl);

    const request = (headers: Record<string, string>) =>
      fetchImpl(manifestUrl, {
        method: 'HEAD',
        headers: { Accept: MANIFEST_ACCEPT, ...headers },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    let res = await request({});

    if (res.status === 401) {
      const challenge = parseBearerChallenge(res.headers.get('www-authenticate'));

      if (!challenge) throw new Error(`registry ${registry} requires unsupported authentication`);

      const tokenUrl = new URL(challenge.realm);

      if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);

      tokenUrl.searchParams.set('scope', challenge.scope ?? `repository:${ref.repository}:pull`);
      await validateUrl(tokenUrl.toString());

      const tokenRes = await fetchImpl(tokenUrl.toString(), {
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!tokenRes.ok) throw new Error(`registry ${registry} denied anonymous access`);

      const body = (await tokenRes.json()) as { token?: string; access_token?: string };
      const token = body.token ?? body.access_token;

      if (!token) throw new Error(`registry ${registry} returned no token`);

      res = await request({ Authorization: `Bearer ${token}` });
    }

    if (!res.ok) throw new Error(`image ${reference} not found (HTTP ${res.status})`);

    const digest = res.headers.get('docker-content-digest');

    if (!digest || !DIGEST.test(digest)) throw new Error(`registry ${registry} returned no digest for ${reference}`);

    return `${ref.name}@${digest}`;
  }

  /**
   * Pins an image of the built-in private registry (3.22) through the members' registry instances over the overlay.
   * The addresses come from the control plane's own node records, so no SSRF checks apply here.
   */
  async resolveInCluster(
    reference: string,
    endpoints: string[],
    token: string,
    fetchImpl: FetchLike = fetch,
  ): Promise<string> {
    const ref = parseImageReference(reference);

    if (!ref) throw new Error(`invalid image reference ${reference}`);

    if (ref.digest) return reference;

    let lastError = 'no registry member reachable';

    for (const endpoint of endpoints) {
      let res: Response;

      try {
        res = await fetchImpl(`http://${endpoint}/v2/${ref.repository}/manifests/${ref.tag ?? 'latest'}`, {
          method: 'HEAD',
          headers: { Accept: MANIFEST_ACCEPT, Authorization: `Bearer ${token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }

      if (res.status === 404) throw new Error(`image ${reference} not found in the built-in registry; push it first`);

      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }

      const digest = res.headers.get('docker-content-digest');

      if (!digest || !DIGEST.test(digest)) throw new Error(`the built-in registry returned no digest for ${reference}`);

      return `${ref.name}@${digest}`;
    }

    throw new Error(`image ${reference} not resolvable: ${lastError}`);
  }

  /**
   * Reads manifests and blobs of a public repository (signatures, 3.22) with the same anonymous token flow and SSRF
   * checks as pinning; blob redirects (CDNs) are followed by hand, each target checked, without the token.
   */
  publicReader(
    reference: string,
    fetchImpl: FetchLike = fetch,
    validateUrl: (url: string) => Promise<unknown> = validateWebhookUrlWithDnsOrThrow,
  ): RepositoryReader {
    const ref = parseImageReference(reference);

    if (!ref) throw new Error(`invalid image reference ${reference}`);

    const registry = registryApiHost(ref.host);
    let token: string | null = null;
    const get = async (path: string, accept?: string): Promise<Response> => {
      const url = `https://${registry}/v2/${ref.repository}/${path}`;

      await validateUrl(url);

      const request = () =>
        fetchImpl(url, {
          headers: { ...(accept ? { Accept: accept } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      let res = await request();

      if (res.status === 401 && !token) {
        const challenge = parseBearerChallenge(res.headers.get('www-authenticate'));

        if (!challenge) throw new Error(`registry ${registry} requires unsupported authentication`);

        const tokenUrl = new URL(challenge.realm);

        if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);

        tokenUrl.searchParams.set('scope', `repository:${ref.repository}:pull`);
        await validateUrl(tokenUrl.toString());

        const tokenRes = await fetchImpl(tokenUrl.toString(), {
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const body = tokenRes.ok ? ((await tokenRes.json()) as { token?: string; access_token?: string }) : {};

        token = body.token ?? body.access_token ?? null;

        if (!token) throw new Error(`registry ${registry} denied anonymous access`);

        res = await request();
      }

      for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 3; hops++) {
        const location = res.headers.get('location');

        if (!location) break;

        const target = new URL(location, url).toString();

        await validateUrl(target);
        res = await fetchImpl(target, { redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      }

      return res;
    };

    return readerOver(get);
  }

  /** The same for the built-in registry (3.22), through the members over the overlay with a pull token. */
  clusterReader(reference: string, endpoints: string[], token: string, fetchImpl: FetchLike = fetch): RepositoryReader {
    const ref = parseImageReference(reference);

    if (!ref) throw new Error(`invalid image reference ${reference}`);

    const get = async (path: string, accept?: string): Promise<Response> => {
      let last: unknown = new Error('no registry member reachable');

      for (const endpoint of endpoints) {
        try {
          return await fetchImpl(`http://${endpoint}/v2/${ref.repository}/${path}`, {
            headers: { ...(accept ? { Accept: accept } : {}), Authorization: `Bearer ${token}` },
            redirect: 'error',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch (error) {
          last = error;
        }
      }

      throw last;
    };

    return readerOver(get);
  }
}

/** Signature manifests and payloads are small; anything bigger isn't one. */
const MAX_READ_BYTES = 1024 * 1024;

async function limited(res: Response): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of (res.body ?? []) as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;

    if (size > MAX_READ_BYTES) throw new Error('response too large');

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function readerOver(get: (path: string, accept?: string) => Promise<Response>): RepositoryReader {
  return {
    manifest: async (reference) => {
      const res = await get(`manifests/${reference}`, 'application/vnd.oci.image.manifest.v1+json');

      if (res.status === 404) return null;

      if (!res.ok) throw new Error(`manifest ${reference}: HTTP ${res.status}`);

      return JSON.parse((await limited(res)).toString('utf8'));
    },
    blob: async (digest) => {
      if (!DIGEST.test(digest)) throw new Error('invalid digest');

      const res = await get(`blobs/${digest}`);

      if (!res.ok) throw new Error(`blob ${digest}: HTTP ${res.status}`);

      return await limited(res);
    },
  };
}
