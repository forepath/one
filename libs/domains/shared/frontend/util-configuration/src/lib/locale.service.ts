import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';

import { ENVIRONMENT } from './environment.token';

export interface LocaleOption {
  code: string;
  label: string;
}

const AVAILABLE_LOCALES: LocaleOption[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

@Injectable({
  providedIn: 'root',
})
export class LocaleService {
  private environment = inject(ENVIRONMENT);
  private platformId = inject(PLATFORM_ID);

  /**
   * Returns the list of available locales for the language switcher.
   */
  getAvailableLocales(): LocaleOption[] {
    return AVAILABLE_LOCALES;
  }

  /**
   * Returns the current locale code from the URL path (e.g. 'en' or 'de').
   * Returns the first available locale if no locale is present in the path.
   */
  getCurrentLocale(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return AVAILABLE_LOCALES[0].code;
    }

    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const firstSegment = pathSegments[0] ?? '';
    const isLocale = AVAILABLE_LOCALES.some((loc) => loc.code === firstSegment);

    return isLocale ? firstSegment : AVAILABLE_LOCALES[0].code;
  }

  /**
   * Builds the full URL for switching to the given language.
   * Redirects to /{langCode}/{currentRoute}?{currentQueryParams}
   * Preserves hash fragment if present.
   */
  getLanguageSwitchUrl(langCode: string): string {
    if (!isPlatformBrowser(this.platformId)) {
      return '/';
    }

    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const firstSegment = pathSegments[0] ?? '';
    const isFirstSegmentLocale = AVAILABLE_LOCALES.some((loc) => loc.code === firstSegment);
    const currentRoute = isFirstSegmentLocale ? pathSegments.slice(1).join('/') : pathSegments.join('/');
    const queryString = window.location.search ? window.location.search : '';
    const hash = window.location.hash ? window.location.hash : '';
    const path = currentRoute ? `/${langCode}/${currentRoute}` : `/${langCode}`;

    return `${window.location.origin}${path}${queryString}${hash}`;
  }
}
