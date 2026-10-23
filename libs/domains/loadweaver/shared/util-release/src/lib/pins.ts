import type { NodeArch, SupportedHostOs } from './manifest';

/**
 * The component pins of this source tree (3.26): the one source of truth the release bundle is built from (CI,
 * `build-bundle`), and what the node agent runs when its desired state names no release yet (fresh joins, older
 * control planes). Every image is pinned by digest (section 6). `LOADWEAVER_*_IMAGE` environment overrides remain
 * for development only: the agent logs a warning, and update plans list the override as a warning.
 *
 * The control-plane and microVM launcher images are built per release; here they are moving development tags, and the
 * bundle builder replaces them with the release's digests (`RELEASE_BUILT_IMAGES`).
 */
export const COMPONENT_IMAGES = {
  'control-plane': 'ghcr.io/forepath/loadweaver-control-plane-api:latest',
  envoy: 'docker.io/envoyproxy/envoy:v1.40.0@sha256:459f2a6404c340fe6afccd69d85527012d47f3c036765493e6f8f3113fa384de',
  ratelimit:
    'docker.io/envoyproxy/ratelimit:f4e76690@sha256:83b1664a194ff9fc1ff30b0868573115a2d01a1b6e2a3f8961724f9a79bf1cd0',
  valkey:
    'docker.io/valkey/valkey:9.0.6-alpine@sha256:187679e3bd4036959631e3f03983ab2ba503ab21e6fd0454d508e909db2ee989',
  etcd: 'quay.io/coreos/etcd:v3.5.21@sha256:a3ccd299377af4b9968d8cbaaf9722fe354297f11908f74a846075e1e5f4ee89',
  postgres: 'ghcr.io/zalando/spilo-17:4.0-p3@sha256:b7db9e8f62e809ebd9a0679fbdba147a811fdd240ab78380ea4720a46a017184',
  opensearch:
    'docker.io/opensearchproject/opensearch:3.9.0@sha256:adfa61f85025d06b4aeb562e7e74fde7e31c437039c93c3862c17e9acebd6c7c',
  garage: 'docker.io/dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020',
  registry: 'docker.io/library/registry:3.1.2@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8',
  bind9:
    'docker.io/internetsystemsconsortium/bind9:9.20@sha256:071465f88068854d0ceadd9b985fb1acae4071e80754e545cd811fde57541ad0',
  trivy: 'docker.io/aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222',
  'node-shell': 'docker.io/library/alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8',
  // Backups (3.20): repository servers on the members and the snapshot client on every node (official image index).
  kopia: 'docker.io/kopia/kopia:0.23.1@sha256:89fd95ee2942880ca00eae964266958a394421ddbdf69bca62e38afc55f5900e',
  // MicroVMs and full VMs (3.35): the shared KVM launcher (`apps/shared/microvm-launcher`, amd64 + arm64).
  'microvm-launcher': 'ghcr.io/forepath/microvm-launcher:latest',
} as const;

export type ImageComponentName = keyof typeof COMPONENT_IMAGES;

/** Development overrides per image component (agent environment). */
export const IMAGE_OVERRIDE_ENV: Record<ImageComponentName, string> = {
  'control-plane': 'LOADWEAVER_CONTROL_PLANE_IMAGE',
  envoy: 'LOADWEAVER_ENVOY_IMAGE',
  ratelimit: 'LOADWEAVER_RATELIMIT_IMAGE',
  valkey: 'LOADWEAVER_QUEUE_IMAGE',
  etcd: 'LOADWEAVER_ETCD_IMAGE',
  postgres: 'LOADWEAVER_POSTGRES_IMAGE',
  opensearch: 'LOADWEAVER_OPENSEARCH_IMAGE',
  garage: 'LOADWEAVER_GARAGE_IMAGE',
  registry: 'LOADWEAVER_REGISTRY_IMAGE',
  bind9: 'LOADWEAVER_BIND9_IMAGE',
  trivy: 'LOADWEAVER_TRIVY_IMAGE',
  'node-shell': 'LOADWEAVER_NODE_SHELL_IMAGE',
  kopia: 'LOADWEAVER_KOPIA_IMAGE',
  'microvm-launcher': 'LOADWEAVER_MICROVM_LAUNCHER_IMAGE',
};

