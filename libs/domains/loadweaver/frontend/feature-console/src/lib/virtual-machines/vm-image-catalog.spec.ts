import type { AccessMe, VmImageCatalogEntry, VmRegistryImage } from '@forepath/loadweaver/frontend/data-access-console';

import {
  catalogDistros,
  catalogImportRequest,
  catalogRows,
  mayImportVmImages,
  parseImageChecksum,
  registryImageOf,
  withoutDigest,
} from './vm-image-catalog';

const SHA256 = 'a'.repeat(64);
const SHA512 = 'B'.repeat(128);

function catalogEntry(overrides: Partial<VmImageCatalogEntry> = {}): VmImageCatalogEntry {
  return {
    id: 'ubuntu-24.04-amd64',
    source: 'shipped',
    distro: 'ubuntu',
    label: 'Ubuntu 24.04 LTS',
    version: '24.04',
    arch: 'amd64',
    url: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
    checksum: { algorithm: 'sha256', value: SHA256 },
    firmware: ['uefi', 'bios'],
    guestAgent: true,
    suggestedRef: 'ubuntu:24.04',
    ...overrides,
  };
}

describe('VM image catalog helpers (3.42)', () => {
  it('detects SHA-256 / SHA-512 by length, with an optional matching prefix', () => {
    expect(parseImageChecksum(` ${SHA256} `)).toEqual({ algorithm: 'sha256', value: SHA256 });
    expect(parseImageChecksum(`sha256:${SHA256.toUpperCase()}`)).toEqual({ algorithm: 'sha256', value: SHA256 });
    expect(parseImageChecksum(SHA512)).toEqual({ algorithm: 'sha512', value: SHA512.toLowerCase() });
    expect(parseImageChecksum(`SHA512:${SHA512}`)).toEqual({ algorithm: 'sha512', value: SHA512.toLowerCase() });
    expect(parseImageChecksum(`sha512:${SHA256}`)).toBeNull();
    expect(parseImageChecksum('a'.repeat(96))).toBeNull();
    expect(parseImageChecksum(`${'z'.repeat(64)}`)).toBeNull();
    expect(parseImageChecksum('')).toBeNull();
  });

  it('imports an entry with exactly the checksum field of its algorithm', () => {
    expect(catalogImportRequest(catalogEntry())).toEqual({
      url: catalogEntry().url,
      sha256: SHA256,
      ref: 'ubuntu:24.04',
      arch: 'amd64',
      firmware: ['uefi', 'bios'],
      guestAgent: true,
    });

    const fedora = catalogEntry({
      checksum: { algorithm: 'sha512', value: SHA512 },
      firmware: undefined,
      guestAgent: undefined,
    });
    const request = catalogImportRequest(fedora, ' fedora:42 ');

    expect(request).toEqual({ url: fedora.url, sha512: SHA512.toLowerCase(), ref: 'fedora:42', arch: 'amd64' });
    expect('sha256' in request).toBe(false);
  });

  it('lists one architecture, Recommended first, then the cluster, then other versions (newest first)', () => {
    const entries = [
      catalogEntry({ id: 'up-noble', source: 'upstream', version: '24.04', url: 'https://u/noble-new.img' }),
      catalogEntry({ id: 'up-dup', source: 'upstream', version: '24.04' }),
      catalogEntry({ id: 'cluster', source: 'cluster', distro: 'company-base', label: 'Company base' }),
      catalogEntry({ id: 'deb', distro: 'debian', label: 'Debian 13', version: '13', suggestedRef: 'debian:13' }),
      catalogEntry({ id: 'u22', version: '22.04', label: 'Ubuntu 22.04 LTS' }),
      catalogEntry(),
      catalogEntry({ id: 'arm', arch: 'arm64' }),
    ];

    expect(catalogRows(entries, { arch: 'amd64' }).map((e) => e.id)).toEqual([
      'deb',
      'ubuntu-24.04-amd64',
      'u22',
      'cluster',
      'up-noble',
    ]);
    expect(catalogRows(entries, { arch: 'arm64' }).map((e) => e.id)).toEqual(['arm']);
    expect(catalogRows(entries, { arch: 'amd64', distro: 'debian' }).map((e) => e.id)).toEqual(['deb']);
    expect(catalogDistros(entries)).toEqual(['company-base', 'debian', 'ubuntu']);
  });

  it('finds the imported image by repository:tag and drops digests from references', () => {
    const images = [
      { repository: 'ubuntu', tag: '24.04', reference: 'registry.lw/shop/ubuntu:24.04@sha256:abc' },
    ] as VmRegistryImage[];

    expect(registryImageOf(catalogEntry(), images)?.reference).toBe('registry.lw/shop/ubuntu:24.04@sha256:abc');
    expect(registryImageOf(catalogEntry({ suggestedRef: 'ubuntu:22.04' }), images)).toBeNull();
    expect(withoutDigest('registry.lw/shop/ubuntu:24.04@sha256:abc')).toBe('registry.lw/shop/ubuntu:24.04');
    expect(withoutDigest('registry.lw/shop/ubuntu:24.04')).toBe('registry.lw/shop/ubuntu:24.04');
  });

  it('lets operators, admins and cluster admins import', () => {
    const me = (projects: AccessMe['projects'], clusterRole: AccessMe['clusterRole'] = null) =>
      ({ userId: 'u', clusterRole, projects }) as AccessMe;

    expect(mayImportVmImages(me({ shop: 'operator' }), 'shop')).toBe(true);
    expect(mayImportVmImages(me({ shop: 'admin' }), 'shop')).toBe(true);
    expect(mayImportVmImages(me({ shop: 'developer' }), 'shop')).toBe(false);
    expect(mayImportVmImages(me({}, 'cluster-admin'), 'shop')).toBe(true);
    expect(mayImportVmImages(me({}, 'infra-operator'), 'shop')).toBe(false);
    expect(mayImportVmImages(null, 'shop')).toBe(false);
    expect(mayImportVmImages(me({ shop: 'admin' }), null)).toBe(false);
  });
});
