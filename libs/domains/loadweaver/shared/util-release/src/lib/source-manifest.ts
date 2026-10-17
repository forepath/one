import {
  RELEASE_MANIFEST_SCHEMA_VERSION,
  releaseManifestSchema,
  type ArtifactFile,
  type NodeArch,
  type ReleaseChannel,
  type ReleaseComponent,
  type ReleaseManifest,
} from './manifest';
import {
  COMPONENT_IMAGES,
  DRBD_PIN,
  GVISOR_PIN,
  OPENSEARCH_REPOSITORY_S3,
  PACKAGE_COMPONENT_VERSIONS,
  PACKAGE_PINS,
  splitImageReference,
  type ImageComponentName,
} from './pins';

export interface ManifestInput {
  version: string;
  channel: ReleaseChannel;
  created: string;
  notes?: string[];
  minimumVersion?: string;
  /** Image references by digest replacing the source pins (the release's control-plane image, derived images). */
  images?: Partial<Record<ImageComponentName, string>>;
  /** The OpenSearch image carries the `repository-s3` plugin (a derived release image). */
  opensearchWithRepositoryS3?: boolean;
  /** OCI archives of images in the bundle. */
  imageArchives?: Partial<Record<ImageComponentName, ArtifactFile>>;
  agentBinaries: Partial<Record<NodeArch, ArtifactFile>>;
  gvisorTarballs?: Partial<Record<NodeArch, ArtifactFile>>;
  drbdSource?: ArtifactFile;
  drbdPrebuilt?: { kernel: string; arch: NodeArch; file: ArtifactFile; signed: boolean }[];
  /** DRBD compat patches pre-generated per kernel (`drbd-compat.ts`): offline builds from source. */
  drbdCompat?: { kernel: string; arch: NodeArch; file: ArtifactFile; md5: string }[];
  aptSnapshot?: ArtifactFile;
  /** The snapshot's package packs per OS (`apt-bundle.ts`); only with `aptSnapshot`. */
  aptPackages?: ArtifactFile[];
  /** Further files to list (e.g. checksum files); every referenced file is listed automatically. */
  extraArtifacts?: ArtifactFile[];
}

function imageVersion(tag: string | undefined): string {
  return tag?.replace(/^v/, '') ?? 'digest';
}

/**
 * Builds a release manifest from this source tree's pins (`pins.ts`) and the release's own artifacts. Used by the
 * release pipeline and the development bundle script; the result is validated against the manifest schema.
 */
export function buildManifest(input: ManifestInput): ReleaseManifest {
  const artifacts = new Map<string, ArtifactFile>();
  const add = (file: ArtifactFile | undefined) => {
    if (file) artifacts.set(file.path, file);

    return file?.path;
  };
  const components: Record<string, ReleaseComponent> = {};

  for (const [name, source] of Object.entries(COMPONENT_IMAGES) as [ImageComponentName, string][]) {
    const reference = input.images?.[name] ?? source;
    const parts = splitImageReference(reference);

    if (!parts) throw new Error(`image ${name} (${reference}) is not pinned by digest`);

    const archive = add(input.imageArchives?.[name]);

    components[name] = {
      kind: 'image',
      version: name === 'control-plane' ? input.version : imageVersion(parts.tag),
      repository: parts.repository,
      ...(parts.tag ? { tag: parts.tag } : {}),
      digest: parts.digest,
      ...(archive ? { archive } : {}),
      ...(name === 'opensearch' && input.opensearchWithRepositoryS3
        ? {
            plugins: [
              {
                name: 'repository-s3',
                version: OPENSEARCH_REPOSITORY_S3.version,
                sha512: OPENSEARCH_REPOSITORY_S3.sha512,
              },
            ],
          }
        : {}),
    };
  }

  components['node-agent'] = {
    kind: 'binary',
    version: input.version,
    files: Object.fromEntries(
      Object.entries(input.agentBinaries).map(([arch, file]) => [arch, add(file as ArtifactFile)]),
    ),
  };
  components['gvisor'] = {
    kind: 'tarball',
    version: GVISOR_PIN.release,
    sha512: { ...GVISOR_PIN.sha512 },
    ...(input.gvisorTarballs
      ? {
          files: Object.fromEntries(
            Object.entries(input.gvisorTarballs).map(([arch, file]) => [arch, add(file as ArtifactFile)]),
          ),
        }
      : {}),
  };
  components['drbd'] = {
    kind: 'kernel-module',
    version: DRBD_PIN.version,
    source: {
      url: DRBD_PIN.url,
      sha256: DRBD_PIN.sha256,
      ...(input.drbdSource ? { file: add(input.drbdSource) } : {}),
    },
    prebuilt: (input.drbdPrebuilt ?? []).map((p) => ({
      kernel: p.kernel,
      arch: p.arch,
      file: add(p.file) as string,
      signed: p.signed,
    })),
    ...(input.drbdCompat?.length
      ? {
          compat: input.drbdCompat.map((c) => ({
            kernel: c.kernel,
            arch: c.arch,
            file: add(c.file) as string,
            md5: c.md5,
          })),
        }
      : {}),
  };

  for (const [name, packages] of Object.entries(PACKAGE_PINS) as [keyof typeof PACKAGE_PINS, never][])
    components[name] = { kind: 'packages', version: PACKAGE_COMPONENT_VERSIONS[name], packages };

  const aptSnapshot = add(input.aptSnapshot);

  if (input.aptPackages?.length && !aptSnapshot) throw new Error('apt packages need the apt snapshot index');

  const aptPackages = (input.aptPackages ?? []).map((file) => add(file) as string);

  for (const extra of input.extraArtifacts ?? []) add(extra);

  return releaseManifestSchema.parse({
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    product: 'loadweaver',
    version: input.version,
    channel: input.channel,
    created: input.created,
    notes: input.notes ?? [],
    ...(input.minimumVersion ? { minimumVersion: input.minimumVersion } : {}),
    components,
    ...(aptSnapshot ? { aptSnapshot } : {}),
    ...(aptPackages.length ? { aptPackages } : {}),
    artifacts: [...artifacts.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
}
