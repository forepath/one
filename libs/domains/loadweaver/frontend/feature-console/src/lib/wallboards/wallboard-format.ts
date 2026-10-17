import type { WallboardToken } from '@forepath/loadweaver/frontend/data-access-console';

/** Wallboard tokens: `lw_wb_` and 43 base64url characters (like the API checks). */
export const WALLBOARD_TOKEN_PATTERN = /^lw_wb_[A-Za-z0-9_-]{43}$/;
export const MAX_WALLBOARD_PROJECTS = 20;
export const MAX_WALLBOARD_DAYS = 3650;

/**
 * The kiosk URL for a token: `<console>/kiosk#<token>`. The token stays in the fragment, which browsers never send
 * to a server, so it doesn't end up in access logs.
 */
export function kioskUrl(baseUri: string, token: string): string {
  return `${new URL('kiosk', baseUri).href}#${token}`;
}

/** The token from `location.hash`, or null when there is none or it can't be one. */
export function tokenFromHash(hash: string): string | null {
  let token = hash.replace(/^#/, '').trim();

  try {
    token = decodeURIComponent(token);
  } catch {
    return null;
  }

  return WALLBOARD_TOKEN_PATTERN.test(token) ? token : null;
}

export function wallboardScopeLabel(token: Pick<WallboardToken, 'projects'>): string {
  return token.projects?.length ? token.projects.join(', ') : $localize`:@@lwConsoleWallboards-cluster:Whole cluster`;
}
