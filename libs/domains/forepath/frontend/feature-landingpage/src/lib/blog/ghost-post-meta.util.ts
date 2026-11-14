import { filterGhostDisplayTags } from './ghost-ai-tags.util';
import type { GhostPost } from './ghost.types';

export function resolveGhostPostDescription(post: GhostPost): string {
  return (post.meta_description ?? post.custom_excerpt ?? post.excerpt ?? '').trim();
}

export function resolveGhostPostImageUrl(post: GhostPost, fallbackImageUrl: string): string {
  return post.og_image ?? post.feature_image ?? fallbackImageUrl;
}

export function resolveGhostPostKeywords(post: GhostPost): string | undefined {
  const tags = filterGhostDisplayTags(post.tags)
    .map((tag) => tag.name)
    .filter(Boolean);

  if (tags.length === 0) {
    return undefined;
  }

  return tags.join(', ');
}

export function resolveGhostPostAuthorName(post: GhostPost): string {
  return post.primary_author?.name?.trim() || 'IPvX UG (haftungsbeschränkt)';
}
