// Delegating server entry — import from
// `@forepath/shared/frontend/util-express-server/delegating-server` (no Angular SSR).
export {
  createDelegatingServer,
  resolveLocaleFromRequest,
  resolveLocalizedStaticFilePath,
  startDelegatingServerFromImportMetaUrl,
  type CreateDelegatingServerOptions,
  type DelegatingServerHandle,
  type LocaleExpressHandler,
} from './lib/create-delegating-server';
export { resolveLocalizedBrowserDistFolder, stripLocalePrefixFromPath } from './lib/localized-browser-dist';
