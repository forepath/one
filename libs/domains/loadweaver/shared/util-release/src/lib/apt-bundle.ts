import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  defaultAptFetch,
  frozenPackagesIndexes,
  takeSnapshot,
  type AptFetchImpl,
  type BlobStore,
  type PoolIndex,
} from './apt-snapshot.core';
import { aptUpstreams, snapshotId, validateUpstream, type AptUpstream } from './apt-snapshot.utils';
import { artifactPathSchema, sha256HexSchema, SUPPORTED_HOST_OS } from './manifest';
import { PACKAGE_PINS, REQUIRED_HOST_PACKAGES } from './pins';
import { readTar, TAR_END, tarHeader, tarPadding } from './tar';

/**
 * The apt snapshot a release bundle carries for air-gapped clusters (3.26: "OS packages go through a cluster-local apt
 * cache", "air-gapped clusters import a bundle as a single file"). At bundle build time the indexes of every supported
 * OS release / architecture are frozen (`takeSnapshot`), the packages a Loadweaver node installs or updates are
 * selected from them (`selectAptPackages`: base system, Loadweaver's host packages, kernel + headers and the DRBD build
 * tools, with their dependency closure, newest version — or the release's pin), fetched by the checksum the index
 * names and packed per OS into `artifacts/apt/packages-<os>.tar` (members named by their SHA-256, each blob once
 * across the bundle). The packs are artifacts of the manifest (`aptPackages`), so the release signature covers them;
 * the index (`aptSnapshot`) names every member with its checksum, and apt on the node verifies each package against
 * the frozen `Packages` index (signed by the distribution) anyway. The control plane unpacks the packs into its
 * artifact store on import and serves the snapshot from there without asking upstream (`importAptBundlePacks`).
 *
 * The manifest itself lists only the packs, not every package: it is sent to every node with each release target
 * (≤ 1 MiB in the agent protocol) and an N-1 control plane accepts at most 512 artifacts.
 */

/** One package file of the bundled snapshot: the source's pool path, checksum and size. */
export const aptBundlePoolEntrySchema = z
  .object({
    source: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
    path: z
      .string()
      .max(400)
      .regex(/^pool\/[A-Za-z0-9._+-]+(\/[A-Za-z0-9._+~-]+){2,4}\.(deb|udeb)$/),
    sha256: sha256HexSchema,
    size: z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 ** 3),
  })
  .strict();
export type AptBundlePoolEntry = z.infer<typeof aptBundlePoolEntrySchema>;

const aptUpstreamSchema = z
  .object({
    name: z.string(),
    url: z.string(),
    suites: z.array(z.string()).max(8),
    components: z.array(z.string()).max(8),
    arches: z.array(z.string()).max(4),
    keyring: z.string().max(200),
    os: z.string().max(32),
  })
  .strict()
  .superRefine((u, ctx) => {
    try {
      validateUpstream(u);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) });
    }
  });