/**
 * Images built by the release pipeline itself (moving development tags in `COMPONENT_IMAGES`); the bundle builder
 * pins them to the release's digests. Required ones must be given; optional ones are left out of a manifest built
 * without them (development bundles), and nodes then fall back to the development tag or the override.
 */
export const RELEASE_BUILT_IMAGES: Readonly<Partial<Record<ImageComponentName, 'required' | 'optional'>>> = {
  'control-plane': 'required',
  'microvm-launcher': 'optional',
};

/**
 * OpenSearch snapshots to the object store need the official `repository-s3` plugin (M6 spike: 3.9.0 doesn't ship
 * it); release builds bake it into a derived image (`opensearch-s3.Dockerfile`) verified by this checksum.
 */
export const OPENSEARCH_REPOSITORY_S3 = {
  version: '3.9.0',
  url: 'https://artifacts.opensearch.org/releases/plugins/repository-s3/3.9.0/repository-s3-3.9.0.zip',
  sha512:
    'bde558e2be3fdab306b02a51d92aee7b08cb9759e9c38dc204ed8c897720da8316a2776ecc1b2a6a8cc6876144b94bb00c813a5b7c118b37ad8b46dd2cb13cb7',
} as const;

/** gVisor release tarball (`runsc` + `gvisor-bin/` sidecars), pinned as a whole (M6 spike). */
export const GVISOR_PIN = {
  release: '20261012.0',
  urlTemplate: 'https://storage.googleapis.com/gvisor/releases/release/{release}/{arch}/gvisor.tar.bz2',
  sha512: {
    amd64:
      '9606445eed5aedfcf05310e7ccef61d994089914c6622fc82624c24d2b18db1b2210f40e40a7be27b8b7772859de7d95c501b4eba66423053c960bf671377c5e',
    arm64:
      '2fe7425abd16ad6ca649ab9bc3d7e8e76756834d86ffcc08dbe97c82c3b7262a7d6401f23632f2b296649cc1408b560416b2ab65a4043aa123fc7b90f3a1b2e2',
  } satisfies Record<NodeArch, string>,
} as const;

/** gVisor's architecture names in its download paths. */
export const GVISOR_ARCH: Record<NodeArch, 'x86_64' | 'aarch64'> = { amd64: 'x86_64', arm64: 'aarch64' };

/**
 * DRBD 9 kernel module (3.5): distribution kernels ship DRBD 8.4 (Debian 13 has no `drbd-dkms`), so the bundle
 * carries LINBIT's source (builds in ~40 s against the kernel headers, M6 spike) and prebuilt modules per supported
 * kernel ABI where the release pipeline built them.
 */
export const DRBD_PIN = {
  version: '9.2.20',
  url: 'https://pkg.linbit.com//downloads/drbd/9/drbd-9.2.20.tar.gz',
  sha256: '4a6ecd048cd41aef6427b99bfcb2b14e16f36f0b1e1626e5751d345ecd2b0962',
} as const;

type PackagePins = Partial<Record<SupportedHostOs, Record<string, string>>>;

/**
 * Host packages per supported OS, pinned to tested versions and installed from the cluster-local apt source.
 * Debian 13 is the VM lab's golden image (tested); other releases carry the archives' versions of the packages
 * Loadweaver depends on (not lab-tested). Packages without a pin for an OS follow the frozen apt snapshot.
 */
