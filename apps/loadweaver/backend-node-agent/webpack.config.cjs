const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { composePlugins, withNx } = require('@nx/webpack');
const webpack = require('webpack');

const {
  ExternalRuntimeDependenciesPlugin,
} = require('../../../tools/webpack/external-runtime-dependencies.cjs');

/**
 * The release this agent is built for (3.26: the rollout compares it with the manifest): `VERSION` (CI release
 * builds), else the root package.json version, else `0.0.0`.
 */
function agentVersion() {
  const fromEnv = (process.env.VERSION || '').trim().replace(/^v/, '');

  if (/^\d+\.\d+\.\d+/.test(fromEnv)) return fromEnv;

  try {
    const { version } = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    );

    return typeof version === 'string' && version ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Optional modules NestJS and ssh2 (via dockerode) load lazily. The agent never uses them, so a fully bundled
 * build (single executable, section 5) leaves them out instead of failing on native addons.
 */
const OPTIONAL_MODULES = [
  /^@nestjs\/microservices(\/.*)?$/,
  /^@nestjs\/websockets(\/.*)?$/,
  /^@nestjs\/platform-express$/,
  /^class-transformer(\/.*)?$/,
  /^class-validator$/,
  /^cpu-features$/,
  /\.node$/,
];

module.exports = composePlugins(
  withNx({
    target: 'node',
  }),
  (config, { options }) => {
    config.output = {
      ...config.output,
      ...(process.env.NODE_ENV !== 'production' && {
        clean: true,
        devtoolModuleFilenameTemplate: '[absolute-resource-path]',
      }),
    };
    config.devtool = options.sourceMap === false ? false : 'source-map';
    config.plugins.push(
      new webpack.DefinePlugin({
        LOADWEAVER_AGENT_BUILD_VERSION: JSON.stringify(agentVersion()),
      }),
    );

    if (options.externalDependencies === 'none') {
      config.plugins.push(
        new webpack.IgnorePlugin({
          checkResource: (resource) =>
            OPTIONAL_MODULES.some((pattern) => pattern.test(resource)),
        }),
      );
    }

    // The generated package.json / lockfile must cover every module the bundle requires at runtime.
    config.plugins.push(new ExternalRuntimeDependenciesPlugin());

    return config;
  },
);