/** `artifacts/apt/snapshot.json` of a bundle: the frozen indexes and the package files the packs carry. */
export const aptBundleIndexSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    sources: z.array(aptUpstreamSchema).min(1).max(64),
    /** `<source>/dists/<suite>/<path>` → frozen index file. */
    files: z.record(z.string().max(400), z.object({ sha256: sha256HexSchema, size: z.number().int().min(0) }).strict()),
    pool: z.array(aptBundlePoolEntrySchema).max(100_000).default([]),
  })
  .strict()
  .superRefine((index, ctx) => {
    const names = new Set(index.sources.map((s) => s.name));

    for (const key of Object.keys(index.files))
      if (!names.has(key.split('/')[0]) || !/^[^/]+\/dists\//.test(key))
        ctx.addIssue({ code: 'custom', message: `index file ${key} belongs to no source` });

    for (const entry of index.pool)
      if (!names.has(entry.source))
        ctx.addIssue({ code: 'custom', message: `pool file ${entry.path} names unknown source ${entry.source}` });
  });
export type AptBundleIndex = z.infer<typeof aptBundleIndexSchema>;

/** Path of a bundle's package pack for one OS (`debian:13` → `artifacts/apt/packages-debian-13.tar`). */
export function aptPackPath(os: string): string {
  return artifactPathSchema.parse(`artifacts/apt/packages-${os.replace(/[^a-z0-9.]/g, '-')}.tar`);
}

// ---------------------------------------------------------------------------------------------------------------
// Debian versions and control stanzas

function order(c: string): number {
  if (c === '~') return -1;

  if (c === '') return 0;

  if (/[A-Za-z]/.test(c)) return c.charCodeAt(0);

  return c.charCodeAt(0) + 256;
}

function comparePart(a: string, b: string): number {
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    let first = 0;

    while ((i < a.length && !/\d/.test(a[i])) || (j < b.length && !/\d/.test(b[j]))) {
      const ac = i < a.length && !/\d/.test(a[i]) ? a[i] : '';
      const bc = j < b.length && !/\d/.test(b[j]) ? b[j] : '';
      const diff = order(ac) - order(bc);

      if (diff) return diff;

      if (ac) i++;

      if (bc) j++;
    }

    while (a[i] === '0') i++;

    while (b[j] === '0') j++;

    while (i < a.length && /\d/.test(a[i]) && j < b.length && /\d/.test(b[j])) {
      if (!first) first = a.charCodeAt(i) - b.charCodeAt(j);

      i++;
      j++;
    }

    if (i < a.length && /\d/.test(a[i])) return 1;

    if (j < b.length && /\d/.test(b[j])) return -1;

    if (first) return first;
  }

  return 0;
}

/** dpkg's version comparison (`epoch:upstream-revision`, `~` sorts before everything): < 0, 0 or > 0. */
export function compareDebianVersions(a: string, b: string): number {
  const split = (v: string) => {
    const colon = v.indexOf(':');
    const epoch = colon > 0 ? Number(v.slice(0, colon)) : 0;
    const rest = colon > 0 ? v.slice(colon + 1) : v;
    const dash = rest.lastIndexOf('-');

    return { epoch, upstream: dash >= 0 ? rest.slice(0, dash) : rest, revision: dash >= 0 ? rest.slice(dash + 1) : '' };
  };
  const x = split(a);
  const y = split(b);

  if (x.epoch !== y.epoch) return x.epoch - y.epoch;

  return comparePart(x.upstream, y.upstream) || comparePart(x.revision, y.revision);
}

/** Splits a control file (`Packages`) into stanzas of field → value (continuation lines joined). */
export function parseControlStanzas(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];

  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const stanza: Record<string, string> = {};
    let last: string | null = null;

    for (const line of block.split(/\r?\n/)) {
      if (/^[ \t]/.test(line) && last) stanza[last] += `\n${line.trim()}`;
      else {
        const match = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line);

        if (match) stanza[(last = match[1])] = match[2].trim();
      }
    }

    if (Object.keys(stanza).length) out.push(stanza);
  }

  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Package selection

/**
 * The packages a Loadweaver node installs or updates (besides `Priority: required / important`, the base system every
 * host has): Loadweaver's host packages (installer + pins), what a cloud host runs, kernel and headers metapackages
 * (the kernels `dist-upgrade` brings, matching `drbd-compat.sh`) and the DRBD build tools. Roots an archive doesn't
 * have are skipped (reported by the builder).
 */
