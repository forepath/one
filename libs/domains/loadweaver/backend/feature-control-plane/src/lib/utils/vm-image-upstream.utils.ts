import type {
  VmFirmware,
  VmImageArch,
  VmImageCatalogEntry,
  VmImageChecksumAlgorithm,
} from '@forepath/loadweaver/shared/util-model';

/**
 * Live "other versions" lookup of the VM image catalog (3.42): per distro line an allow-listed, hard-coded set of
 * official https sources (never a user-provided URL). Each line reads the publisher's current build index and its
 * checksum list and returns the current builds with the published checksum, pinned to their dated URLs.
 */

/** Reads a small text document (the service enforces https, the SSRF check per hop, a timeout and a size cap). */
export type UpstreamGet = (url: string) => Promise<string>;

export type UpstreamImage = Omit<VmImageCatalogEntry, 'id' | 'source' | 'suggestedRef'> & { build: string };

export interface UpstreamLine {
  /** `ubuntu-24.04`, `fedora`, … (named in warnings). */
  id: string;
  lookup(get: UpstreamGet): Promise<UpstreamImage[]>;
}

const ARCHES: readonly { arch: VmImageArch; name: string }[] = [
  { arch: 'amd64', name: 'x86_64' },
  { arch: 'arm64', name: 'aarch64' },
];

/** amd64 cloud images of these lines boot with both firmwares; arm64 is UEFI only. */
const firmwareOf = (arch: VmImageArch): VmFirmware[] => (arch === 'amd64' ? ['uefi', 'bios'] : ['uefi']);

const HEX: Record<VmImageChecksumAlgorithm, RegExp> = { sha256: /^[0-9a-f]{64}$/, sha512: /^[0-9a-f]{128}$/ };

/**
 * A checksum list (`SHA256SUMS` / `SHA512SUMS`: `<hex> [*]<file>`; `CHECKSUM`: `SHA256 (<file>) = <hex>`, also inside
 * a PGP clear-signed message) as file name → lower-case hex of the given algorithm.
 */
export function parseChecksumList(text: string, algorithm: VmImageChecksumAlgorithm): Map<string, string> {
  const sums = new Map<string, string>();
  const bsd = new RegExp(`^${algorithm.toUpperCase()} \\(([^()\\s]+)\\) = ([0-9a-fA-F]+)$`);

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const tagged = bsd.exec(line);
    const plain = /^([0-9a-fA-F]+)\s+\*?(\S+)$/.exec(line);
    const [file, hex] = tagged ? [tagged[1], tagged[2]] : plain ? [plain[2], plain[1]] : [null, null];

    if (file && hex && HEX[algorithm].test(hex.toLowerCase())) sums.set(file, hex.toLowerCase());
  }

  return sums;
}

/** `serial=20261017` of Ubuntu's `release/unpacked/build-info.txt`; null when missing. */
export function parseUbuntuSerial(text: string): string | null {
  return /^serial=(\d{8}(?:\.\d{1,2})?)$/m.exec(text)?.[1] ?? null;
}

/** The newest dated build directory (`20261026-2643/`) of a Debian cloud image index page; null when none. */
export function latestDebianBuild(html: string): string | null {
  const builds = [...html.matchAll(/href="(\d{8}-\d{1,6})\/"/g)].map((m) => m[1]);

  return builds.sort(compareBuilds).at(-1) ?? null;
}

/** Orders dotted / dashed numeric build ids (`20261012.0`, `20261026-2643`, `3.24.3`) numerically per part. */
export function compareBuilds(a: string, b: string): number {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? -1) - (pb[i] ?? -1);

    if (diff !== 0) return diff;
  }

  return 0;
}

/** The newest file per arch of a checksum list whose name matches `pattern` (groups: `version`, `build`). */
function newestPerArch(
  sums: Map<string, string>,
  pattern: (arch: string) => RegExp,
  arch: string,
): { file: string; hex: string; version: string; build: string } | null {
  let best: { file: string; hex: string; version: string; build: string } | null = null;

  for (const [file, hex] of sums) {
    const groups = pattern(arch).exec(file)?.groups;

    if (!groups) continue;

    const candidate = { file, hex, version: groups['version'], build: groups['build'] };

    if (
      !best ||
      compareBuilds(candidate.version, best.version) > 0 ||
      (compareBuilds(candidate.version, best.version) === 0 && compareBuilds(candidate.build, best.build) > 0)
    )
      best = candidate;
  }

  return best;
}

