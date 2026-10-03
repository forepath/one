import { inject } from '@angular/core';

import { ENVIRONMENT } from './environment.token';

/** Builds a browser tab title from a localized page label and the configured product name. */
export function buildPageTitle(pageName: string): string {
  const environment = inject(ENVIRONMENT);

  return `${pageName} :: ${environment.application.productName}`;
}
