import { createHash } from 'node:crypto';

/**
 * The frozen-index apt source on the control plane (3.26): at plan time the control plane snapshots `InRelease` and
 * the `Packages` indexes of each upstream source and serves exactly those bytes to the nodes; package files come
 * from the object store (fetched once from the upstream archive on the first request, or from a bundle). apt on the
 * node verifies everything itself: the `InRelease` signature with the distribution's keyring, the indexes against
 * `InRelease`, every `.deb` against the index — so the control plane can't alter what gets installed, and every node
 * of a rollout installs identical versions.
 */

/** A node's OS as `<id>:<versionId>` (the bundle's package pins and apt sources are keyed by it). */
export function hostOs(os: { id: string; versionId: string } | null | undefined): string | null {
  return os ? `${os.id}:${os.versionId}` : null;
}

export interface AptUpstream {
  name: string;
  url: string;
  suites: string[];
  components: string[];
  arches: string[];
  keyring: string;
  os: string;
}

/** Upstream archives per supported OS; `LOADWEAVER_APT_SOURCES` (JSON, same shape) replaces them (mirrors). */
export function defaultAptUpstreams(os: string, arch: string): AptUpstream[] {
  const debian = (codename: string): AptUpstream[] => [
    {
      name: `debian-${codename}`,
      url: 'https://deb.debian.org/debian',
      suites: [codename, `${codename}-updates`],
      components: ['main'],
      arches: [arch],
      keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
      os,
    },
    {
      name: `debian-security-${codename}`,
      url: 'https://security.debian.org/debian-security',
      suites: [`${codename}-security`],
      components: ['main'],
      arches: [arch],
      keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
      os,
    },
    {
      name: `docker-debian-${codename}`,
      url: 'https://download.docker.com/linux/debian',
      suites: [codename],
      components: ['stable'],
      arches: [arch],
      keyring: '/etc/apt/keyrings/docker.gpg',
      os,
    },
  ];
  const ubuntu = (codename: string): AptUpstream[] => {
    const archive = arch === 'amd64' ? 'http://archive.ubuntu.com/ubuntu' : 'http://ports.ubuntu.com/ubuntu-ports';
    const security = arch === 'amd64' ? 'http://security.ubuntu.com/ubuntu' : 'http://ports.ubuntu.com/ubuntu-ports';
    const suffix = arch === 'amd64' ? '' : '-ports';

    return [
      {
        name: `ubuntu${suffix}-${codename}`,
        url: archive,
        suites: [codename, `${codename}-updates`],
        components: ['main', 'universe'],
        arches: [arch],
        keyring: '/usr/share/keyrings/ubuntu-archive-keyring.gpg',
        os,
      },
      {
        name: `ubuntu${suffix}-security-${codename}`,
        url: security,
        suites: [`${codename}-security`],
        components: ['main', 'universe'],
        arches: [arch],
        keyring: '/usr/share/keyrings/ubuntu-archive-keyring.gpg',
        os,
      },
      {
        name: `docker-ubuntu-${codename}`,
        url: 'https://download.docker.com/linux/ubuntu',
        suites: [codename],
        components: ['stable'],
        arches: [arch],
        keyring: '/etc/apt/keyrings/docker.gpg',
        os,
      },
    ];
  };

  switch (os) {
    case 'debian:13':
      return debian('trixie');
    case 'debian:12':
      return debian('bookworm');
    case 'ubuntu:24.04':
      return ubuntu('noble');
    case 'ubuntu:22.04':
      return ubuntu('jammy');
    default:
      return [];
  }
}

