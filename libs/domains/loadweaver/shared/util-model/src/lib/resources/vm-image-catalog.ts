import { z } from 'zod';

import { resourceNameSchema } from '../metadata';
import { VM_FIRMWARES, VM_IMAGE_ARCHES, type VmFirmware, type VmImageArch } from '../vm-image';

/**
 * VM image catalog (3.42): recommended general-purpose images the VM wizard and the project's Images tab offer for
 * import. Three sources: the list shipped with the release, the cluster's own entries (`Cluster.spec.vmImages`,
 * changed through plans) and a live lookup of the distros' published checksum lists.
 */

export const VM_IMAGE_CATALOG_SOURCES = ['shipped', 'cluster', 'upstream'] as const;
export type VmImageCatalogSource = (typeof VM_IMAGE_CATALOG_SOURCES)[number];

export const VM_IMAGE_CHECKSUM_ALGORITHMS = ['sha256', 'sha512'] as const;
export type VmImageChecksumAlgorithm = (typeof VM_IMAGE_CHECKSUM_ALGORITHMS)[number];

/** Hex digests, optionally prefixed with their algorithm (`sha256:…`), as imports accept them. */
export const SHA256_HEX_PATTERN = /^(?:sha256:)?[0-9a-fA-F]{64}$/;
export const SHA512_HEX_PATTERN = /^(?:sha512:)?[0-9a-fA-F]{128}$/;

/** One entry of `GET /vm-images/catalog` (and `/catalog/upstream`). */
export interface VmImageCatalogEntry {
  /** `ubuntu-24.04-amd64` (shipped), `cluster:<name>-<arch>`, `upstream:<distro>-<version>-<arch>-<build>`. */
  id: string;
  source: VmImageCatalogSource;
  /** `ubuntu`, `debian`, … (the entry's `name` for cluster entries). */
  distro: string;
  /** Display name, e.g. "Ubuntu 24.04 LTS". */
  label: string;
  version: string;
  arch: VmImageArch;
  url: string;
  checksum: { algorithm: VmImageChecksumAlgorithm; value: string };
  firmware?: VmFirmware[];
  guestAgent?: boolean;
  description?: string;
  /** Prefilled `<repository>:<tag>` of the import, e.g. `ubuntu:24.04`. */
  suggestedRef: string;
  /** The distro's dated build id where known (`20261017`, `20261026-2643`). */
  build?: string;
}

/** Bounded so the catalog stays a short list (the shipped one has about 20 entries). */
export const MAX_CLUSTER_VM_IMAGES = 100;

export const clusterVmImageSchema = z
  .object({
    /** Slug of the image line (`company-base`); with `arch` the entry's identity. */
    name: resourceNameSchema,
    label: z.string().min(1).max(128).optional(),
    version: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, 'version must be letters, digits, ".", "_", "+" or "-"'),
    arch: z.enum(VM_IMAGE_ARCHES),
    url: z.url({ protocol: /^https$/ }).max(2048),
    sha256: z.string().regex(SHA256_HEX_PATTERN, 'sha256 must be 64 hex characters').optional(),
    sha512: z.string().regex(SHA512_HEX_PATTERN, 'sha512 must be 128 hex characters').optional(),
    firmware: z
      .array(z.enum(VM_FIRMWARES))
      .min(1)
      .max(2)
      .refine((f) => new Set(f).size === f.length, 'firmware values must be unique')
      .optional(),
    guestAgent: z.boolean().optional(),
    description: z.string().max(1024).optional(),
  })
  .strict()
  .superRefine((image, ctx) => {
    if (!image.sha256 === !image.sha512)
      ctx.addIssue({ code: 'custom', path: ['sha256'], message: 'exactly one of sha256 and sha512 is required' });

    if (image.arch !== 'amd64' && image.firmware?.includes('bios'))
      ctx.addIssue({ code: 'custom', path: ['firmware'], message: 'bios firmware is amd64 only' });
  });
export type ClusterVmImage = z.infer<typeof clusterVmImageSchema>;

/** `Cluster.spec.vmImages`: the cluster's own catalog entries, listed next to the shipped ones. */
export const clusterVmImagesSchema = z
  .object({
    catalog: z
      .array(clusterVmImageSchema)
      .max(MAX_CLUSTER_VM_IMAGES)
      .refine(
        (c) => new Set(c.map((i) => `${i.name}/${i.arch}`)).size === c.length,
        'catalog entries must be unique per name and arch',
      )
      .default([]),
  })
  .strict();
export type ClusterVmImages = z.infer<typeof clusterVmImagesSchema>;
