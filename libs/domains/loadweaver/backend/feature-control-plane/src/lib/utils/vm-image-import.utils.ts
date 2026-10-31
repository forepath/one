import { createHash } from 'node:crypto';

import {
  detectVmDiskFormat,
  OCI_IMAGE_MANIFEST_MEDIA_TYPE,
  PRIVATE_REGISTRY_HOST,
  qcow2VirtualSize as qcow2HeaderVirtualSize,
  VM_IMAGE_CONFIG_MEDIA_TYPE,
  VM_IMAGE_DISK_MEDIA_TYPES,
  vmImageConfigSchema,
  vmImageLayerTitle as layerTitle,
  vmImageManifestDocument,
  type DetectedVmDiskFormat,
  type VmImageConfig,
  type VmImageFormat,
} from '@forepath/loadweaver/shared/util-model';

/**
 * VM image imports (3.35): pure helpers of the import job — reference parsing, disk format detection (qcow2 / raw,
 * KubeVirt containerDisk tars, gzip-compressed sources) and the OCI artifact (config + single disk layer + manifest).
 */

export const OCI_MANIFEST_MEDIA_TYPE = OCI_IMAGE_MANIFEST_MEDIA_TYPE;

const REPOSITORY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * `ref` of an import inside the project's registry namespace: `<repository>:<tag>` (`debian-13:20261017`), or the
 * full `registry.lw/<project>/<repository>:<tag>`. Null when malformed or in another project.
 */
export function parseVmImageImportRef(project: string, ref: string): { repository: string; tag: string } | null {
  let rest = ref.trim();
  const prefix = `${PRIVATE_REGISTRY_HOST}/${project}/`;

  if (rest.startsWith(prefix)) rest = rest.slice(prefix.length);
  else if (rest.includes('/') && rest.split('/')[0].includes('.')) return null;

  const colon = rest.lastIndexOf(':');

  if (colon <= 0) return null;

  const repository = rest.slice(0, colon);
  const tag = rest.slice(colon + 1);

  if (!REPOSITORY.test(repository) || repository.length > 190 || !TAG.test(tag)) return null;

  return { repository, tag };
}

/** The pull reference of an imported image (`registry.lw/<project>/<repository>:<tag>@<digest>`). */
export function vmImageReference(project: string, repository: string, tag: string, digest?: string | null): string {
  return `${PRIVATE_REGISTRY_HOST}/${project}/${repository}:${tag}${digest ? `@${digest}` : ''}`;
}

export type DetectedFormat = DetectedVmDiskFormat;

/** What the first bytes (≥ 512) of a file are: a qcow2 disk, gzip / zstd compression, a tar archive, else raw. */
export function detectDiskFormat(header: Buffer): DetectedFormat {
  return detectVmDiskFormat(header);
}

/** Virtual size of a qcow2 image from its header (bytes 24–31, big endian); null when not a qcow2 header. */
export function qcow2VirtualSize(header: Buffer): number | null {
  return qcow2HeaderVirtualSize(header);
}

export interface OciDescriptor {
  mediaType: string;
  digest: string;
  size: number;
  annotations?: Record<string, string>;
}

export function sha256Digest(data: Buffer | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

/** The config blob (validated against `vmImageConfigSchema`). */
export function vmImageConfigBlob(config: VmImageConfig): { data: Buffer; descriptor: OciDescriptor } {
  const data = Buffer.from(JSON.stringify(vmImageConfigSchema.parse(config)), 'utf8');

  return { data, descriptor: { mediaType: VM_IMAGE_CONFIG_MEDIA_TYPE, digest: sha256Digest(data), size: data.length } };
}

/** The disk layer descriptor of a format (raw layers are zstd-compressed). */
export function vmImageLayerDescriptor(
  format: VmImageFormat,
  digest: string,
  size: number,
  title: string,
): OciDescriptor {
  return {
    mediaType: VM_IMAGE_DISK_MEDIA_TYPES[format],
    digest,
    size,
    annotations: { 'org.opencontainers.image.title': title },
  };
}

/** The OCI manifest of a VM image artifact (`artifactType` = VM image, one config, one disk layer). */
export function vmImageManifest(
  config: OciDescriptor,
  layer: OciDescriptor,
  annotations: Record<string, string> = {},
): { data: Buffer; digest: string } {
  const data = Buffer.from(JSON.stringify(vmImageManifestDocument(config, layer, annotations)), 'utf8');

  return { data, digest: sha256Digest(data) };
}

/** The file name of the layer (`disk.qcow2` / `disk.raw.zst`). */
export function vmImageLayerTitle(format: VmImageFormat): string {
  return layerTitle(format);
}
