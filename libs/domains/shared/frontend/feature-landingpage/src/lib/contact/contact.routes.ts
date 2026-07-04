import { Route } from '@angular/router';
import {
  CONTACT_REQUEST_FEATURE_KEY,
  ContactRequestFacade,
  contactRequestReducer,
  submitContactRequest$,
} from '@forepath/shared/frontend/data-access-communication';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { SharedContactPageComponent } from './contact-page.component';
import type { SharedContactPageConfig, SharedContactPageHeroTheme } from './contact-page.config';
import { SHARED_CONTACT_PAGE_DATA_KEY } from './contact-page.config';
import type { SharedContactDetails } from './shared-contact-details.constants';

export interface CreateSharedContactRouteOptions {
  /** Route path segment; defaults to `contact`. */
  path?: string;
  /** Brand-specific canonical URL passed via route data. */
  canonicalUrl: string;
  /** Hero styling variant; use `forepath` for ForePath, `dark` for Agenstra and Decabill. */
  heroTheme: SharedContactPageHeroTheme;
  contactDetails: SharedContactDetails;
}

export function createSharedContactRoute(options: CreateSharedContactRouteOptions): Route {
  const contactPage: SharedContactPageConfig = {
    canonicalUrl: options.canonicalUrl,
    heroTheme: options.heroTheme,
    contactDetails: options.contactDetails,
  };

  return {
    path: options.path ?? 'contact',
    component: SharedContactPageComponent,
    data: {
      [SHARED_CONTACT_PAGE_DATA_KEY]: contactPage,
    },
    providers: [
      ContactRequestFacade,
      provideState(CONTACT_REQUEST_FEATURE_KEY, contactRequestReducer),
      provideEffects({ submitContactRequest$ }),
    ],
  };
}
