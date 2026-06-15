import type { Meta, MetaDefinition } from '@angular/platform-browser';

import { formatAgenstraMetaDescription } from './page-meta.util';

/** Recommended display limit for Open Graph titles. */
const OG_TITLE_MAX_LENGTH = 60;
/** Official limit for Twitter Card titles. */
const TWITTER_TITLE_MAX_LENGTH = 70;
/** Conservative limit for Open Graph and Twitter descriptions. */
const SOCIAL_DESCRIPTION_MAX_LENGTH = 200;

export const AGENSTRA_SOCIAL_SITE_NAME = 'Agenstra';

const OG_IMAGE_WIDTH = '1200';
const OG_IMAGE_HEIGHT = '630';

export interface SocialPreviewMetaInput {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
  localeId?: string;
  siteName?: string;
  type?: 'website' | 'article';
  localizeCanonicalUrl?: boolean;
}

export interface PageMetaTagsInput {
  description: string;
  keywords?: string;
  author?: string;
  robots: string;
  canonicalUrl?: string;
  socialTitle: string;
  socialDescription: string;
  socialImageUrl: string;
  localeId: string;
  localizeCanonicalUrl: boolean;
  socialType?: 'website' | 'article';
}

/**
 * Inserts a locale segment after the host for production multilingual routes (/en/, /de/).
 */
export function resolveSocialCanonicalUrl(
  canonicalUrl: string,
  localeId: string,
  localizeCanonicalUrl: boolean,
): string {
  if (!localizeCanonicalUrl) {
    return canonicalUrl;
  }

  const locale = localeId.toLowerCase().split('-')[0];

  if (locale !== 'en' && locale !== 'de') {
    return canonicalUrl;
  }

  const url = new URL(canonicalUrl);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  if (pathSegments.length > 0 && (pathSegments[0] === 'en' || pathSegments[0] === 'de')) {
    return canonicalUrl;
  }

  const path = url.pathname === '/' ? '' : url.pathname;

  url.pathname = path ? `/${locale}${path}` : `/${locale}`;

  return url.href;
}

export function formatSocialPreviewTitle(title: string, maxLength: number): string {
  const trimmed = title.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const cut = trimmed.slice(0, maxLength - 1).trimEnd();

  return `${cut}…`;
}

export function formatSocialPreviewDescription(description: string): string {
  const trimmed = description.trim();

  if (trimmed.length <= SOCIAL_DESCRIPTION_MAX_LENGTH) {
    return trimmed;
  }

  const cut = trimmed.slice(0, SOCIAL_DESCRIPTION_MAX_LENGTH - 1).trimEnd();

  return cut.endsWith('.') ? `${cut}…` : `${cut}…`;
}

export function mapLocaleIdToOpenGraphLocale(localeId: string): string {
  const locale = localeId.toLowerCase();

  if (locale.startsWith('de')) {
    return 'de_DE';
  }

  return 'en_US';
}

export function buildSocialPreviewMetaTags(input: SocialPreviewMetaInput): MetaDefinition[] {
  const canonicalUrl = resolveSocialCanonicalUrl(
    input.canonicalUrl,
    input.localeId ?? 'en',
    input.localizeCanonicalUrl ?? false,
  );
  const ogTitle = formatSocialPreviewTitle(input.title, OG_TITLE_MAX_LENGTH);
  const twitterTitle = formatSocialPreviewTitle(input.title, TWITTER_TITLE_MAX_LENGTH);
  const description = formatSocialPreviewDescription(formatAgenstraMetaDescription(input.description));
  const siteName = input.siteName ?? AGENSTRA_SOCIAL_SITE_NAME;
  const type = input.type ?? 'website';
  const ogLocale = mapLocaleIdToOpenGraphLocale(input.localeId ?? 'en');

  return [
    { property: 'og:title', content: ogTitle },
    { property: 'og:description', content: description },
    { property: 'og:url', content: canonicalUrl },
    { property: 'og:type', content: type },
    { property: 'og:site_name', content: siteName },
    { property: 'og:locale', content: ogLocale },
    { property: 'og:image', content: input.imageUrl },
    { property: 'og:image:width', content: OG_IMAGE_WIDTH },
    { property: 'og:image:height', content: OG_IMAGE_HEIGHT },
    { property: 'og:image:type', content: 'image/png' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: twitterTitle },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: input.imageUrl },
  ];
}

/**
 * Builds standard page meta tags plus Open Graph and Twitter Card tags.
 */
export function buildPageMetaTags(input: PageMetaTagsInput): MetaDefinition[] {
  const description = formatAgenstraMetaDescription(input.description);
  const canonicalUrl = input.canonicalUrl
    ? resolveSocialCanonicalUrl(input.canonicalUrl, input.localeId, input.localizeCanonicalUrl)
    : undefined;
  const tags: MetaDefinition[] = [
    { name: 'description', content: description },
    { name: 'robots', content: input.robots },
  ];

  if (input.keywords) {
    tags.push({ name: 'keywords', content: input.keywords });
  }

  if (input.author) {
    tags.push({ name: 'author', content: input.author });
  }

  if (canonicalUrl) {
    tags.push({ name: 'canonical', content: canonicalUrl });
  }

  tags.push(
    ...buildSocialPreviewMetaTags({
      title: input.socialTitle,
      description: input.socialDescription,
      canonicalUrl: input.canonicalUrl ?? canonicalUrl ?? '',
      imageUrl: input.socialImageUrl,
      localeId: input.localeId,
      localizeCanonicalUrl: input.localizeCanonicalUrl,
      type: input.socialType,
    }),
  );

  return tags;
}

/**
 * Meta tags updated at runtime on documentation pages (description, canonical, social).
 */
export const DOCS_PAGE_DYNAMIC_META_TAG_STUBS: MetaDefinition[] = [
  { name: 'description', content: '' },
  { name: 'canonical', content: '' },
  ...buildSocialPreviewMetaTags({
    title: '',
    description: '',
    canonicalUrl: 'https://docs.agenstra.com',
    imageUrl: 'https://docs.agenstra.com/assets/images/og-preview.png',
  }),
];

export function getMetaTagSelector(tag: MetaDefinition): string | null {
  if ('name' in tag && tag.name) {
    return `name="${tag.name}"`;
  }

  if ('property' in tag && tag.property) {
    return `property="${tag.property}"`;
  }

  return null;
}

/**
 * Removes previously added page meta tags by name or property selector.
 */
export function removePageMetaTags(meta: Meta, tags: MetaDefinition[]): void {
  for (const tag of tags) {
    const selector = getMetaTagSelector(tag);

    if (selector) {
      meta.removeTag(selector);
    }
  }
}

/**
 * Adds page meta tags and returns a cleanup function for component destroy.
 */
export function addPageMetaTags(meta: Meta, tags: MetaDefinition[]): () => void {
  meta.addTags(tags);

  return () => removePageMetaTags(meta, tags);
}

/**
 * Updates Open Graph and Twitter Card tags when page metadata changes at runtime.
 */
export function applySocialPreviewMeta(
  updateTag: (tag: MetaDefinition, selector?: string) => void,
  input: SocialPreviewMetaInput,
): void {
  for (const tag of buildSocialPreviewMetaTags(input)) {
    updateTag(tag);
  }
}
