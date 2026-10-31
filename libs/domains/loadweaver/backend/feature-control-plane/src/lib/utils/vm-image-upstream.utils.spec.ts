import {
  compareBuilds,
  latestAlpineImages,
  latestDebianBuild,
  parseChecksumList,
  parseFedoraReleases,
  parseUbuntuSerial,
  UPSTREAM_LINES,
} from './vm-image-upstream.utils';

const h = (c: string, n = 64) => c.repeat(n);

/** What the official sources answer (trimmed copies of the real documents). */
const UPSTREAM: Record<string, string> = {
  'https://cloud-images.ubuntu.com/releases/noble/release/unpacked/build-info.txt':
    'serial=20261017\norig_prefix=noble-server-cloudimg\nsuite=noble\n',
  'https://cloud-images.ubuntu.com/releases/noble/release-20261017/SHA256SUMS': [
    `${h('1')} *ubuntu-24.04-server-cloudimg-amd64.img`,
    `${h('2')} *ubuntu-24.04-server-cloudimg-arm64.img`,
    `${h('3')} *ubuntu-24.04-server-cloudimg-amd64.tar.gz`,
  ].join('\n'),
  'https://cloud.debian.org/images/cloud/trixie/':
    '<a href="20261017-2634/">20261017-2634/</a><a href="20261026-2643/">20261026-2643/</a><a href="latest/">latest/</a>',
  'https://cloud.debian.org/images/cloud/trixie/20261026-2643/SHA512SUMS': [
    `${h('4', 128)}  debian-13-genericcloud-amd64-20261026-2643.qcow2`,
    `${h('5', 128)}  debian-13-genericcloud-arm64-20261026-2643.qcow2`,
    `${h('6', 128)}  debian-13-generic-amd64-20261026-2643.qcow2`,
  ].join('\n'),
  'https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/CHECKSUM': [
    `${h('7')}  AlmaLinux-9-GenericCloud-9.8-20260810.x86_64.qcow2`,
    `${h('8')}  AlmaLinux-9-GenericCloud-9.8-20261005.x86_64.qcow2`,
    `${h('9')}  AlmaLinux-9-GenericCloud-ext4-9.8-20261005.x86_64.qcow2`,
    `${h('a')}  AlmaLinux-9-GenericCloud-latest.x86_64.qcow2`,
  ].join('\n'),
  'https://repo.almalinux.org/almalinux/9/cloud/aarch64/images/CHECKSUM': `${h('b')}  AlmaLinux-9-GenericCloud-9.8-20261005.aarch64.qcow2`,
  'https://dl.rockylinux.org/pub/rocky/10/images/x86_64/CHECKSUM': [
    '-----BEGIN PGP SIGNED MESSAGE-----',
    'Hash: SHA256',
    '',
    '# Rocky-10-GenericCloud-Base-10.2-20260525.0.x86_64.qcow2: 544997376 bytes',
    `SHA256 (Rocky-10-GenericCloud-Base-10.2-20260525.0.x86_64.qcow2) = ${h('c')}`,
    `SHA256 (Rocky-10-GenericCloud-Base.latest.x86_64.qcow2) = ${h('c')}`,
  ].join('\n'),
  'https://dl.rockylinux.org/pub/rocky/10/images/aarch64/CHECKSUM': `SHA256 (Rocky-10-GenericCloud-Base-10.2-20260525.0.aarch64.qcow2) = ${h('d')}`,
  'https://fedoraproject.org/releases.json': JSON.stringify([
    {
      version: '45 Beta',
      arch: 'x86_64',
      link: 'https://download.fedoraproject.org/pub/fedora/linux/releases/test/45_Beta/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-45_Beta-1.3.x86_64.qcow2',
      variant: 'Cloud',
      sha256: h('e'),
    },
    {
      version: '44',
      arch: 'x86_64',
      link: 'https://download.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-44-1.7.x86_64.qcow2',
      variant: 'Cloud',
      sha256: h('f'),
    },
    {
      version: '44',
      arch: 'aarch64',
      link: 'https://download.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/aarch64/images/Fedora-Cloud-Base-Generic-44-1.7.aarch64.qcow2',
      variant: 'Cloud',
      sha256: h('0'),
    },
    {
      version: '43',
      arch: 'x86_64',
      link: 'https://download.fedoraproject.org/pub/fedora/linux/releases/43/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-43-1.6.x86_64.qcow2',
      variant: 'Cloud',
      sha256: h('1'),
    },
  ]),
  'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/cloud/': [
    '<a href="alpine-3.24.2-x86_64-cloudinit-r2.qcow2">',
    '<a href="alpine-3.24.3-x86_64-cloudinit-r0.qcow2">',
    '<a href="alpine-3.24.3-x86_64-cloudinit-metal-r0.qcow2">',
    '<a href="alpine-3.24.3-aarch64-cloudinit-r0.qcow2">',
    '<a href="generic_alpine-3.24.1-x86_64-uefi-cloudinit-r0.qcow2">',
  ].join('\n'),
  'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/alpine-3.24.3-x86_64-cloudinit-r0.qcow2.sha512': `${h('2', 128)}\n`,
  'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/alpine-3.24.3-aarch64-cloudinit-r0.qcow2.sha512': `${h('3', 128)}  alpine-3.24.3-aarch64-cloudinit-r0.qcow2\n`,
};

