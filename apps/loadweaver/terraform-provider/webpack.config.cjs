const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { composePlugins, withNx } = require('@nx/webpack');
const webpack = require('webpack');

const {
  ExternalRuntimeDependenciesPlugin,
} = require('../../../tools/webpack/external-runtime-dependencies.cjs');

/** Optional native add-ons nothing in the provider needs (single executable, section 5). */
const OPTIONAL_MODULES = [/\.node$/];

/** The release version (`VERSION`, set by release builds), else the root package.json's, else `0.0.0-dev`. */
function providerVersion() {
  const fromEnv = (process.env.VERSION || '').trim().replace(/^v/, '');

  if (/^\d+\.\d+\.\d+/.test(fromEnv)) return fromEnv;

  try {
    const { version } = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    );

    return typeof version === 'string' && version && version !== '0.0.0'
      ? version
      : '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

module.exports = composePlugins(
  withNx({ target: 'node' }),
  (config, { options }) => {
    config.devtool = options.sourceMap === false ? false : 'source-map';
    // The vendored protocol definitions (util-terraform-protocol/src/lib/proto) are bundled as text.
    config.module = config.module ?? {};
    config.module.rules = config.module.rules ?? [];
    config.module.rules.push({ test: /\.proto$/, type: 'asset/source' });
    config.plugins.push(
      new webpack.DefinePlugin({
        LOADWEAVER_TF_PROVIDER_VERSION: JSON.stringify(providerVersion()),
      }),
    );

    if (options.externalDependencies === 'none')
      config.plugins.push(
        new webpack.IgnorePlugin({
          checkResource: (resource) =>
            OPTIONAL_MODULES.some((pattern) => pattern.test(resource)),
        }),
      );

    // The generated package.json / lockfile must cover every module the bundle requires at runtime.
    config.plugins.push(new ExternalRuntimeDependenciesPlugin());

    return config;
  },
);
