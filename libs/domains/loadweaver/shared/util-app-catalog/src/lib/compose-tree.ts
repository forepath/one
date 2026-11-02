import { parse as parseYaml } from 'yaml';

import { isRecord } from './common';

/** A compose service as plain data (whatever the file says). */
export type ComposeService = Record<string, unknown>;

/** Parses compose YAML (or takes a parsed tree) and returns the tree and its services, or an error. */
export function composeServices(
  compose: string | Record<string, unknown>,
):
  | { ok: true; tree: Record<string, unknown>; services: Record<string, ComposeService> }
  | { ok: false; error: string } {
  let tree: unknown = compose;

  if (typeof compose === 'string') {
    try {
      tree = parseYaml(compose, { maxAliasCount: 100 });
    } catch (error) {
      return { ok: false, error: `compose.yaml is not valid YAML: ${(error as Error).message.split('\n')[0]}` };
    }
  }

  if (!isRecord(tree)) return { ok: false, error: 'compose.yaml must be a map' };

  const services = tree['services'];

  if (!isRecord(services)) return { ok: false, error: 'compose.yaml has no services' };

  return {
    ok: true,
    tree,
    services: Object.fromEntries(Object.entries(services).map(([name, s]) => [name, isRecord(s) ? s : {}])),
  };
}

/** An image reference pinned by digest (`…@sha256:<64 hex>`). */
export const PINNED_IMAGE_PATTERN = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

export interface UnpinnedImage {
  service: string;
  /** The image as written (empty when the service has none). */
  image: string;
}

/** Services whose image is not pinned by digest (or that have no image). */
export function findUnpinnedImages(compose: string | Record<string, unknown>): UnpinnedImage[] {
  const parsed = composeServices(compose);

  if (parsed.ok === false) throw new Error(parsed.error);

  return Object.entries(parsed.services).flatMap(([service, s]) => {
    const image = typeof s['image'] === 'string' ? s['image'] : '';

    return PINNED_IMAGE_PATTERN.test(image) ? [] : [{ service, image }];
  });
}
