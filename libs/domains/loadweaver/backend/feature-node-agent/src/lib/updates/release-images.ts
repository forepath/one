import type { RegistryClient } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Logger } from '@nestjs/common';
import {
  COMPONENT_IMAGES,
  IMAGE_OVERRIDE_ENV,
  imageComponents,
  imageReference,
  type ImageComponentName,
  type ReleaseManifest,
} from '@forepath/loadweaver/shared/util-release';

/**
 * The platform images the node runs (3.26), in order of precedence:
 * 1. a development override from the environment (`LOADWEAVER_*_IMAGE`; logged once, reported, and listed as a
 *    warning in update plans),
 * 2. an image held back for a component (`holdComponentImage`: the leader's Spilo while its switchover failed),
 * 3. the image of the release the control plane set for this node (from the verified manifest),
 * 4. this agent build's own pins (`COMPONENT_IMAGES`, the source of truth the release bundle is built from).
 * Process-wide state on purpose: every manager asks for its component's image when it renders a container spec.
 */
const logger = new Logger('ReleaseImages');
let release: { version: string; images: Partial<Record<ImageComponentName, string>> } | null = null;
const warned = new Set<string>();

/** Sets (or clears) the release whose images the node runs. */
export function setReleaseImages(manifest: ReleaseManifest | null): void {
  if (!manifest) {
    release = null;

    return;
  }

  release = {
    version: manifest.version,
    images: Object.fromEntries(
      Object.entries(imageComponents(manifest)).map(([name, component]) => [name, imageReference(component)]),
    ) as Partial<Record<ImageComponentName, string>>,
  };
}

/**
 * Components kept on an earlier image although the release names another (3.26: the Patroni leader's Spilo stays on
 * its image while the ordered switchover failed). Cleared per component with `null`.
 */
const held = new Map<ImageComponentName, string>();

export function holdComponentImage(name: ImageComponentName, image: string | null): void {
  if (image) held.set(name, image);
  else held.delete(name);
}

export function heldComponents(): ImageComponentName[] {
  return [...held.keys()];
}

export function releaseImagesVersion(): string | null {
  return release?.version ?? null;
}

/** The image of a component on this node. */
export function componentImage(name: ImageComponentName, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[IMAGE_OVERRIDE_ENV[name]]?.trim();

  if (override) {
    if (!warned.has(name)) {
      warned.add(name);
      logger.warn(`${IMAGE_OVERRIDE_ENV[name]} overrides the ${name} image (development only): ${override}`);
    }

    return override;
  }

  return held.get(name) ?? release?.images[name] ?? COMPONENT_IMAGES[name];
}

let routing: { client: RegistryClient; components: Set<string> } | null = null;

/** Repository of release images imported into the cluster registry (3.26). */
export const SYSTEM_REPOSITORY = 'lw-system';

/**
 * Where the release's images were imported into the cluster registry (`lw-system/<component>`): air-gapped nodes pull
 * them there, by the same digest, through the node's registry router.
 */
export function setClusterImageRouting(client: RegistryClient | undefined, components: readonly string[]): void {
  routing = client && components.length ? { client, components: new Set(components) } : null;
}

/** Private repositories the router must allow for the release's images. */
export function clusterImageRepositories(): string[] {
  return routing ? [...routing.components].map((c) => `${SYSTEM_REPOSITORY}/${c}`) : [];
}

/**
 * The cluster-registry copy of a release image (routed through the node's registry router), or null when the image
 * isn't one of the release's imported images.
 */
export function clusterImageFor(image: string): string | null {
  if (!routing || !release) return null;

  const at = image.lastIndexOf('@');
  const digest = at >= 0 ? image.slice(at + 1) : null;

  if (!digest) return null;

  for (const [name, reference] of Object.entries(release.images))
    if (routing.components.has(name) && reference?.endsWith(`@${digest}`))
      return `127.0.0.1:${routing.client.routerPort}/${routing.client.privateHost}/${SYSTEM_REPOSITORY}/${name}@${digest}`;

  return null;
}

/** Components whose image comes from a development override. */
export function imageOverrides(env: NodeJS.ProcessEnv = process.env): ImageComponentName[] {
  return (Object.keys(IMAGE_OVERRIDE_ENV) as ImageComponentName[]).filter(
    (name) => !!env[IMAGE_OVERRIDE_ENV[name]]?.trim(),
  );
}
