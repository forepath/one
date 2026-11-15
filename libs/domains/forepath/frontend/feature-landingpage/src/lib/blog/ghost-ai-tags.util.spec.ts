import {
  filterGhostDisplayTags,
  getGhostAiMarkers,
  hasGhostAiMarkers,
  isGhostAiMarkerTag,
  resolveGhostPrimaryDisplayTag,
} from './ghost-ai-tags.util';
import type { GhostPost, GhostTag } from './ghost.types';

function tag(name: string, id = name): GhostTag {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    description: null,
    feature_image: null,
    visibility: 'public',
    url: `/tag/${name}`,
  };
}

describe('ghost-ai-tags.util', () => {
  it('detects AI Generated and AI Modified tags', () => {
    const post: Pick<GhostPost, 'tags'> = {
      tags: [tag('Consulting'), tag('AI Generated'), tag('AI Modified')],
    };

    expect(getGhostAiMarkers(post)).toEqual({ generated: true, modified: true });
    expect(hasGhostAiMarkers(getGhostAiMarkers(post))).toBe(true);
  });

  it('filters AI marker tags from display lists', () => {
    const tags = [tag('Consulting'), tag('AI Generated'), tag('Cloud'), tag('AI Modified')];

    expect(filterGhostDisplayTags(tags).map((item) => item.name)).toEqual(['Consulting', 'Cloud']);
    expect(isGhostAiMarkerTag('AI Generated')).toBe(true);
    expect(isGhostAiMarkerTag('Consulting')).toBe(false);
  });

  it('skips AI primary tags when resolving the display eyebrow', () => {
    const post: Pick<GhostPost, 'primary_tag' | 'tags'> = {
      primary_tag: tag('AI Generated'),
      tags: [tag('AI Generated'), tag('Consulting'), tag('AI Modified')],
    };

    expect(resolveGhostPrimaryDisplayTag(post)?.name).toBe('Consulting');
  });
});
