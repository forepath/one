import { ForbiddenException } from '@nestjs/common';

import { parseVmImageImportRef } from '../utils/vm-image-import.utils';
import type { UpstreamLine } from '../utils/vm-image-upstream.utils';
import { shippedCatalog, VmImageCatalogEntriesService, withSuggestedRefs } from './vm-image-catalog-entries.service';

const SHA512 = 'b'.repeat(128);

function setup(options: { spec?: Record<string, unknown>; caller?: Record<string, unknown> } = {}) {
  const dataSource = {
    getRepository: () => ({ findOne: async () => (options.spec ? { kind: 'Cluster', spec: options.spec } : null) }),
  };
  const access = {
    caller: jest.fn(async () => options.caller ?? { isApiKey: false, projects: new Map([['shop', 'viewer']]) }),
  };
  const svc = new VmImageCatalogEntriesService(dataSource as never, access as never);

  svc.validateUrl = async () => undefined;

  return { svc, access };
}

const image = (distro: string, arch: 'amd64' | 'arm64', build = '1') => ({
  distro,
  label: distro,
  version: '1.0',
  arch,
  url: `https://images.example.com/${distro}-${arch}.qcow2`,
  checksum: { algorithm: 'sha256' as const, value: 'a'.repeat(64) },
  build,
});

