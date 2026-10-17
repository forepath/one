import { z } from 'zod';

import { RELEASE_VERSION_PATTERN } from './versions';

/**
 * The release bundle manifest (3.26): one signed document per Loadweaver release that pins every component running
 * on nodes and the control plane to tested versions. Bundle layout (an uncompressed tar, see `bundle.ts`):
 *
 *   manifest.json   the manifest in canonical JSON (`canonicalJson`), exactly the signed bytes
 *   manifest.sig    the signature document (`ReleaseSignature`), absent / `none` for unsigned dev bundles
 *   artifacts/...   every file listed in `artifacts` (OCI image archives, agent binaries, the gVisor tarballs, DRBD
 *                   sources / prebuilt modules / compat patches, the apt snapshot index and its package packs), each
 *                   checked against its SHA-256
 *
 * The schema is forward compatible: an N-1 control plane imports bundle N (the control plane updates first), so
 * unknown top-level fields and unknown component kinds are kept and ignored rather than refused. The signature
 * always covers the bytes as received.
 */

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;

/** Hosts Loadweaver supports (3.21): `<os-release ID>:<VERSION_ID>`. */
export const SUPPORTED_HOST_OS = ['debian:12', 'debian:13', 'ubuntu:22.04', 'ubuntu:24.04'] as const;
export type SupportedHostOs = (typeof SUPPORTED_HOST_OS)[number];

export const NODE_ARCHES = ['amd64', 'arm64'] as const;
export type NodeArch = (typeof NODE_ARCHES)[number];

export const releaseVersionSchema = z.string().max(64).regex(RELEASE_VERSION_PATTERN, 'invalid release version');
export const releaseChannelSchema = z.enum(['stable', 'beta']);
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'invalid SHA-256');
export const sha512HexSchema = z.string().regex(/^[0-9a-f]{128}$/, 'invalid SHA-512');
export const imageDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'invalid image digest');
/** `registry/namespace/name` without tag or digest. */
export const imageRepositorySchema = z
  .string()
  .max(255)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(\/[a-z0-9]+([._-][a-z0-9]+)*)+$/, 'invalid image repository');
/** A path inside the bundle; only below `artifacts/`, no `..`, no absolute paths. */
export const artifactPathSchema = z
  .string()
  .max(200)
  .regex(/^artifacts(\/[A-Za-z0-9_+-][A-Za-z0-9._+-]*)+$/, 'invalid artifact path');
export const debianPackageSchema = z.string().regex(/^[a-z0-9][a-z0-9.+-]{0,62}$/, 'invalid package name');
export const debianVersionSchema = z.string().regex(/^[0-9A-Za-z.+~:-]{1,100}$/, 'invalid package version');
export const componentNameSchema = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/, 'invalid component name');
export const hostOsSchema = z.enum(SUPPORTED_HOST_OS);
export const nodeArchSchema = z.enum(NODE_ARCHES);

/** A file of the bundle. */
export const artifactFileSchema = z
  .object({
    path: artifactPathSchema,
    sha256: sha256HexSchema,
    size: z
      .number()
      .int()
      .min(0)
      .max(64 * 1024 ** 3),
  })
  .strict();
export type ArtifactFile = z.infer<typeof artifactFileSchema>;

/** A container image by digest; `archive` is its OCI archive in the bundle (imported into the cluster registry). */
export const imageComponentSchema = z
  .object({
    kind: z.literal('image'),
    version: z.string().max(64),
    repository: imageRepositorySchema,
    tag: z.string().max(128).optional(),
    digest: imageDigestSchema,
    archive: artifactPathSchema.optional(),
    /** Plugins baked into a derived image (e.g. OpenSearch `repository-s3`), with the checksum they were verified by. */
    plugins: z
      .array(z.object({ name: z.string().max(64), version: z.string().max(64), sha512: sha512HexSchema }).strict())
      .max(16)
      .optional(),
  })
  .loose();
export type ImageComponent = z.infer<typeof imageComponentSchema>;

/** Per-architecture binaries (the node agent). */
export const binaryComponentSchema = z
  .object({
    kind: z.literal('binary'),
    version: z.string().max(64),
    files: z.partialRecord(nodeArchSchema, artifactPathSchema),
  })
  .loose();