export function bundleAptRoots(os: string, arch: string): string[] {
  const pinned = Object.values(PACKAGE_PINS).flatMap((pins) => Object.keys(pins[os as 'debian:13'] ?? {}));
  const [id, version] = os.split(':');
  const kernels =
    id === 'debian'
      ? [`linux-image-${arch}`, `linux-image-cloud-${arch}`, `linux-headers-${arch}`, `linux-headers-cloud-${arch}`]
      : [
          'linux-image-generic',
          'linux-image-virtual',
          'linux-headers-generic',
          'linux-headers-virtual',
          `linux-image-generic-hwe-${version}`,
          `linux-image-virtual-hwe-${version}`,
          `linux-headers-generic-hwe-${version}`,
          `linux-headers-virtual-hwe-${version}`,
          // KVM host preparation (3.1): Ubuntu's KVM modules may live in `linux-modules-extra-<abi>`. These
          // metapackages pull it for exactly the kernels the snapshot carries, so node agents install it from the
          // snapshot together with the kernel (never from upstream). Debian ships KVM in `linux-image-*`.
          'linux-image-extra-virtual',
          `linux-image-extra-virtual-hwe-${version}`,
        ];

  return [
    ...new Set([
      // The installer's packages (install-script.utils.ts) and the pinned ones.
      ...['ca-certificates', 'curl', 'gnupg', 'jq', 'iproute2', 'wireguard-tools', 'nftables', 'bird2', 'keepalived'],
      ...['rsync', 'lvm2', 'cryptsetup', 'drbd-utils', 'thin-provisioning-tools', 'docker-ce', 'docker-ce-cli'],
      ...['containerd.io', 'criu', ...pinned],
      // Required host packages (the microVM guest-root cache, 3.35: setfattr, mkfs.ext4): host updates install
      // missing ones from the snapshot, so air-gapped (bundle) snapshots must carry them.
      ...REQUIRED_HOST_PACKAGES,
      // A cloud host.
      ...['openssh-server', 'sudo', 'kmod', 'cloud-init', 'grub-common', 'initramfs-tools'],
      // DRBD built from source on the node (headers come with the kernel's headers metapackage).
      ...['gcc', 'make', 'perl', 'patch', 'diffutils', 'mokutil'],
      ...kernels,
    ]),
  ];
}

interface Candidate {
  source: string;
  stanza: Record<string, string>;
}

const DEPENDENCY_FIELDS = ['Pre-Depends', 'Depends', 'Recommends'] as const;

/** `a (>= 1) | b:any, c [amd64]` → `[['a', 'b'], ['c']]`. */
function dependencyGroups(value: string | undefined): string[][] {
  if (!value) return [];

  return value
    .split(',')
    .map((group) =>
      group
        .split('|')
        .map((alt) =>
          alt
            .replace(/\([^)]*\)|\[[^\]]*\]|<[^>]*>/g, '')
            .trim()
            .replace(/:[a-z0-9-]+$/, ''),
        )
        .filter((name) => /^[a-z0-9][a-z0-9.+-]*$/.test(name)),
    )
    .filter((alts) => alts.length > 0);
}

export interface AptSelection {
  pool: AptBundlePoolEntry[];
  /** Selected packages `name=version` (sorted; for the build log). */
  packages: string[];
  /** Roots no source has. */
  missingRoots: string[];
  /** Dependencies nothing satisfies (`package: dependency`). */
  unresolved: string[];
  /** Pins whose version no source has (the newest is taken instead). */
  missingPins: string[];
}

/**
 * Selects the package files a node of one OS release / architecture needs from the snapshot's `Packages` stanzas: the
 * roots, every `Priority: required / important` package, and their dependency closure (`Pre-Depends`, `Depends`,
 * `Recommends` — apt installs recommends by default; first satisfiable alternative; virtual packages through
 * `Provides`). Per package the newest version across the sources (what `dist-upgrade` installs), or the release's pin.
 */
