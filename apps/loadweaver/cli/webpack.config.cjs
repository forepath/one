const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { composePlugins, withNx } = require('@nx/webpack');
const webpack = require('webpack');

const {
  ExternalRuntimeDependenciesPlugin,
} = require('../../../tools/webpack/external-runtime-dependencies.cjs');

/** Optional native add-ons of the WebSocket client the CLI doesn't need (single executable, section 5). */
const OPTIONAL_MODULES = [/^bufferutil$/, /^utf-8-validate$/, /\.node$/];

/** The release version (`VERSION`, set by release builds), else the root package.json's, else `0.0.0-dev`. */
function cliVersion() {
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
    config.plugins.push(
      new webpack.DefinePlugin({
        LOADWEAVER_CLI_VERSION: JSON.stringify(cliVersion()),
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
