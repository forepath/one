const { composePlugins, withNx } = require('@nx/webpack');
const webpack = require('webpack');

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

    if (options.externalDependencies === 'none') {
      config.plugins.push(
        new webpack.IgnorePlugin({
          checkResource: (resource) =>
            OPTIONAL_MODULES.some((pattern) => pattern.test(resource)),
        }),
      );
    }

    return config;
  },
);
