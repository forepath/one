import type {
  AccessMe,
  VmImageCatalogEntry,
  VmImageImportRequest,
  VmRegistryImage,
} from '@forepath/loadweaver/frontend/data-access-console';

/** VM image catalog (3.42): the picker's filtering / ordering, checksums and image references as pure functions. */

export type VmImageArch = VmImageCatalogEntry['arch'];

/** A file checksum: SHA-256 (64 hex digits) or SHA-512 (128), optionally prefixed `sha256:` / `sha512:`. */
export interface VmImageChecksum {
  algorithm: 'sha256' | 'sha512';
  value: string;
}

/** The checksum the user typed, its algorithm by length (null: neither a SHA-256 nor a SHA-512, or a wrong prefix). */
export function parseImageChecksum(text: string): VmImageChecksum | null {
  const match = /^(?:(sha256|sha512):)?([0-9a-f]+)$/i.exec(text.trim());

  if (!match) return null;

  const value = match[2].toLowerCase();
  const algorithm = value.length === 64 ? 'sha256' : value.length === 128 ? 'sha512' : null;

  if (!algorithm || (match[1] && match[1].toLowerCase() !== algorithm)) return null;

  return { algorithm, value };
}

/** The import request body of a checksum: exactly one of `sha256` / `sha512`. */
export function checksumField(checksum: VmImageChecksum): Pick<VmImageImportRequest, 'sha256' | 'sha512'> {
  return checksum.algorithm === 'sha512' ? { sha512: checksum.value } : { sha256: checksum.value };
}

/** The import of a catalog entry as `ref` (the entry's `suggestedRef` unless edited). */
export function catalogImportRequest(entry: VmImageCatalogEntry, ref = entry.suggestedRef): VmImageImportRequest {
  return {
    url: entry.url,
    ...checksumField({ algorithm: entry.checksum.algorithm, value: entry.checksum.value.toLowerCase() }),
    ref: ref.trim(),
    arch: entry.arch,
    ...(entry.firmware?.length ? { firmware: [...entry.firmware] } : {}),
    ...(entry.guestAgent !== undefined ? { guestAgent: entry.guestAgent } : {}),
  };
}

const SOURCE_ORDER: Record<VmImageCatalogEntry['source'], number> = { shipped: 0, cluster: 1, upstream: 2 };

/** Readable distro names (the catalog's distro ids; unknown ones as they are). */
const DISTRO_NAMES: Readonly<Record<string, string>> = {
  ubuntu: 'Ubuntu',
  debian: 'Debian',
  almalinux: 'AlmaLinux',
  rocky: 'Rocky Linux',
  rockylinux: 'Rocky Linux',
  fedora: 'Fedora',
  alpine: 'Alpine',
};

export function distroName(distro: string): string {
  return DISTRO_NAMES[distro.toLowerCase()] ?? distro;
}

/** The distros of the entries, by readable name. */
export function catalogDistros(entries: readonly VmImageCatalogEntry[]): string[] {
  return [...new Set(entries.map((e) => e.distro))].sort((a, b) => distroName(a).localeCompare(distroName(b)));
}

/**
 * The picker's rows: one architecture, optionally one distro; Recommended first, then the cluster's own, then other
 * versions; within each by distro and newest version first. Upstream builds the catalog already lists (same URL) are
 * dropped.
 */
export function catalogRows(
  entries: readonly VmImageCatalogEntry[],
  filter: { arch: VmImageArch; distro?: string | null },
): VmImageCatalogEntry[] {
  const listed = new Set(entries.filter((e) => e.source !== 'upstream').map((e) => e.url));

  return entries
    .filter((e) => e.arch === filter.arch && (!filter.distro || e.distro === filter.distro))
    .filter((e) => e.source !== 'upstream' || !listed.has(e.url))
    .sort(
      (a, b) =>
        SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
        distroName(a.distro).localeCompare(distroName(b.distro)) ||
        b.version.localeCompare(a.version, undefined, { numeric: true }) ||
        a.label.localeCompare(b.label),
    );
}

/** `registry.lw/shop/debian:13@sha256:…` → `registry.lw/shop/debian:13` (the plan pins the digest). */
export function withoutDigest(reference: string): string {
  const at = reference.indexOf('@');

  return at < 0 ? reference : reference.slice(0, at);
}

/** The project's registry image a catalog entry was imported as (same `repository:tag` as its `suggestedRef`). */
export function registryImageOf(
  entry: VmImageCatalogEntry,
  images: readonly VmRegistryImage[],
): VmRegistryImage | null {
  return images.find((i) => `${i.repository}:${i.tag}` === entry.suggestedRef) ?? null;
}

/** Whether the caller may import VM images into `project` (operator / admin there, or cluster admin). */
export function mayImportVmImages(me: AccessMe | null, project: string | null): boolean {
  if (!me || !project) return false;

  if (me.clusterRole === 'cluster-admin') return true;

  const role = me.projects?.[project];

  return role === 'operator' || role === 'admin';
}
