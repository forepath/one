import { startDelegatingServerFromImportMetaUrl } from '@forepath/shared/frontend/util-express-server/delegating-server';

startDelegatingServerFromImportMetaUrl(import.meta.url, {
  availableLocales: ['en', 'de'],
  defaultLocale: process.env['DEFAULT_LOCALE'] || 'en',
  rootRedirectPath: '/',
});

export default undefined;