export type BinaryComponent = z.infer<typeof binaryComponentSchema>;

/** A release tarball per architecture, pinned by the upstream checksum too (gVisor: `runsc` + sidecars). */
export const tarballComponentSchema = z
  .object({
    kind: z.literal('tarball'),
    version: z.string().max(64),
    sha512: z.partialRecord(nodeArchSchema, sha512HexSchema),
    files: z.partialRecord(nodeArchSchema, artifactPathSchema).optional(),
  })
  .loose();
export type TarballComponent = z.infer<typeof tarballComponentSchema>;

/** A kernel release (`uname -r`). */
export const kernelReleaseSchema = z.string().regex(/^[0-9A-Za-z._+~-]{1,128}$/);

/**
 * A kernel module built per kernel ABI (DRBD 9): the source tarball (built on the node against the target kernel's
 * headers when no prebuilt module matches) and prebuilt modules per supported kernel. `compat` holds DRBD's compat
 * patch pre-generated at bundle build time per kernel of the release's snapshot (a `cocci_cache/<md5>/` entry, see
 * `drbd-compat.ts`), so a node builds from source without LINBIT's SPAAS — air-gapped (3.26).
 */
export const kernelModuleComponentSchema = z
  .object({
    kind: z.literal('kernel-module'),
    version: z.string().max(64),
    source: z
      .object({ url: z.string().url().max(500), sha256: sha256HexSchema, file: artifactPathSchema.optional() })
      .strict(),
    prebuilt: z
      .array(
        z
          .object({
            kernel: kernelReleaseSchema,
            arch: nodeArchSchema,
            file: artifactPathSchema,
            /** Signed for Secure Boot with the bundle's module key. */
            signed: z.boolean(),
          })
          .strict(),
      )
      .max(256),
    compat: z
      .array(
        z
          .object({
            kernel: kernelReleaseSchema,
            arch: nodeArchSchema,
            file: artifactPathSchema,
            /** MD5 of DRBD's `compat.h` for that kernel: the `cocci_cache/<md5>/` directory the file holds. */
            md5: z.string().regex(/^[0-9a-f]{32}$/),
          })
          .strict(),
      )
      .max(256)
      .optional(),
  })
  .loose();
export type KernelModuleComponent = z.infer<typeof kernelModuleComponentSchema>;

/** Host packages pinned per supported OS (apt), installed from the cluster-local apt source. */
export const packagesComponentSchema = z
  .object({
    kind: z.literal('packages'),
    version: z.string().max(64),
    packages: z.partialRecord(hostOsSchema, z.record(debianPackageSchema, debianVersionSchema)),
  })
  .loose();
export type PackagesComponent = z.infer<typeof packagesComponentSchema>;

/** A component of a kind this build doesn't know (a newer bundle): kept, never acted on. */
export const unknownComponentSchema = z.object({ kind: z.string().max(32), version: z.string().max(64) }).loose();

export const releaseComponentSchema = z.union([
  z.discriminatedUnion('kind', [
    imageComponentSchema,
    binaryComponentSchema,
    tarballComponentSchema,
    kernelModuleComponentSchema,
    packagesComponentSchema,
  ]),
  unknownComponentSchema,
]);
export type ReleaseComponent = z.infer<typeof releaseComponentSchema>;

