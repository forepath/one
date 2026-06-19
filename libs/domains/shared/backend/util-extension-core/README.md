# shared-backend-util-extension-core

Cross-domain Forepath extension loading: manifest validation, `PluginResolver`, `ProviderRegistry`, env parsing, and webpack externals for `npm:` specifiers.

## Exports

- `ProviderRegistry<T>` — type-keyed provider map
- `PluginResolver` — manifest-first extension resolution (`@forepath/...`, `npm:`, `file:`)
- `createExtensionHostModule` — NestJS dynamic module factory for plugin hosts
- `readExtensionsFromEnv` — comma-separated env specifier parsing
- `applyExtensionWebpackExternals` — mark `npm:` extension packages as webpack externals

## Webpack externals (backend apps)

Backend app `webpack.config.cjs` files should call `applyExtensionWebpackExternals` from `webpack-externals.cjs` with the extension env keys used by that app. This keeps external npm plugins out of the bundle so `PluginResolver` can load them at runtime.

```javascript
const { applyExtensionWebpackExternals } = require(path.join(__dirname, '../../../libs/domains/shared/backend/util-extension-core/webpack-externals.cjs'));

applyExtensionWebpackExternals(config, {
  extensionsEnvKeys: ['AGENSTRA_AGENT_PROVIDER_EXTENSIONS'],
});
```

## Running unit tests

Run `nx test shared-backend-util-extension-core` to execute the unit tests via [Jest](https://jestjs.io).
