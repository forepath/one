import { parseImageReference } from '@forepath/loadweaver/shared/util-compose';

import { ImageResolverService } from './image-resolver.service';
import { thresholdFor } from './master-key.service';
import { parseSecretRef } from './secrets.service';

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('parseImageReference', () => {
  it.each([
    ['nginx', { host: 'docker.io', repository: 'library/nginx' }],
    ['nginx:1.27', { host: 'docker.io', repository: 'library/nginx', tag: '1.27' }],
    ['acme/api:2', { host: 'docker.io', repository: 'acme/api', tag: '2' }],
    ['ghcr.io/acme/api:2', { host: 'ghcr.io', repository: 'acme/api', tag: '2' }],
    ['registry.example.com:5000/team/app', { host: 'registry.example.com:5000', repository: 'team/app' }],
    [`nginx@${DIGEST}`, { repository: 'library/nginx', digest: DIGEST }],
    ['index.docker.io/library/redis:7', { host: 'docker.io', repository: 'library/redis', tag: '7' }],
  ])('parses %s', (input, expected) => {
    expect(parseImageReference(input)).toMatchObject(expected);
  });

  it.each(['', 'UPPER/case', 'a b', 'x:', 'nginx@sha256:short'])('rejects %s', (input) => {
    expect(parseImageReference(input)).toBeNull();
  });
});

describe('ImageResolverService', () => {
  const resolver = new ImageResolverService();
  const allow = jest.fn(async () => undefined);

  afterEach(() => jest.clearAllMocks());

  it('keeps digest references untouched without network access', async () => {
    const fetchImpl = jest.fn();

    await expect(resolver.resolve(`nginx@${DIGEST}`, fetchImpl, allow)).resolves.toBe(`nginx@${DIGEST}`);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('follows the anonymous bearer-token flow and pins the digest', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: { 'www-authenticate': 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 't0k' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'docker-content-digest': DIGEST } }));

    await expect(resolver.resolve('nginx:1.27', fetchImpl, allow)).resolves.toBe(`nginx:1.27@${DIGEST}`);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fnginx%3Apull',
    );
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe('Bearer t0k');
    // Both the registry and the token realm (attacker-controllable) are SSRF-checked.
    expect(allow).toHaveBeenCalledWith('https://registry-1.docker.io/v2/library/nginx/manifests/1.27');
    expect(allow).toHaveBeenCalledWith(expect.stringContaining('https://auth.docker.io/token'));
  });

  it('refuses when the SSRF check fails, and on missing digests', async () => {
    const deny = jest.fn(async () => {
      throw new Error('private address');
    });

    await expect(resolver.resolve('localhost:5000/x:1', jest.fn(), deny)).rejects.toThrow('private address');

    const noDigest = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(resolver.resolve('ghcr.io/acme/api:1', noDigest, allow)).rejects.toThrow('returned no digest');
  });
});

describe('secrets helpers', () => {
  it('uses a majority threshold', () => {
    expect([1, 2, 3, 4, 5].map(thresholdFor)).toEqual([1, 2, 2, 3, 3]);
  });

  it('parses secret references', () => {
    expect(parseSecretRef('secret://shop/db-password')).toEqual({ project: 'shop', name: 'db-password' });
    expect(parseSecretRef('secret://shop/db-password@3')).toEqual({ project: 'shop', name: 'db-password', version: 3 });
    expect(parseSecretRef('secret://Shop/x')).toBeNull();
    expect(parseSecretRef('https://x')).toBeNull();
  });
});
