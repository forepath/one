import { startDelegatingServerFromImportMetaUrl } from '@forepath/shared/frontend/util-express-server/delegating-server';

function shouldBypassStatic(pathname: string): boolean {
  return pathname === '/' || pathname === '/blog' || pathname.startsWith('/blog/');
}

startDelegatingServerFromImportMetaUrl(import.meta.url, {
  availableLocales: ['en', 'de'],
  defaultLocale: process.env['DEFAULT_LOCALE'] || 'en',
  shouldBypassStatic,
  rootRedirectPath: '/',
});

export default undefined;
