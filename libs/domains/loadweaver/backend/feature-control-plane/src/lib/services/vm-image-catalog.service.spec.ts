import { projectRepositories, vmImageVariant } from '../utils/vm-image-catalog.utils';
import { registryUnreachableMessage, VmImageCatalogService } from './vm-image-catalog.service';

const sha = (c: string) => `sha256:${c.repeat(64)}`;
const VM_CONFIG = { arch: 'amd64', format: 'qcow2', virtualSize: 2048, firmware: ['uefi'], guestAgent: true };
const vmManifest = (config: string, layer: string) => ({
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  artifactType: 'application/vnd.loadweaver.vm-image.v1',
  config: { mediaType: 'application/vnd.loadweaver.vm-image.config.v1+json', digest: config, size: 10 },
  layers: [{ mediaType: 'application/vnd.loadweaver.vm-image.disk.qcow2', digest: layer, size: 900 }],
});

function setup(registry: Record<string, unknown>) {
  const calls: string[] = [];
  const dataSource = {
    getRepository: () => ({
      find: async () => [{ name: 'cp1', controlPlane: true, connected: true, overlayV4: '10.93.0.1', overlayV6: null }],
    }),
  };
  const access = { assertRead: jest.fn(async () => undefined) };
  const tokens = {
    issueWithCatalog: jest.fn(async () => 'catalog-token'),
    issue: jest.fn(async () => 'pull-token'),
  };
  const svc = new VmImageCatalogService(dataSource as never, access as never, tokens as never);

  (svc as unknown as { fetchImpl: (url: string, init?: RequestInit) => Promise<Response> }).fetchImpl = async (
    url,
    init,
  ) => {
    const path = url.replace(/^http:\/\/[^/]+\/v2\//, '');

    calls.push(`${(init?.headers as Record<string, string>)['Authorization']} ${path}`);

    // Like distribution on Garage (G5): a list without `last` comes back empty.
    if (/(^_catalog|\/tags\/list)/.test(path) && !/[?&]last=/.test(path))
      return new Response(JSON.stringify({ repositories: [], tags: [] }), { status: 200 });

    const key = Object.keys(registry).find((k) => path === k || path.startsWith(`${k}?`));

    if (!key) return new Response('{}', { status: 404 });

    const value = registry[key] as { body: unknown; digest?: string };

    return new Response(JSON.stringify(value.body), {
      status: 200,
      headers: value.digest ? { 'docker-content-digest': value.digest } : {},
    });
  };

  return { svc, calls, access, tokens };
}

describe('VM images in the registry catalog (3.35)', () => {
  it('filters catalog pages to the project namespace', () => {
    expect(projectRepositories('shop', { repositories: ['shop/a', 'shop/b'] }, 2)).toEqual({
      repositories: ['shop/a', 'shop/b'],
      more: true,
    });
    expect(projectRepositories('shop', { repositories: ['shop/a', 'shopx/b'] }, 2)).toEqual({
      repositories: ['shop/a'],
      more: false,
    });
    expect(vmImageVariant({ config: { mediaType: 'application/vnd.oci.image.config.v1+json' } }, {})).toBeNull();
    expect(vmImageVariant(vmManifest(sha('c'), sha('l')), { ...VM_CONFIG, format: 'raw' })).toBeNull();
  });

  it('lists VM image artifacts (also inside an index) and skips container images by media type', async () => {
    const { svc, calls, tokens } = setup({
      _catalog: { body: { repositories: ['shop/api', 'shop/debian', 'shop/multi', 'zoo/x'] } },
      'shop/api/tags/list': { body: { tags: ['1'] } },
      'shop/api/manifests/1': {
        body: { config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha('a') }, layers: [] },
      },
      'shop/debian/tags/list': { body: { tags: ['13', `sha256-${'f'.repeat(64)}.sig`] } },
      'shop/debian/manifests/13': { body: vmManifest(sha('c'), sha('l')), digest: sha('d') },
      [`shop/debian/blobs/${sha('c')}`]: { body: VM_CONFIG },
      'shop/multi/tags/list': { body: { tags: ['1'] } },
      'shop/multi/manifests/1': {
        body: {
          mediaType: 'application/vnd.oci.image.index.v1+json',
          manifests: [
            { digest: sha('1'), platform: { os: 'linux', architecture: 'amd64' } },
            { digest: sha('2'), platform: { os: 'linux', architecture: 'arm64' } },
          ],
        },
        digest: sha('i'),
      },
      [`shop/multi/manifests/${sha('1')}`]: { body: vmManifest(sha('3'), sha('5')) },
      [`shop/multi/manifests/${sha('2')}`]: { body: vmManifest(sha('4'), sha('6')) },
      [`shop/multi/blobs/${sha('3')}`]: { body: VM_CONFIG },
      [`shop/multi/blobs/${sha('4')}`]: { body: { ...VM_CONFIG, arch: 'arm64', guestAgent: false } },
    });

    const images = await svc.list(undefined, 'shop');

    expect(images).toEqual([
      {
        project: 'shop',
        repository: 'debian',
        tag: '13',
        reference: `registry.lw/shop/debian:13@${sha('d')}`,
        digest: sha('d'),
        variants: [
          { arch: 'amd64', format: 'qcow2', virtualSize: 2048, firmware: ['uefi'], guestAgent: true, layerBytes: 900 },
        ],
      },
      expect.objectContaining({
        repository: 'multi',
        digest: sha('i'),
        variants: [expect.objectContaining({ arch: 'amd64' }), expect.objectContaining({ arch: 'arm64' })],
      }),
    ]);
    expect(calls[0]).toBe('Bearer catalog-token _catalog?n=500&last=shop%2F');
    expect(tokens.issue).toHaveBeenCalledWith(
      'control-plane:vm-image-catalog',
      [
        { name: 'shop/api', actions: ['pull'] },
        { name: 'shop/debian', actions: ['pull'] },
        { name: 'shop/multi', actions: ['pull'] },
      ],
      300,
    );
    // The container image's config is never read; signatures aren't listed.
    expect(calls.some((c) => c.includes(`blobs/${sha('a')}`))).toBe(false);
    expect(calls.some((c) => c.includes('sha256-'))).toBe(false);

    // Cached for a moment.
    const before = calls.length;

    await svc.list(undefined, 'shop');
    expect(calls.length).toBe(before);
  });
});

describe('registry of a connected member not answering (live 3.43)', () => {
  it('is unavailable (503), not an internal error', async () => {
    const { svc } = setup({});

    (svc as unknown as { fetchImpl: () => Promise<Response> }).fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };

    await expect(svc.list(undefined, 'shop')).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('the built-in registry is not reachable (10.93.0.1:5000): fetch failed'),
    });
  });
});

describe('registry unreachable message', () => {
  it('names the offline members (at most five)', () => {
    expect(registryUnreachableMessage(['cp1', 'cp2'])).toContain('offline: cp1, cp2');
    expect(registryUnreachableMessage(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toContain(
      'offline: a, b, c, d, e, +2 more',
    );
  });
});
