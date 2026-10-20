import { startDelegatingServerFromImportMetaUrl } from '@forepath/shared/frontend/util-express-server/delegating-server';

function isBlogPath(pathname: string): boolean {
  return pathname === '/blog' || pathname.startsWith('/blog/');
}

function shouldBypassStatic(pathname: string): boolean {
  return pathname === '/' || isBlogPath(pathname);
}

/**
 * The blog is only published in English, so localized blog URLs redirect to `/en`.
 */
function resolveForcedLocale(pathname: string): string | undefined {
  return isBlogPath(pathname) ? 'en' : undefined;
}

startDelegatingServerFromImportMetaUrl(import.meta.url, {
  availableLocales: ['en', 'de'],
  defaultLocale: process.env['DEFAULT_LOCALE'] || 'en',
  shouldBypassStatic,
  resolveForcedLocale,
});

export default undefined;