export const releaseManifestSchema = z
  .object({
    schemaVersion: z.literal(RELEASE_MANIFEST_SCHEMA_VERSION),
    product: z.literal('loadweaver'),
    version: releaseVersionSchema,
    channel: releaseChannelSchema,
    created: z.string().datetime(),
    /** Compatibility notes shown in the update plan. */
    notes: z.array(z.string().max(1000)).max(50).default([]),
    /** Clusters below this version update through an intermediate release first (N-1, 3.26). */
    minimumVersion: releaseVersionSchema.optional(),
    components: z.record(componentNameSchema, releaseComponentSchema),
    /** The frozen apt index snapshot for air-gapped clusters (`InRelease` / `Packages` per source, pool files). */
    aptSnapshot: artifactPathSchema.optional(),
    /**
     * The snapshot's files packed per OS (`apt-bundle.ts`: tar members named by SHA-256, each named by the index):
     * listed here and in `artifacts`, so the signature covers them; unpacked into the cluster's apt cache on import.
     */
    aptPackages: z.array(artifactPathSchema).max(16).optional(),
    artifacts: z.array(artifactFileSchema).max(512),
  })
  .loose()
  .superRefine((manifest, ctx) => {
    const paths = new Set<string>();

    for (const a of manifest.artifacts) {
      if (paths.has(a.path)) ctx.addIssue({ code: 'custom', message: `duplicate artifact ${a.path}` });

      paths.add(a.path);
    }

    for (const path of referencedArtifacts(manifest as ReleaseManifest))
      if (!paths.has(path)) ctx.addIssue({ code: 'custom', message: `artifact ${path} is referenced but not listed` });
  });
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

/** The components the control plane and the agent act on; a bundle without them is refused. */
export const REQUIRED_COMPONENTS = {
  'control-plane': 'image',
  'node-agent': 'binary',
  envoy: 'image',
  etcd: 'image',
  postgres: 'image',
  valkey: 'image',
  opensearch: 'image',
  garage: 'image',
  registry: 'image',
  gvisor: 'tarball',
  drbd: 'kernel-module',
} as const satisfies Record<string, ReleaseComponent['kind']>;

/** Every artifact path a component references. */
export function referencedArtifacts(
  manifest: Pick<ReleaseManifest, 'components' | 'aptSnapshot' | 'aptPackages'>,
): string[] {
  const out: string[] = [];

  for (const component of Object.values(manifest.components)) {
    switch (component.kind) {
      case 'image':
        if ((component as ImageComponent).archive) out.push((component as ImageComponent).archive as string);
        break;
      case 'binary':
        out.push(...(Object.values((component as BinaryComponent).files) as string[]));
        break;
      case 'tarball':
        out.push(...(Object.values((component as TarballComponent).files ?? {}) as string[]));
        break;
      case 'kernel-module': {
        const module = component as KernelModuleComponent;

        if (module.source.file) out.push(module.source.file);

        out.push(...module.prebuilt.map((p) => p.file), ...(module.compat ?? []).map((c) => c.file));
        break;
      }
    }
  }

  if (manifest.aptSnapshot) out.push(manifest.aptSnapshot);

  out.push(...(manifest.aptPackages ?? []));

  return out;
}

/** Problems with the components this build needs (missing, wrong kind); empty when the bundle is usable. */
export function missingComponents(manifest: Pick<ReleaseManifest, 'components'>): string[] {
  return Object.entries(REQUIRED_COMPONENTS).flatMap(([name, kind]) => {
    const component = manifest.components[name];

    if (!component) return [`component ${name} is missing`];

    return component.kind === kind ? [] : [`component ${name} is a ${component.kind}, expected ${kind}`];
  });
}

/** `repository@digest` of an image component. */
export function imageReference(component: Pick<ImageComponent, 'repository' | 'tag' | 'digest'>): string {
  return `${component.repository}${component.tag ? `:${component.tag}` : ''}@${component.digest}`;
}

/** The image components by name. */
export function imageComponents(manifest: Pick<ReleaseManifest, 'components'>): Record<string, ImageComponent> {
  return Object.fromEntries(
    Object.entries(manifest.components).filter(([, c]) => c.kind === 'image') as [string, ImageComponent][],
  );
}

/** Pinned host packages for one OS, merged over every `packages` component. */
export function packagePins(manifest: Pick<ReleaseManifest, 'components'>, os: string): Record<string, string> {
  const pins: Record<string, string> = {};

  for (const component of Object.values(manifest.components))
    if (component.kind === 'packages')
      Object.assign(pins, (component as PackagesComponent).packages[os as SupportedHostOs] ?? {});

  return pins;
}

/** The artifact entry of a path (size + checksum), or undefined. */
export function artifactOf(manifest: Pick<ReleaseManifest, 'artifacts'>, path: string): ArtifactFile | undefined {
  return manifest.artifacts.find((a) => a.path === path);
}
