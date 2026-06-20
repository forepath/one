/** Conservative limit for ~580px in Google SERP title rendering. */
const META_TITLE_MAX_LENGTH = 58;
/** Conservative limit for ~920px in Google SERP description rendering. */
const META_DESCRIPTION_MAX_LENGTH = 155;

/**
 * Formats a browser title as "<page title> :: <productName>", truncating when needed.
 */
export function formatProductMetaTitle(pageTitle: string, productName: string): string {
  const suffix = ` :: ${productName}`;
  const trimmed = pageTitle.trim();
  const maxPageLength = META_TITLE_MAX_LENGTH - suffix.length;
  const page = trimmed.length > maxPageLength ? `${trimmed.slice(0, maxPageLength - 1).trimEnd()}…` : trimmed;

  return `${page}${suffix}`;
}

/**
 * Formats a browser title as "<page title> :: Agenstra", truncating when needed.
 */
export function formatAgenstraMetaTitle(pageTitle: string): string {
  return formatProductMetaTitle(pageTitle, 'Agenstra');
}

/**
 * Truncates a meta description for SERP limits (~920px total).
 */
export function formatAgenstraMetaDescription(description: string): string {
  const trimmed = description.trim();

  if (trimmed.length <= META_DESCRIPTION_MAX_LENGTH) {
    return trimmed;
  }

  const cut = trimmed.slice(0, META_DESCRIPTION_MAX_LENGTH - 1).trimEnd();

  return cut.endsWith('.') ? `${cut}…` : `${cut}…`;
}