export function selectAptPackages(
  candidates: readonly Candidate[],
  roots: readonly string[],
  pins: Record<string, string> = {},
): AptSelection {
  const byName = new Map<string, Candidate[]>();
  const providers = new Map<string, Set<string>>();

  for (const c of candidates) {
    const name = c.stanza['Package'];

    if (!name || !c.stanza['Version'] || !c.stanza['Filename'] || !c.stanza['SHA256']) continue;

    (byName.get(name) ?? byName.set(name, []).get(name))?.push(c);

    for (const [provided] of dependencyGroups(c.stanza['Provides']))
      (providers.get(provided) ?? providers.set(provided, new Set()).get(provided))?.add(name);
  }

  const missingPins: string[] = [];
  const candidate = (name: string): Candidate | undefined => {
    const all = byName.get(name);

    if (!all?.length) return undefined;

    const pin = pins[name];

    if (pin) {
      const pinned = all.find((c) => c.stanza['Version'] === pin);

      if (pinned) return pinned;

      missingPins.push(`${name}=${pin}`);
    }

    return [...all].sort((a, b) => compareDebianVersions(b.stanza['Version'], a.stanza['Version']))[0];
  };

  const selected = new Map<string, Candidate>();
  const unresolved: string[] = [];
  const missingRoots: string[] = [];
  const queue: string[] = [];
  const want = (name: string) => {
    if (selected.has(name)) return;

    const c = candidate(name);

    if (!c) return;

    selected.set(name, c);
    queue.push(name);
  };

  for (const root of roots) {
    if (byName.has(root)) want(root);
    else if (providers.has(root)) want([...(providers.get(root) as Set<string>)].sort()[0]);
    else missingRoots.push(root);
  }

  for (const [name, all] of [...byName.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
    if (all.some((c) => /^(required|important)$/.test(c.stanza['Priority'] ?? ''))) want(name);

  while (queue.length) {
    const name = queue.shift() as string;
    const stanza = (selected.get(name) as Candidate).stanza;

    for (const field of DEPENDENCY_FIELDS)
      for (const alts of dependencyGroups(stanza[field])) {
        if (alts.some((a) => selected.has(a))) continue;

        const real = alts.find((a) => byName.has(a));

        if (real) {
          want(real);
          continue;
        }

        const provided = alts.flatMap((a) => [...(providers.get(a) ?? [])].sort());
        const choice = provided.find((p) => selected.has(p)) ?? provided[0];

        if (choice) want(choice);
        else if (field !== 'Recommends') unresolved.push(`${name}: ${alts.join(' | ')}`);
      }
  }

  const pool = new Map<string, AptBundlePoolEntry>();

  for (const c of selected.values()) {
    const entry = aptBundlePoolEntrySchema.safeParse({
      source: c.source,
      path: c.stanza['Filename'],
      sha256: c.stanza['SHA256'].toLowerCase(),
      size: Number(c.stanza['Size']),
    });

    if (entry.success) pool.set(`${entry.data.source}\u0000${entry.data.path}`, entry.data);
  }

  return {
    pool: [...pool.values()].sort((a, b) =>
      a.source === b.source ? (a.path < b.path ? -1 : 1) : a.source < b.source ? -1 : 1,
    ),
    packages: [...selected.entries()].map(([n, c]) => `${n}=${c.stanza['Version']}`).sort(),
    missingRoots,
    unresolved,
    missingPins,
  };
}

/** Kernel releases among selected packages (`linux-image-<k>` / `linux-image-unsigned-<k>`), e.g. for the compat step. */
export function selectedKernels(packages: readonly string[]): string[] {
  return [
    ...new Set(
      packages.flatMap((p) => {
        const match = /^linux-image-(?:unsigned-)?([0-9][0-9A-Za-z._+~-]*)=/.exec(p);

        return match ? [match[1]] : [];
      }),
    ),
  ].sort();
}

/**
 * Ubuntu kernels among selected packages without their `linux-modules-extra-<k>` (3.1: the KVM modules follow the kernel
 * snapshot; such a kernel would boot a node without KVM). Empty for Debian (KVM is part of `linux-image-*`).
 */
export function kernelsWithoutKvmModules(os: string, packages: readonly string[]): string[] {
  if (!os.startsWith('ubuntu:')) return [];

  const extra = new Set(
    packages.flatMap((p) => {
      const match = /^linux-modules-extra-([0-9][0-9A-Za-z._+~-]*)=/.exec(p);

      return match ? [match[1]] : [];
    }),
  );

  return selectedKernels(packages).filter((k) => !extra.has(k));
}

// ---------------------------------------------------------------------------------------------------------------
// Bundle build

export interface AptBundleHost {
  os: string;
  arch: string;
}

export interface AptBundleSnapshot {
  index: AptBundleIndex;
  /** Per `<os>/<arch>`: the selection (for the build log and the DRBD compat step). */
  selections: Record<string, AptSelection>;
}

/**
 * Freezes the indexes for the hosts (into `store`) and selects the packages per host: the bundle's snapshot index.
 * `extraPackages` adds roots (operators building their own bundle with more host packages).
 */
export async function buildAptBundleSnapshot(
  hosts: readonly AptBundleHost[],
  store: BlobStore,
  options: { id?: string; extraPackages?: readonly string[]; fetchImpl?: AptFetchImpl; upstreams?: AptUpstream[] } = {},
): Promise<AptBundleSnapshot> {
  for (const host of hosts)
    if (!(SUPPORTED_HOST_OS as readonly string[]).includes(host.os) || !/^(amd64|arm64)$/.test(host.arch))
      throw new Error(`unsupported host ${host.os}/${host.arch}`);

  const sources = options.upstreams ?? aptUpstreams(hosts);
  const files = await takeSnapshot(sources, store, options.fetchImpl ?? defaultAptFetch);
  const pool = new Map<string, AptBundlePoolEntry>();
  const selections: Record<string, AptSelection> = {};

  for (const host of hosts) {
    const candidates: Candidate[] = [];

    for (const source of sources.filter((s) => s.os === host.os && s.arches.includes(host.arch)))
      for (const index of await frozenPackagesIndexes(files, source.name, store))
        if (index.dir.endsWith(`/binary-${host.arch}`))
          for (const stanza of parseControlStanzas(index.text)) candidates.push({ source: source.name, stanza });

    const pins = Object.assign({}, ...Object.values(PACKAGE_PINS).map((p) => p[host.os as 'debian:13'] ?? {}));
    const selection = selectAptPackages(
      candidates,
      [...bundleAptRoots(host.os, host.arch), ...(options.extraPackages ?? [])],
      pins,
    );

    selections[`${host.os}/${host.arch}`] = selection;

    for (const entry of selection.pool) pool.set(`${entry.source}\u0000${entry.path}`, entry);
  }

  const index = aptBundleIndexSchema.parse({
    id: options.id ?? snapshotId(new Date(), 'bundle'),
    sources,
    files,
    pool: [...pool.values()],
  });

  return { index, selections };
}

export interface AptPackBlob {
  sha256: string;
  size: number;
  /** Local file with exactly these bytes. */
  local: string;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);

  return hash.digest('hex');
}

/**
 * Fetches every file a bundle index names, by its checksum: from `cacheDir/<sha256>` (the snapshot step's frozen
 * indexes) if present and matching, else from the source's upstream URL into `workDir`; size and SHA-256 are verified
 * either way (a mismatch fails the build). Grouped per OS (the packs); each blob only in the first OS that needs it.
 */
export async function collectAptBundleBlobs(
  index: AptBundleIndex,
  options: { workDir: string; cacheDir?: string; fetchImpl?: AptFetchImpl; concurrency?: number },
): Promise<{ os: string; blobs: AptPackBlob[] }[]> {
  const fetchImpl = options.fetchImpl ?? defaultAptFetch;
  const sources = new Map(index.sources.map((s) => [s.name, s]));
  const wanted = new Map<string, { size: number; url: string; os: string }>();
  const add = (sha256: string, size: number, url: string, os: string) => {
    const known = wanted.get(sha256);

    if (known && known.size !== size) throw new Error(`blob ${sha256} is listed with two sizes`);

    if (!known) wanted.set(sha256, { size, url, os });
  };
  const osOrder = (os: string) => {
    const i = (SUPPORTED_HOST_OS as readonly string[]).indexOf(os);

    return i < 0 ? SUPPORTED_HOST_OS.length : i;
  };
  const items = [
    ...Object.entries(index.files).map(([key, file]) => {
      const [name, ...rest] = key.split('/');
      const source = sources.get(name) as AptUpstream;

      return { ...file, url: `${source.url}/${rest.join('/')}`, os: source.os };
    }),
    ...index.pool.map((entry) => {
      const source = sources.get(entry.source) as AptUpstream;

      return { sha256: entry.sha256, size: entry.size, url: `${source.url}/${entry.path}`, os: source.os };
    }),
  ].sort((a, b) => osOrder(a.os) - osOrder(b.os) || (a.os < b.os ? -1 : a.os > b.os ? 1 : 0));

  for (const item of items) add(item.sha256, item.size, item.url, item.os);

  await mkdir(options.workDir, { recursive: true });

  const resolved = new Map<string, AptPackBlob>();
  const fetchOne = async (sha256: string, entry: { size: number; url: string }) => {
    if (options.cacheDir) {
      const cached = join(options.cacheDir, sha256);
      const info = await stat(cached).catch(() => null);

      if (info?.size === entry.size && (await sha256OfFile(cached)) === sha256) {
        resolved.set(sha256, { sha256, size: entry.size, local: cached });

        return;
      }
    }

    const target = join(options.workDir, sha256);
    const existing = await stat(target).catch(() => null);

    if (existing?.size === entry.size && (await sha256OfFile(target)) === sha256) {
      resolved.set(sha256, { sha256, size: entry.size, local: target });

      return;
    }

    const res = await fetchImpl(entry.url);

    if (!res.ok || !res.body) throw new Error(`GET ${entry.url}: HTTP ${res.status}`);

    const temp = `${target}.${randomUUID()}.part`;
    const file = await open(temp, 'w', 0o644);
    const hash = createHash('sha256');
    let size = 0;

    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;

        if (size > entry.size) throw new Error(`${entry.url} is larger than the index says`);

        hash.update(chunk);
        await file.write(chunk);
      }

      await file.close();

      if (size !== entry.size || hash.digest('hex') !== sha256)
        throw new Error(`${entry.url} does not match its checksum in the snapshot index`);

      await rename(temp, target);
    } finally {
      await file.close().catch(() => undefined);
      await rm(temp, { force: true });
    }

    resolved.set(sha256, { sha256, size: entry.size, local: target });
  };

  const queue = [...wanted.entries()];
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 4) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await fetchOne(next[0], next[1]);
  });

  await Promise.all(workers);

  const byOs = new Map<string, AptPackBlob[]>();

  for (const [sha256, entry] of wanted)
    (byOs.get(entry.os) ?? byOs.set(entry.os, []).get(entry.os))?.push(resolved.get(sha256) as AptPackBlob);

  return [...byOs.entries()]
    .sort(([a], [b]) => osOrder(a) - osOrder(b) || (a < b ? -1 : 1))
    .map(([os, blobs]) => ({ os, blobs: blobs.sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1)) }));
}

