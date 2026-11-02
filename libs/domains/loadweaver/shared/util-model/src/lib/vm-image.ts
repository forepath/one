import { z } from 'zod';

/**
 * OCI VM image artifacts (3.35): VM base images live in the built-in registry as OCI artifacts — a manifest with
 * `artifactType` `VM_IMAGE_ARTIFACT_TYPE`, a config blob (`vmImageConfigSchema`) and a single disk layer (qcow2, or
 * raw compressed with zstd); multi-arch through an OCI index. KubeVirt `containerDisk` images (a regular image whose
 * tar layer holds `/disk/*.qcow2|*.img`) are accepted too and detected at plan time.
 */

export const VM_IMAGE_ARTIFACT_TYPE = 'application/vnd.loadweaver.vm-image.v1';
export const VM_IMAGE_CONFIG_MEDIA_TYPE = 'application/vnd.loadweaver.vm-image.config.v1+json';

export const VM_IMAGE_FORMATS = ['qcow2', 'raw'] as const;
export type VmImageFormat = (typeof VM_IMAGE_FORMATS)[number];

/** Disk layer media type per image format (raw disks are stored zstd-compressed). */
export const VM_IMAGE_DISK_MEDIA_TYPES: Readonly<Record<VmImageFormat, string>> = Object.freeze({
  qcow2: 'application/vnd.loadweaver.vm-image.disk.qcow2',
  raw: 'application/vnd.loadweaver.vm-image.disk.raw+zstd',
});

export const VM_IMAGE_ARCHES = ['amd64', 'arm64'] as const;
export type VmImageArch = (typeof VM_IMAGE_ARCHES)[number];

export const VM_FIRMWARES = ['uefi', 'bios'] as const;
export type VmFirmware = (typeof VM_FIRMWARES)[number];

/** The config blob of a VM image artifact. */
export const vmImageConfigSchema = z
  .object({
    arch: z.enum(VM_IMAGE_ARCHES),
    format: z.enum(VM_IMAGE_FORMATS),
    /** Virtual disk size in bytes: the boot disk must be at least this large. */
    virtualSize: z.number().int().positive(),
    /** Firmware the image boots with; `bios` is amd64 only. */
    firmware: z
      .array(z.enum(VM_FIRMWARES))
      .min(1)
      .max(2)
      .refine((f) => new Set(f).size === f.length, 'firmware values must be unique'),
    os: z
      .object({ id: z.string().max(64), version: z.string().max(64) })
      .strict()
      .optional(),
    /** The image runs qemu-guest-agent (consistent snapshots through fsfreeze). */
    guestAgent: z.boolean().optional(),
  })
  .strict()
  .refine((c) => c.arch === 'amd64' || !c.firmware.includes('bios'), {
    message: 'bios firmware is amd64 only',
    path: ['firmware'],
  });
export type VmImageConfig = z.infer<typeof vmImageConfigSchema>;

/** The image format of a disk layer media type; null for anything else. */
export function vmImageFormatOfMediaType(mediaType: string): VmImageFormat | null {
  for (const format of VM_IMAGE_FORMATS) if (VM_IMAGE_DISK_MEDIA_TYPES[format] === mediaType) return format;

  return null;
}

const CONTAINER_DISK_PATH = /^(?:\.\/|\/)?disk\/[^/]+\.(qcow2|img)$/;

/**
 * Whether a tar entry of a KubeVirt `containerDisk` layer is its disk (`/disk/<file>.qcow2` or `.img`), and which
 * format it has (`.img` is raw); null otherwise.
 */
export function containerDiskFormat(entryPath: string): VmImageFormat | null {
  const match = CONTAINER_DISK_PATH.exec(entryPath);

  if (!match) return null;

  return match[1] === 'qcow2' ? 'qcow2' : 'raw';
}

/** Media type of the OCI manifest of a VM image artifact. */
export const OCI_IMAGE_MANIFEST_MEDIA_TYPE = 'application/vnd.oci.image.manifest.v1+json';

/** What the first bytes (≥ 512) of a disk file are: qcow2, gzip / zstd compression, a tar archive (containerDisk), else raw. */
export type DetectedVmDiskFormat = 'qcow2' | 'gzip' | 'tar' | 'zstd' | 'raw';

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

export function detectVmDiskFormat(header: Uint8Array): DetectedVmDiskFormat {
  if (header.length >= 4 && u32be(header, 0) === 0x514649fb) return 'qcow2';

  if (header.length >= 2 && header[0] === 0x1f && header[1] === 0x8b) return 'gzip';

  if (header.length >= 4 && header[0] === 0x28 && header[1] === 0xb5 && header[2] === 0x2f && header[3] === 0xfd)
    return 'zstd';

  if (header.length >= 262 && String.fromCharCode(...header.subarray(257, 262)) === 'ustar') return 'tar';

  return 'raw';
}

/** Virtual size of a qcow2 image from its header (bytes 24–31, big endian); null when not a qcow2 header. */
export function qcow2VirtualSize(header: Uint8Array): number | null {
  if (detectVmDiskFormat(header) !== 'qcow2' || header.length < 32) return null;

  const size = u32be(header, 24) * 2 ** 32 + u32be(header, 28);

  return size > 0 && Number.isSafeInteger(size) ? size : null;
}

/** Whether a qcow2 header names a backing file (bytes 8–15 ≠ 0): such images can't be imported on their own. */
export function qcow2HasBackingFile(header: Uint8Array): boolean {
  return (
    detectVmDiskFormat(header) === 'qcow2' && header.length >= 16 && (u32be(header, 8) !== 0 || u32be(header, 12) !== 0)
  );
}

/** The file name of the disk layer (`disk.qcow2` / `disk.raw.zst`). */
export function vmImageLayerTitle(format: VmImageFormat): string {
  return format === 'qcow2' ? 'disk.qcow2' : 'disk.raw.zst';
}

export interface VmImageDescriptor {
  mediaType: string;
  digest: string;
  size: number;
  annotations?: Record<string, string>;
}

/** The OCI manifest document of a VM image artifact (`artifactType` = VM image, one config, one disk layer). */
export function vmImageManifestDocument(
  config: VmImageDescriptor,
  layer: VmImageDescriptor,
  annotations: Record<string, string> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    mediaType: OCI_IMAGE_MANIFEST_MEDIA_TYPE,
    artifactType: VM_IMAGE_ARTIFACT_TYPE,
    config,
    layers: [layer],
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  };
}

/** Whether a manifest (or index) is a VM image artifact: by `artifactType` or the config media type. */
export function isVmImageManifest(manifest: {
  artifactType?: unknown;
  config?: { mediaType?: unknown } | null;
}): boolean {
  return manifest.artifactType === VM_IMAGE_ARTIFACT_TYPE || manifest.config?.mediaType === VM_IMAGE_CONFIG_MEDIA_TYPE;
}