/** Upstreams for the OS / architecture combinations in the cluster, merged by name (architectures combined). */
export function aptUpstreams(
  hosts: readonly { os: string; arch: string }[],
  override: string | undefined = process.env['LOADWEAVER_APT_SOURCES'],
): AptUpstream[] {
  if (override) {
    const parsed = JSON.parse(override) as AptUpstream[];

    for (const u of parsed) validateUpstream(u);

    return parsed;
  }

  const byName = new Map<string, AptUpstream>();

  for (const host of hosts)
    for (const upstream of defaultAptUpstreams(host.os, host.arch)) {
      const existing = byName.get(upstream.name);

      if (existing) existing.arches = [...new Set([...existing.arches, ...upstream.arches])].sort();
      else byName.set(upstream.name, { ...upstream, arches: [...upstream.arches] });
    }

  return [...byName.values()];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SUITE = /^[a-z0-9][a-z0-9.-]{0,40}$/;

export function validateUpstream(u: AptUpstream): void {
  if (!NAME.test(u.name)) throw new Error(`invalid apt source name ${u.name}`);

  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/.test(u.url))
    throw new Error(`invalid apt URL ${u.url}`);

  for (const s of [...u.suites, ...u.components]) if (!SUITE.test(s)) throw new Error(`invalid suite / component ${s}`);

  for (const a of u.arches) if (!/^(amd64|arm64|all)$/.test(a)) throw new Error(`invalid architecture ${a}`);
}

/** `<sha256> <size> <path>` lines of the `SHA256:` section of an `InRelease` / `Release` file. */
export function releaseChecksums(inRelease: string): { sha256: string; size: number; path: string }[] {
  const out: { sha256: string; size: number; path: string }[] = [];
  let inSection = false;

  for (const line of inRelease.split(/\r?\n/)) {
    if (/^SHA256:\s*$/.test(line)) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    const match = /^ ([0-9a-f]{64})\s+(\d+)\s+(\S+)$/.exec(line);

    if (!match) {
      if (!line.startsWith(' ')) inSection = false;

      continue;
    }

    out.push({ sha256: match[1], size: Number(match[2]), path: match[3] });
  }

  return out;
}

/** Whether the release uses by-hash paths (`Acquire-By-Hash: yes`). */
export function acquireByHash(inRelease: string): boolean {
  return /^Acquire-By-Hash:\s*yes\s*$/im.test(inRelease);
}

/**
 * The index files of a suite to freeze: `Packages` of the wanted components / architectures, compressed variants
 * only when there are any (apt picks a compressed one first), never translations / contents (apt is told to skip them).
 */
export function indexFiles(
  checksums: readonly { sha256: string; size: number; path: string }[],
  components: readonly string[],
  arches: readonly string[],
): { sha256: string; size: number; path: string }[] {
  const out: { sha256: string; size: number; path: string }[] = [];

  for (const component of components)
    for (const arch of arches) {
      const prefix = `${component}/binary-${arch}/`;
      const variants = checksums.filter(
        (c) => c.path.startsWith(prefix) && /\/(Packages(\.xz|\.gz)?|Release)$/.test(c.path),
      );
      const compressed = variants.filter((c) => /Packages\.(xz|gz)$/.test(c.path));

      out.push(...variants.filter((c) => !/\/Packages$/.test(c.path) || compressed.length === 0));
    }

  return out;
}

const POOL = /^pool\/[A-Za-z0-9._+-]+(\/[A-Za-z0-9._+~-]+){2,4}\.(deb|udeb)$/;
const DIST =
  /^dists\/[a-z0-9.-]+\/(InRelease|Release|Release\.gpg|[a-z0-9-]+\/binary-[a-z0-9]+\/(Packages(\.xz|\.gz)?|Release|by-hash\/SHA256\/[0-9a-f]{64}))$/;

/** What a node asks for below `<snapshot>/<source>/`: an index of the snapshot, or a package from the pool. */
export function classifyAptPath(path: string): { kind: 'dist' | 'pool'; byHash?: string } | null {
  if (path.includes('..') || path.includes('//')) return null;

  if (POOL.test(path)) return { kind: 'pool' };

  if (DIST.test(path)) {
    const byHash = /by-hash\/SHA256\/([0-9a-f]{64})$/.exec(path);

    return byHash ? { kind: 'dist', byHash: byHash[1] } : { kind: 'dist' };
  }

  return null;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A snapshot id: `s-<UTC timestamp>-<suffix>` (lower case, safe in URLs and file names). */
export function snapshotId(now: Date, suffix: string): string {
  return `s-${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${suffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)}`;
}