describe('VM image catalog (3.42)', () => {
  it('ships pinned, dated images with valid checksums, firmware and import refs', () => {
    const entries = shippedCatalog();

    expect(entries.length).toBeGreaterThanOrEqual(16);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.suggestedRef)).size).toBe(entries.length);

    for (const entry of entries) {
      expect(entry.source).toBe('shipped');
      expect(entry.id).toBe(`${entry.distro}-${entry.version}-${entry.arch}`);
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.url).not.toMatch(/latest|current/);
      expect(entry.checksum.value).toMatch(
        entry.checksum.algorithm === 'sha256' ? /^[0-9a-f]{64}$/ : /^[0-9a-f]{128}$/,
      );
      expect(entry.arch === 'amd64' || !entry.firmware?.includes('bios')).toBe(true);
      expect(entry.build).toBeTruthy();
      expect(parseVmImageImportRef('shop', entry.suggestedRef)).not.toBeNull();
    }

    expect(entries.find((e) => e.id === 'ubuntu-24.04-amd64')).toMatchObject({
      label: 'Ubuntu 24.04 LTS',
      suggestedRef: 'ubuntu:24.04',
    });
    expect(entries.find((e) => e.id === 'ubuntu-24.04-arm64')?.suggestedRef).toBe('ubuntu:24.04-arm64');
    expect(entries.find((e) => e.id === 'debian-13-amd64')?.checksum.algorithm).toBe('sha512');
    expect([...new Set(entries.map((e) => e.distro))]).toEqual([
      'ubuntu',
      'debian',
      'almalinux',
      'rocky',
      'fedora',
      'alpine',
    ]);
  });

  it('suffixes the arch only where an entry of the same version has another arch', () => {
    const drafts = [image('a', 'amd64'), image('a', 'arm64'), image('b', 'arm64')].map((i) => ({
      ...i,
      id: i.distro,
      source: 'upstream' as const,
    }));

    expect(withSuggestedRefs(drafts).map((e) => e.suggestedRef)).toEqual(['a:1.0', 'a:1.0-arm64', 'b:1.0']);
  });

  it('lists the cluster entries next to the shipped ones', async () => {
    const { svc } = setup({
      spec: {
        network: {},
        vmImages: {
          catalog: [
            {
              name: 'company-base',
              label: 'Company base',
              version: '2026.10',
              arch: 'amd64',
              url: 'https://images.example.com/base.qcow2',
              sha512: `sha512:${SHA512.toUpperCase()}`,
              firmware: ['uefi'],
              guestAgent: true,
            },
          ],
        },
      },
    });
    const { entries } = await svc.catalog(undefined);

    expect(entries.filter((e) => e.source === 'shipped')).toEqual(shippedCatalog());
    expect(entries.at(-1)).toEqual({
      id: 'cluster:company-base-amd64',
      source: 'cluster',
      distro: 'company-base',
      label: 'Company base',
      version: '2026.10',
      arch: 'amd64',
      url: 'https://images.example.com/base.qcow2',
      checksum: { algorithm: 'sha512', value: SHA512 },
      firmware: ['uefi'],
      guestAgent: true,
      suggestedRef: 'company-base:2026.10',
    });
  });

  it('keeps the shipped list when the cluster entries are invalid or absent', async () => {
    expect((await setup().svc.catalog(undefined)).entries).toEqual(shippedCatalog());
    expect((await setup({ spec: { vmImages: { catalog: [{ name: 'x' }] } } }).svc.catalog(undefined)).entries).toEqual(
      shippedCatalog(),
    );
  });

  it('needs a project membership or a cluster role', async () => {
    const { svc } = setup({ caller: { isApiKey: false, projects: new Map() } });

    await expect(svc.catalog(undefined)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.upstream(undefined)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      setup({ caller: { isApiKey: false, clusterRole: 'auditor', projects: new Map() } }).svc.catalog(undefined),
    ).resolves.toBeDefined();
  });

  it('turns failed upstream lines into warnings and caches the lookups', async () => {
    const { svc } = setup();
    const ok: UpstreamLine = { id: 'good', lookup: jest.fn(async () => [image('good', 'amd64', '20261017')]) };
    const broken: UpstreamLine = { id: 'broken', lookup: jest.fn(async () => Promise.reject(new Error('HTTP 503'))) };

    svc.lines = [ok, broken];

    const first = await svc.upstream(undefined);

    expect(first).toEqual({
      entries: [
        expect.objectContaining({
          id: 'upstream:good-1.0-amd64-20261017',
          source: 'upstream',
          suggestedRef: 'good:1.0',
          build: '20261017',
        }),
      ],
      warnings: ['broken: HTTP 503'],
    });
    await svc.upstream(undefined);
    expect(ok.lookup).toHaveBeenCalledTimes(1);
    expect(broken.lookup).toHaveBeenCalledTimes(1);
  });

  it('reads upstream documents over https only, checked per hop and size-capped', async () => {
    const { svc } = setup();
    const validated: string[] = [];
    const responses: Record<string, () => Response> = {
      'https://a.example.com/list': () =>
        new Response(null, { status: 302, headers: { location: 'https://mirror.example.com/list' } }),
      'https://mirror.example.com/list': () => new Response('hello'),
      'https://a.example.com/plain': () =>
        new Response(null, { status: 302, headers: { location: 'http://mirror.example.com/list' } }),
      'https://a.example.com/huge': () => new Response(new Uint8Array(3 * 1024 ** 2)),
    };
    const read: Record<string, string> = {};

    svc.validateUrl = async (url) => void validated.push(url);
    svc.fetchImpl = async (url) => responses[url]();
    svc.lines = ['list', 'plain', 'huge'].map((name) => ({
      id: name,
      lookup: async (get) => {
        read[name] = await get(`https://a.example.com/${name}`);

        return [];
      },
    }));

    const { warnings } = await svc.upstream(undefined);

    expect(read).toEqual({ list: 'hello' });
    expect(validated).toEqual(
      expect.arrayContaining(['https://a.example.com/list', 'https://mirror.example.com/list']),
    );
    expect(warnings).toEqual([
      'plain: upstream sources must use https',
      expect.stringMatching(/^huge: index larger than/),
    ]);
  });

  it('gives up on a line after the timeout', async () => {
    jest.useFakeTimers();

    try {
      const { svc } = setup();

      svc.lines = [{ id: 'slow', lookup: () => new Promise(() => undefined) }];

      const pending = svc.upstream(undefined);

      await jest.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toEqual({ entries: [], warnings: ['slow: no answer within 10 s'] });
    } finally {
      jest.useRealTimers();
    }
  });
});
