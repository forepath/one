import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, LOCALE_ID, PLATFORM_ID } from '@angular/core';
import { type CanActivateFn } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';

const BLOG_LOCALE = 'en';

/**
 * The blog is only published in English. In deployed (localized) builds, in-app
 * navigation to a blog route from another locale reloads the English variant
 * (e.g. `/de/blog/my-post` → `/en/blog/my-post`). Direct requests are redirected
 * by the delegating server; local development serves a single locale and is unaffected.
 */
export const blogLocaleGuard: CanActivateFn = (_route, state) => {
  const environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  const locale = inject(LOCALE_ID);

  if (!environment.application.production || locale === BLOG_LOCALE || !isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  inject(DOCUMENT).location.replace(`/${BLOG_LOCALE}${state.url}`);

  return false;
};