/** Writes a pack: a tar whose members are the blobs, each named by its SHA-256. */
export async function writeAptPack(path: string, blobs: readonly AptPackBlob[]): Promise<void> {
  const out = createWriteStream(path);
  const write = (chunk: Buffer) =>
    new Promise<void>((done, reject) => out.write(chunk, (error) => (error ? reject(error) : done())));

  for (const blob of blobs) {
    await write(tarHeader(blob.sha256, blob.size));

    for await (const chunk of createReadStream(blob.local)) await write(chunk as Buffer);

    await write(tarPadding(blob.size));
  }

  await write(TAR_END);
  await new Promise<void>((done) => out.end(done));
}

// ---------------------------------------------------------------------------------------------------------------
// Control plane import

/**
 * Unpacks a bundle's package packs into the artifact store (by checksum; each member must be a file the index names,
 * with its size — the store verifies the SHA-256 while writing) and registers the pool files for serving, so the
 * snapshot is served from the bundle without upstream (air-gapped). Returns what was stored / already there and the
 * index files and packages no pack carried.
 */
export async function importAptBundlePacks(
  index: AptBundleIndex,
  packs: readonly AsyncIterable<Uint8Array | string>[],
  store: BlobStore,
  pool: PoolIndex,
): Promise<{ stored: number; present: number; missing: string[] }> {
  const sizes = new Map<string, number>();

  for (const file of Object.values(index.files)) sizes.set(file.sha256, file.size);

  for (const entry of index.pool) sizes.set(entry.sha256, entry.size);

  let stored = 0;
  let present = 0;

  for (const pack of packs)
    for await (const entry of readTar(pack, { maxEntryBytes: 2 * 1024 ** 3 })) {
      if (entry.type !== 'file') continue;

      const size = sizes.get(entry.name);

      if (size === undefined || entry.size !== size)
        throw new Error(`apt pack member ${entry.name} is not a file of the bundle's snapshot index`);

      if (await store.has(entry.name)) {
        for await (const _ of entry.body) void _;

        present++;
        continue;
      }

      await store.put(entry.name, size, entry.body);
      stored++;
    }

  const urls = new Map(index.sources.map((s) => [s.name, s.url]));
  const missing: string[] = [];

  for (const [key, file] of Object.entries(index.files)) if (!(await store.has(file.sha256))) missing.push(key);

  for (const entry of index.pool) {
    if (await store.has(entry.sha256))
      await pool.set(urls.get(entry.source) as string, entry.path, entry.sha256, entry.size);
    else missing.push(`${entry.source}/${entry.path}`);
  }

  return { stored, present, missing };
}
