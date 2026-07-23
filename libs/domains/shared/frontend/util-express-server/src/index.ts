// Docs SSR factory: `@forepath/shared/frontend/util-express-server/docs-server`
// SSR app factory: `@forepath/shared/frontend/util-express-server/ssr`
// Delegating i18n front: `@forepath/shared/frontend/util-express-server/delegating-server`
// (separate entries so esbuild console bundles do not pull in `@angular/ssr/node`).
export {
  registerRuntimeConfigEndpoint,
  type RuntimeConfigRouteEnv,
  type RuntimeConfigRouteLogger,
} from './lib/runtime-config-route';
export {
  createSecurityHeadersMiddleware,
  parseCspConnectSrcExtra,
  parseCspExtraOrigins,
  resolveCspFrameAncestorsSources,
  type SecurityHeadersEnv,
} from './lib/security-headers';
export { buildSsrAllowedHosts } from './lib/ssr-allowed-hosts';
export { resolveLocalizedBrowserDistFolder, stripLocalePrefixFromPath } from './lib/localized-browser-dist';
export {
  clearStaticMemoryCache,
  createMemoryStaticMiddleware,
  getCachedStaticFile,
  getContentTypeForStaticPath,
  isSourceMapPath,
  isStaticMemoryCacheEnabled,
  resolveStaticPathAgainstRoot,
  sendCachedStaticFile,
  warmStaticMemoryCache,
  writeCachedStaticFileToNodeResponse,
  type CachedStaticFile,
  type MemoryStaticMiddlewareOptions,
  type StaticMemoryCacheIndex,
  type StaticMemoryCacheStats,
} from './lib/static-memory-cache';
