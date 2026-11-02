import {
  isVmImageManifest,
  vmImageConfigSchema,
  vmImageFormatOfMediaType,
  type VmImageArch,
  type VmImageFormat,
  type VmFirmware,
} from '@forepath/loadweaver/shared/util-model';

import { vmImageReference } from './vm-image-import.utils';

/**
 * The VM images of a project's registry repositories (3.35): every tag whose manifest is a VM image artifact (by
 * `artifactType` / config media type), also inside an OCI index (multi-arch). Images pushed with `lw vm-image push`
 * or `oras` appear here next to the API imports.
 */
export interface VmRegistryImageDto {
  project: string;
  repository: string;
  tag: string;
  /** `registry.lw/<project>/<repository>:<tag>@<digest>`. */
  reference: string;
  digest: string;
  /** One entry per architecture (an OCI index lists several). */
  variants: {
    arch: VmImageArch;
    format: VmImageFormat;
    virtualSize: number;
    firmware: VmFirmware[];
    guestAgent: boolean;
    /** Size of the disk layer in the registry (compressed for raw). */
    layerBytes: number;
  }[];
}

export const OCI_INDEX_MEDIA_TYPE = 'application/vnd.oci.image.index.v1+json';
export const VM_IMAGE_MANIFEST_ACCEPT = [OCI_INDEX_MEDIA_TYPE, 'application/vnd.oci.image.manifest.v1+json'].join(', ');

/** The project's repositories (`<project>/<repo>`) in one `_catalog` page, and whether a later page may have more. */
export function projectRepositories(
  project: string,
  catalog: { repositories?: unknown },
  pageSize: number,
): { repositories: string[]; more: boolean } {
  const all = Array.isArray(catalog.repositories)
    ? catalog.repositories.filter((r): r is string => typeof r === 'string')
    : [];
  const prefix = `${project}/`;
  const mine = all.filter((r) => r.startsWith(prefix));

  // The catalog is sorted: once a page leaves the prefix, no later page can match.
  return { repositories: mine, more: all.length >= pageSize && mine.length === all.length };
}

interface Descriptor {
  mediaType?: string;
  digest?: string;
  size?: number;
  platform?: { architecture?: string };
}

/** Whether a manifest list could hold VM images (index with an `artifactType`, or children without one). */
export function isIndex(manifest: Record<string, unknown>): boolean {
  return Array.isArray(manifest['manifests']);
}

/** The variant a VM image artifact manifest + its config blob describe; null when it isn't a valid VM image. */
export function vmImageVariant(
  manifest: Record<string, unknown>,
  configJson: unknown,
): VmRegistryImageDto['variants'][number] | null {
  if (!isVmImageManifest(manifest as { artifactType?: unknown; config?: { mediaType?: unknown } })) return null;

  const layers = Array.isArray(manifest['layers']) ? (manifest['layers'] as Descriptor[]) : [];
  const format = layers.length === 1 ? vmImageFormatOfMediaType(layers[0].mediaType ?? '') : null;
  const config = vmImageConfigSchema.safeParse(configJson);

  if (!format || !config.success || config.data.format !== format) return null;

  return {
    arch: config.data.arch,
    format,
    virtualSize: config.data.virtualSize,
    firmware: config.data.firmware,
    guestAgent: config.data.guestAgent ?? false,
    layerBytes: typeof layers[0].size === 'number' ? layers[0].size : 0,
  };
}

/** The children of an index worth reading (VM artifacts first; attestations / unknown platforms skipped). */
export function indexChildren(manifest: Record<string, unknown>): string[] {
  const children = Array.isArray(manifest['manifests']) ? (manifest['manifests'] as Descriptor[]) : [];

  return children
    .filter((c) => typeof c.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(c.digest))
    .filter((c) => c.platform?.architecture !== 'unknown')
    .map((c) => c.digest as string)
    .slice(0, 8);
}

export function vmRegistryImage(
  project: string,
  repository: string,
  tag: string,
  digest: string,
  variants: VmRegistryImageDto['variants'],
): VmRegistryImageDto {
  const repo = repository.slice(project.length + 1);

  return {
    project,
    repository: repo,
    tag,
    reference: vmImageReference(project, repo, tag, digest || null),
    digest,
    variants,
  };
}
