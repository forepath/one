import { environment } from './environment';

/** Builds a browser tab title from a localized page label and the configured product name. */
export function buildPageTitle(pageName: string): string {
  return `${pageName} :: ${environment.productName}`;
}