export const PACKAGE_PINS: Record<'storage' | 'docker' | 'containerd' | 'criu' | 'bird' | 'wireguard', PackagePins> = {
  // Replicated volumes: LVM thin -> LUKS2 -> DRBD 9 userland.
  storage: {
    'debian:13': {
      lvm2: '2.03.31-2',
      cryptsetup: '2:2.7.5-2',
      'drbd-utils': '9.22.0-1.1',
      'thin-provisioning-tools': '1.1.0-4+b1',
    },
    'debian:12': {
      lvm2: '2.03.16-2',
      cryptsetup: '2:2.6.1-4~deb12u2',
      'drbd-utils': '9.22.0-1',
      'thin-provisioning-tools': '0.9.0-2',
    },
    'ubuntu:24.04': {
      lvm2: '2.03.16-3ubuntu3.2',
      cryptsetup: '2:2.7.0-1ubuntu4.2',
      'drbd-utils': '9.22.0-1build1',
      'thin-provisioning-tools': '0.9.0-2ubuntu5.1',
    },
    'ubuntu:22.04': {
      lvm2: '2.03.11-2.1ubuntu5',
      cryptsetup: '2:2.4.3-1ubuntu1.3',
      'drbd-utils': '9.15.0-1ubuntu0.1',
      'thin-provisioning-tools': '0.9.0-2ubuntu1',
    },
  },
  // Docker Engine with live-restore (runc 1.5.2 comes with containerd.io 2.4.2).
  docker: {
    'debian:13': { 'docker-ce': '5:29.9.1-1~debian.13~trixie', 'docker-ce-cli': '5:29.9.1-1~debian.13~trixie' },
  },
  containerd: { 'debian:13': { 'containerd.io': '2.4.2-2~debian.13~trixie' } },
  criu: { 'debian:13': { criu: '4.1.1-1' } },
  bird: { 'debian:13': { bird2: '2.17.5-0+deb13u1' }, 'debian:12': { bird2: '2.0.12-7' } },
  wireguard: {
    'debian:13': { 'wireguard-tools': '1.0.20210914-3' },
    'debian:12': { 'wireguard-tools': '1.0.20210914-1+b1' },
  },
};

/**
 * Host packages the microVM guest-root cache needs (3.35, M7.2): `attr` (`setfattr`: overlay whiteouts / opaque
 * directories while unpacking layers) and `e2fsprogs` (`mkfs.ext4`: per-replica writable layers on thin LVs / loop
 * images). Installed by the node installer and rooted in the release's apt bundle; their versions follow the frozen
 * apt snapshot (no `PACKAGE_PINS` entry).
 */
export const MICROVM_HOST_PACKAGES = ['attr', 'e2fsprogs'] as const;

/**
 * Host packages every node needs (installer and host updates): the installer installs them, and every host update
 * installs the ones missing on the node from the release's frozen apt snapshot (nodes installed before a package became
 * required; never from upstream, no reboot of its own). Rooted in the release's apt bundle, so air-gapped snapshots
 * carry them. New host dependencies go here (versions follow the snapshot unless `PACKAGE_PINS` pins them).
 */
export const REQUIRED_HOST_PACKAGES: readonly string[] = [...MICROVM_HOST_PACKAGES];

/** Versions shown for package components (the upstream version the pins correspond to). */
export const PACKAGE_COMPONENT_VERSIONS: Record<keyof typeof PACKAGE_PINS, string> = {
  storage: 'drbd-utils 9.22',
  docker: '29.9.1',
  containerd: '2.4.2 (runc 1.5.2)',
  criu: '4.1.1',
  bird: '2.17',
  wireguard: '1.0.20210914',
};

/** Splits `repo[:tag]@sha256:…` into its parts; null for references without a digest. */
export function splitImageReference(reference: string): { repository: string; tag?: string; digest: string } | null {
  const at = reference.lastIndexOf('@');

  if (at < 0) return null;

  const name = reference.slice(0, at);
  const digest = reference.slice(at + 1);
  const slash = name.lastIndexOf('/');
  const colon = name.lastIndexOf(':');
  const hasTag = colon > slash;

  return {
    repository: hasTag ? name.slice(0, colon) : name,
    ...(hasTag ? { tag: name.slice(colon + 1) } : {}),
    digest,
  };
}
