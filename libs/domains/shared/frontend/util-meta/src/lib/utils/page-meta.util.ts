const META_TITLE_SUFFIX = ' :: Agenstra';
/** Conservative limit for ~580px in Google SERP title rendering. */
const META_TITLE_MAX_LENGTH = 58;
/** Conservative limit for ~920px in Google SERP description rendering. */
const META_DESCRIPTION_MAX_LENGTH = 155;

/**
 * Formats a browser title as "<page title> :: Agenstra", truncating when needed.
 */
export function formatAgenstraMetaTitle(pageTitle: string): string {
  const trimmed = pageTitle.trim();
  const maxPageLength = META_TITLE_MAX_LENGTH - META_TITLE_SUFFIX.length;
  const page = trimmed.length > maxPageLength ? `${trimmed.slice(0, maxPageLength - 1).trimEnd()}…` : trimmed;

  return `${page}${META_TITLE_SUFFIX}`;
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