function ubuntu(codename: string, version: string): UpstreamLine {
  const base = `https://cloud-images.ubuntu.com/releases/${codename}`;

  return {
    id: `ubuntu-${version}`,
    async lookup(get) {
      const serial = parseUbuntuSerial(await get(`${base}/release/unpacked/build-info.txt`));

      if (!serial) throw new Error('no build serial in build-info.txt');

      const sums = parseChecksumList(await get(`${base}/release-${serial}/SHA256SUMS`), 'sha256');

      return ARCHES.flatMap(({ arch }) => {
        const file = `ubuntu-${version}-server-cloudimg-${arch}.img`;
        const hex = sums.get(file);

        return hex
          ? [
              {
                distro: 'ubuntu',
                label: `Ubuntu ${version} LTS`,
                version,
                arch,
                url: `${base}/release-${serial}/${file}`,
                checksum: { algorithm: 'sha256' as const, value: hex },
                firmware: firmwareOf(arch),
                guestAgent: false,
                build: serial,
              },
            ]
          : [];
      });
    },
  };
}

function debian(codename: string, version: string): UpstreamLine {
  const base = `https://cloud.debian.org/images/cloud/${codename}`;

  return {
    id: `debian-${version}`,
    async lookup(get) {
      const build = latestDebianBuild(await get(`${base}/`));

      if (!build) throw new Error('no dated build in the image index');

      const sums = parseChecksumList(await get(`${base}/${build}/SHA512SUMS`), 'sha512');

      return ARCHES.flatMap(({ arch }) => {
        const file = `debian-${version}-genericcloud-${arch}-${build}.qcow2`;
        const hex = sums.get(file);

        return hex
          ? [
              {
                distro: 'debian',
                label: `Debian ${version} (${codename})`,
                version,
                arch,
                url: `${base}/${build}/${file}`,
                checksum: { algorithm: 'sha512' as const, value: hex },
                firmware: firmwareOf(arch),
                guestAgent: false,
                build,
              },
            ]
          : [];
      });
    },
  };
}

/** AlmaLinux / Rocky Linux: one `CHECKSUM` per arch under the major version, pinned to the minor version's path. */
function rhel(distro: 'almalinux' | 'rocky', major: number): UpstreamLine {
  const name = distro === 'almalinux' ? 'AlmaLinux' : 'Rocky Linux';
  const root = distro === 'almalinux' ? 'https://repo.almalinux.org/almalinux' : 'https://dl.rockylinux.org/pub/rocky';
  const dir = (release: string | number, arch: string) =>
    distro === 'almalinux' ? `${root}/${release}/cloud/${arch}/images` : `${root}/${release}/images/${arch}`;
  const pattern = (arch: string) =>
    distro === 'almalinux'
      ? new RegExp(
          `^AlmaLinux-${major}-GenericCloud-(?<version>${major}\\.\\d+)-(?<build>\\d{8}(?:\\.\\d+)?)\\.${arch}\\.qcow2$`,
        )
      : new RegExp(
          `^Rocky-${major}-GenericCloud-Base-(?<version>${major}\\.\\d+)-(?<build>\\d{8}\\.\\d+)\\.${arch}\\.qcow2$`,
        );

  return {
    id: `${distro}-${major}`,
    async lookup(get) {
      const images: UpstreamImage[] = [];

      for (const { arch, name: upstreamArch } of ARCHES) {
        const sums = parseChecksumList(await get(`${dir(major, upstreamArch)}/CHECKSUM`), 'sha256');
        const newest = newestPerArch(sums, pattern, upstreamArch);

        if (!newest) continue;

        images.push({
          distro,
          label: `${name} ${newest.version}`,
          version: newest.version,
          arch,
          url: `${dir(newest.version, upstreamArch)}/${newest.file}`,
          checksum: { algorithm: 'sha256', value: newest.hex },
          firmware: firmwareOf(arch),
          guestAgent: true,
          build: newest.build,
        });
      }

      return images;
    },
  };
}

