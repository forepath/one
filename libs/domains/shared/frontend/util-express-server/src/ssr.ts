// SSR factory entry — import from `@forepath/shared/frontend/util-express-server/ssr`
// so console esbuild bundles that use the main package do not pull in `@angular/ssr/node`.
export {
  createSsrExpressApp,
  type CreateSsrExpressAppOptions,
  type SsrExpressAppHandle,
  type SsrExpressBootstrap,
} from './lib/create-ssr-express-app';
export { resolveLocalizedBrowserDistFolder, stripLocalePrefixFromPath } from './lib/localized-browser-dist';
