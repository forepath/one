import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

/**
 * Resolves the browser dist folder for a locale SSR bundle.
 *
 * Localized builds place prerendered HTML under `browser/<locale>/…` while each
 * locale Express entry lives at `server/<locale>/server.mjs`. Non-localized
 * layouts fall back to `../browser`.
 */
export function resolveLocalizedBrowserDistFolder(serverDistFolder: string): string {
  const localeCandidate = basename(serverDistFolder);
  const localizedBrowserFolder = resolve(serverDistFolder, '../browser', localeCandidate);

  if (existsSync(localizedBrowserFolder)) {
    return localizedBrowserFolder;
  }

  return resolve(serverDistFolder, '../browser');
}

/**
 * Strips a leading `/{locale}` segment when present so static/SSR handlers that
 * mount `browser/<locale>` receive paths like `/pricing` instead of `/en/pricing`.
 */
export function stripLocalePrefixFromPath(pathname: string, locale: string): string {
  const prefix = `/${locale}`;

  if (pathname === prefix) {
    return '/';
  }

  if (pathname.startsWith(`${prefix}/`)) {
    const stripped = pathname.slice(prefix.length);

    return stripped.length > 0 ? stripped : '/';
  }

  return pathname;
}