const FEDORA_LINK =
  /^https:\/\/download\.fedoraproject\.org\/pub\/fedora\/linux\/releases\/(\d+)\/Cloud\/(x86_64|aarch64)\/images\/(Fedora-Cloud-Base-Generic-\d+-(\d+(?:\.\d+)*)\.(?:x86_64|aarch64)\.qcow2)$/;

/**
 * Fedora's published release list (`releases.json`: every image with its SHA-256): the newest stable release's
 * Cloud Base Generic images, pinned to the primary mirror (`dl.fedoraproject.org`, https; the download redirector
 * may hand out plain-http mirrors).
 */
export function parseFedoraReleases(text: string): UpstreamImage[] {
  const releases = JSON.parse(text) as unknown;

  if (!Array.isArray(releases)) throw new Error('releases.json is not a list');

  const images = releases.flatMap((r: Record<string, unknown>) => {
    const match = typeof r?.['link'] === 'string' ? FEDORA_LINK.exec(r['link']) : null;
    const sha256 = typeof r?.['sha256'] === 'string' ? r['sha256'].toLowerCase() : '';

    if (!match || !/^\d+$/.test(String(r['version'])) || match[1] !== String(r['version']) || !HEX.sha256.test(sha256))
      return [];

    const arch: VmImageArch = match[2] === 'x86_64' ? 'amd64' : 'arm64';

    return [
      {
        distro: 'fedora',
        label: `Fedora ${match[1]} Cloud`,
        version: match[1],
        arch,
        url: `https://dl.fedoraproject.org/pub/fedora/linux/releases/${match[1]}/Cloud/${match[2]}/images/${match[3]}`,
        checksum: { algorithm: 'sha256' as const, value: sha256 },
        firmware: firmwareOf(arch),
        guestAgent: true,
        build: match[4],
      },
    ];
  });
  const newest = images.map((i) => Number(i.version)).reduce((a, b) => Math.max(a, b), 0);

  return images.filter((i) => Number(i.version) === newest).sort((a, b) => a.arch.localeCompare(b.arch));
}

/** The newest `alpine-<x.y.z>-<arch>-cloudinit-r<n>.qcow2` per arch of Alpine's cloud image index page. */
export function latestAlpineImages(
  html: string,
): { arch: VmImageArch; file: string; version: string; build: string }[] {
  const found = [...html.matchAll(/href="(alpine-(\d+\.\d+\.\d+)-(x86_64|aarch64)-cloudinit-r(\d+)\.qcow2)"/g)];

  return ARCHES.flatMap(({ arch, name }) => {
    const newest = found
      .filter((m) => m[3] === name)
      .sort((a, b) => compareBuilds(a[2], b[2]) || Number(a[4]) - Number(b[4]))
      .at(-1);

    return newest ? [{ arch, file: newest[1], version: newest[2], build: `r${newest[4]}` }] : [];
  });
}

const alpine: UpstreamLine = {
  id: 'alpine',
  async lookup(get) {
    const latest = latestAlpineImages(await get('https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/cloud/'));
    const images: UpstreamImage[] = [];

    for (const image of latest) {
      const base = `https://dl-cdn.alpinelinux.org/alpine/v${image.version.split('.').slice(0, 2).join('.')}/releases/cloud`;
      const hex = /^([0-9a-fA-F]{128})(?:\s|$)/.exec((await get(`${base}/${image.file}.sha512`)).trim())?.[1];

      if (!hex) continue;

      images.push({
        distro: 'alpine',
        label: `Alpine Linux ${image.version}`,
        version: image.version,
        arch: image.arch,
        url: `${base}/${image.file}`,
        checksum: { algorithm: 'sha512', value: hex.toLowerCase() },
        firmware: firmwareOf(image.arch),
        guestAgent: false,
        build: image.build,
      });
    }

    return images;
  },
};

const fedora: UpstreamLine = {
  id: 'fedora',
  async lookup(get) {
    return parseFedoraReleases(await get('https://fedoraproject.org/releases.json'));
  },
};

/** Every line of the live lookup (the shipped catalog's lines). */
export const UPSTREAM_LINES: readonly UpstreamLine[] = [
  ubuntu('noble', '24.04'),
  ubuntu('jammy', '22.04'),
  debian('trixie', '13'),
  debian('bookworm', '12'),
  rhel('almalinux', 9),
  rhel('almalinux', 10),
  rhel('rocky', 9),
  rhel('rocky', 10),
  fedora,
  alpine,
];
