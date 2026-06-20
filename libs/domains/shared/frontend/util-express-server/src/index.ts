// Docs SSR factory lives at @forepath/shared/frontend/util-express-server/docs-server
// so esbuild server bundles (agent/billing console) do not pull in @angular/ssr/node.
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
