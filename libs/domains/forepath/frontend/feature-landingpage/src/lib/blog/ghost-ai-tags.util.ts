import type { GhostPost, GhostTag } from './ghost.types';

export const GHOST_AI_GENERATED_TAG = 'AI Generated';
export const GHOST_AI_MODIFIED_TAG = 'AI Modified';

export const GHOST_AI_GENERATED_LABEL_SRC = '/assets/images/LABEL_AI%20GENERATED_black.svg';
export const GHOST_AI_MODIFIED_LABEL_SRC = '/assets/images/LABEL_AI%20MODIFIED_black.svg';
export const GHOST_AI_GENERATED_LABEL_ON_IMAGE_SRC = '/assets/images/LABEL_AI%20GENERATED_black%20transparent.svg';
export const GHOST_AI_MODIFIED_LABEL_ON_IMAGE_SRC = '/assets/images/LABEL_AI%20MODIFIED_black%20transparent.svg';

export interface GhostAiMarkers {
  generated: boolean;
  modified: boolean;
}

export function isGhostAiMarkerTag(name: string | null | undefined): boolean {
  return name === GHOST_AI_GENERATED_TAG || name === GHOST_AI_MODIFIED_TAG;
}

export function hasGhostAiMarkers(markers: GhostAiMarkers): boolean {
  return markers.generated || markers.modified;
}

export function getGhostAiMarkers(post: Pick<GhostPost, 'tags'>): GhostAiMarkers {
  const names = new Set((post.tags ?? []).map((tag) => tag.name));

  return {
    generated: names.has(GHOST_AI_GENERATED_TAG),
    modified: names.has(GHOST_AI_MODIFIED_TAG),
  };
}

export function filterGhostDisplayTags(tags: GhostTag[] | null | undefined): GhostTag[] {
  return (tags ?? []).filter((tag) => !isGhostAiMarkerTag(tag.name));
}

export function resolveGhostPrimaryDisplayTag(post: Pick<GhostPost, 'primary_tag' | 'tags'>): GhostTag | null {
  const primaryTag = post.primary_tag;

  if (primaryTag && !isGhostAiMarkerTag(primaryTag.name)) {
    return primaryTag;
  }

  return filterGhostDisplayTags(post.tags)[0] ?? null;
}
