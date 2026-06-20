import { Meta } from '@angular/platform-browser';

import {
  addPageMetaTags,
  buildSocialPreviewMetaTags,
  createDocsPageDynamicMetaTagStubs,
  formatSocialPreviewDescription,
  formatSocialPreviewTitle,
  getMetaTagSelector,
  removePageMetaTags,
  resolveSocialCanonicalUrl,
} from './social-preview-meta.util';

describe('resolveSocialCanonicalUrl', () => {
  it('returns the URL unchanged when localization is disabled', () => {
    expect(resolveSocialCanonicalUrl('https://agenstra.com/cloud', 'de', false)).toBe('https://agenstra.com/cloud');
  });

  it('prefixes the locale segment in production multilingual mode', () => {
    expect(resolveSocialCanonicalUrl('https://agenstra.com/cloud', 'de', true)).toBe('https://agenstra.com/de/cloud');
  });

  it('localizes the home URL', () => {
    expect(resolveSocialCanonicalUrl('https://agenstra.com', 'en', true)).toBe('https://agenstra.com/en');
  });

  it('does not duplicate an existing locale segment', () => {
    expect(resolveSocialCanonicalUrl('https://agenstra.com/en/cloud', 'de', true)).toBe(
      'https://agenstra.com/en/cloud',
    );
  });
});

describe('formatSocialPreviewTitle', () => {
  it('truncates long titles with an ellipsis', () => {
    const title = 'A'.repeat(80);
    const result = formatSocialPreviewTitle(title, 60);

    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('formatSocialPreviewDescription', () => {
  it('truncates descriptions beyond the social limit', () => {
    const description = 'word '.repeat(80);
    const result = formatSocialPreviewDescription(description);

    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe('getMetaTagSelector', () => {
  it('builds selectors for name and property tags', () => {
    expect(getMetaTagSelector({ name: 'description', content: 'x' })).toBe('name="description"');
    expect(getMetaTagSelector({ property: 'og:title', content: 'x' })).toBe('property="og:title"');
  });
});

describe('addPageMetaTags', () => {
  it('removes the same tags on cleanup', () => {
    const meta = {
      addTags: jest.fn(),
      removeTag: jest.fn(),
    } as unknown as Meta;
    const tags = [{ name: 'description', content: 'Example' }];
    const cleanup = addPageMetaTags(meta, tags);

    cleanup();

    expect(meta.addTags).toHaveBeenCalledWith(tags);
    expect(meta.removeTag).toHaveBeenCalledWith('name="description"');
  });
});

describe('removePageMetaTags', () => {
  it('removes every known tag selector', () => {
    const meta = {
      removeTag: jest.fn(),
    } as unknown as Meta;
    const tags = buildSocialPreviewMetaTags({
      title: 'Example',
      description: 'Short description.',
      canonicalUrl: 'https://agenstra.com/example',
      imageUrl: 'https://agenstra.com/assets/images/og-preview.png',
    });

    removePageMetaTags(meta, tags);

    expect(meta.removeTag).toHaveBeenCalledTimes(tags.length);
  });
});

describe('buildSocialPreviewMetaTags', () => {
  it('includes Open Graph and Twitter Card properties', () => {
    const tags = buildSocialPreviewMetaTags({
      title: 'Example :: Agenstra',
      description: 'Short description.',
      canonicalUrl: 'https://agenstra.com/example',
      imageUrl: 'https://agenstra.com/assets/images/og-preview.png',
      localeId: 'en',
      localizeCanonicalUrl: true,
    });

    expect(tags).toEqual(
      expect.arrayContaining([
        { property: 'og:title', content: 'Example :: Agenstra' },
        { property: 'og:url', content: 'https://agenstra.com/en/example' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: 'https://agenstra.com/assets/images/og-preview.png' },
      ]),
    );
  });

  it('uses the provided site name for og:site_name', () => {
    const tags = buildSocialPreviewMetaTags({
      title: 'Documentation :: Decabill',
      description: 'Short description.',
      canonicalUrl: 'https://docs.decabill.com/docs',
      imageUrl: 'https://decabill.com/assets/images/og-preview.png',
      siteName: 'Decabill',
    });

    expect(tags).toEqual(expect.arrayContaining([{ property: 'og:site_name', content: 'Decabill' }]));
  });
});

describe('createDocsPageDynamicMetaTagStubs', () => {
  it('builds brand-specific social preview stubs for cleanup', () => {
    const tags = createDocsPageDynamicMetaTagStubs({
      docsSiteOrigin: 'https://docs.decabill.com',
      imageUrl: 'https://decabill.com/assets/images/og-preview.png',
      siteName: 'Decabill',
    });

    expect(tags).toEqual(
      expect.arrayContaining([
        { name: 'description', content: '' },
        { name: 'canonical', content: '' },
        { property: 'og:site_name', content: 'Decabill' },
        { property: 'og:url', content: 'https://docs.decabill.com' },
        { property: 'og:image', content: 'https://decabill.com/assets/images/og-preview.png' },
      ]),
    );
  });
});