const get = async (url: string) => {
  if (!(url in UPSTREAM)) throw new Error(`unexpected ${url}`);

  return UPSTREAM[url];
};
const line = (id: string) => UPSTREAM_LINES.find((l) => l.id === id)!;

describe('VM image catalog: upstream lines (3.42)', () => {
  it('parses checksum lists in both notations', () => {
    expect(
      parseChecksumList(UPSTREAM['https://dl.rockylinux.org/pub/rocky/10/images/x86_64/CHECKSUM'], 'sha256'),
    ).toEqual(
      new Map([
        ['Rocky-10-GenericCloud-Base-10.2-20260525.0.x86_64.qcow2', h('c')],
        ['Rocky-10-GenericCloud-Base.latest.x86_64.qcow2', h('c')],
      ]),
    );
    expect(parseChecksumList(`${h('A')} *x.img\nnot a line\n${h('b', 128)}  y.img`, 'sha256')).toEqual(
      new Map([['x.img', h('a')]]),
    );
    expect(parseUbuntuSerial('suite=noble\n')).toBeNull();
    expect(latestDebianBuild('<a href="latest/">')).toBeNull();
    expect(compareBuilds('20261012.0', '20261005')).toBeGreaterThan(0);
    expect(compareBuilds('3.24.10', '3.24.9')).toBeGreaterThan(0);
  });

  it('pins Ubuntu to the dated release directory of the current serial', async () => {
    expect(await line('ubuntu-24.04').lookup(get)).toEqual([
      {
        distro: 'ubuntu',
        label: 'Ubuntu 24.04 LTS',
        version: '24.04',
        arch: 'amd64',
        url: 'https://cloud-images.ubuntu.com/releases/noble/release-20261017/ubuntu-24.04-server-cloudimg-amd64.img',
        checksum: { algorithm: 'sha256', value: h('1') },
        firmware: ['uefi', 'bios'],
        guestAgent: false,
        build: '20261017',
      },
      expect.objectContaining({ arch: 'arm64', firmware: ['uefi'], checksum: { algorithm: 'sha256', value: h('2') } }),
    ]);
  });

  it('reads Debian genericcloud images of the newest build with their SHA-512', async () => {
    expect(await line('debian-13').lookup(get)).toEqual([
      expect.objectContaining({
        version: '13',
        arch: 'amd64',
        build: '20261026-2643',
        url: 'https://cloud.debian.org/images/cloud/trixie/20261026-2643/debian-13-genericcloud-amd64-20261026-2643.qcow2',
        checksum: { algorithm: 'sha512', value: h('4', 128) },
      }),
      expect.objectContaining({ arch: 'arm64', checksum: { algorithm: 'sha512', value: h('5', 128) } }),
    ]);
  });

  it('takes the newest AlmaLinux / Rocky build and pins it to the minor version path', async () => {
    expect(await line('almalinux-9').lookup(get)).toEqual([
      expect.objectContaining({
        label: 'AlmaLinux 9.8',
        version: '9.8',
        build: '20261005',
        url: 'https://repo.almalinux.org/almalinux/9.8/cloud/x86_64/images/AlmaLinux-9-GenericCloud-9.8-20261005.x86_64.qcow2',
        checksum: { algorithm: 'sha256', value: h('8') },
        guestAgent: true,
      }),
      expect.objectContaining({ arch: 'arm64', checksum: { algorithm: 'sha256', value: h('b') } }),
    ]);
    expect(await line('rocky-10').lookup(get)).toEqual([
      expect.objectContaining({
        version: '10.2',
        build: '20260525.0',
        url: 'https://dl.rockylinux.org/pub/rocky/10.2/images/x86_64/Rocky-10-GenericCloud-Base-10.2-20260525.0.x86_64.qcow2',
      }),
      expect.objectContaining({ arch: 'arm64', checksum: { algorithm: 'sha256', value: h('d') } }),
    ]);
  });

  it('reads the newest stable Fedora release, pinned to the primary mirror', async () => {
    expect(await line('fedora').lookup(get)).toEqual([
      expect.objectContaining({
        version: '44',
        arch: 'amd64',
        build: '1.7',
        url: 'https://dl.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-44-1.7.x86_64.qcow2',
        checksum: { algorithm: 'sha256', value: h('f') },
      }),
      expect.objectContaining({ version: '44', arch: 'arm64' }),
    ]);
    expect(() => parseFedoraReleases('{}')).toThrow('not a list');
    expect(
      parseFedoraReleases(
        JSON.stringify([
          {
            version: '44',
            link: 'https://evil.example.com/Fedora-Cloud-Base-Generic-44-1.7.x86_64.qcow2',
            sha256: h('1'),
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('reads the newest Alpine cloud-init qcow2 per arch with its .sha512', async () => {
    expect(latestAlpineImages(UPSTREAM['https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/cloud/'])).toEqual(
      [
        { arch: 'amd64', file: 'alpine-3.24.3-x86_64-cloudinit-r0.qcow2', version: '3.24.3', build: 'r0' },
        { arch: 'arm64', file: 'alpine-3.24.3-aarch64-cloudinit-r0.qcow2', version: '3.24.3', build: 'r0' },
      ],
    );
    expect(await line('alpine').lookup(get)).toEqual([
      expect.objectContaining({
        url: 'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/alpine-3.24.3-x86_64-cloudinit-r0.qcow2',
        checksum: { algorithm: 'sha512', value: h('2', 128) },
      }),
      expect.objectContaining({ arch: 'arm64', checksum: { algorithm: 'sha512', value: h('3', 128) } }),
    ]);
  });

  it('only reads hard-coded https sources of the official publishers', async () => {
    const requested: string[] = [];

    await Promise.allSettled(UPSTREAM_LINES.map((l) => l.lookup(async (url) => (requested.push(url), await get(url)))));

    expect(UPSTREAM_LINES).toHaveLength(10);
    expect(new Set(requested.map((url) => new URL(url).origin))).toEqual(
      new Set([
        'https://cloud-images.ubuntu.com',
        'https://cloud.debian.org',
        'https://repo.almalinux.org',
        'https://dl.rockylinux.org',
        'https://fedoraproject.org',
        'https://dl-cdn.alpinelinux.org',
      ]),
    );
  });
});
