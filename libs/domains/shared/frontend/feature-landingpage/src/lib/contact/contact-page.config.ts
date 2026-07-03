import type { SharedContactDetails } from './shared-contact-details.constants';

export const SHARED_CONTACT_PAGE_DATA_KEY = 'contactPage';

/** Matches inner-page hero styling for each landing app brand. */
export type SharedContactPageHeroTheme = 'forepath' | 'dark';

export interface SharedContactPageConfig {
  /** Absolute canonical URL for SEO meta tags (brand-specific). */
  canonicalUrl: string;
  heroTheme: SharedContactPageHeroTheme;
  contactDetails: SharedContactDetails;
}
