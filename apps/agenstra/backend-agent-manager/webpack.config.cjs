const { composePlugins, withNx } = require('@nx/webpack');

// Nx plugins for webpack.
module.exports = composePlugins(
  withNx({
    target: 'node',
  }),
  (config) => {
    config.output = {
      ...config.output,
      ...(process.env.NODE_ENV !== 'production' && {
        devtoolModuleFilenameTemplate: '[absolute-resource-path]',
      }),
    };
    config.devtool = 'source-map';
    // Leave `@opencode-ai/sdk` as a runtime ESM import (see OpenCodeClientFactory webpackIgnore).
    // Do not externalize as commonjs — the package only declares "import" exports.
    return config;
  },
);
