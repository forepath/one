const { composePlugins, withNx } = require('@nx/webpack');

const {
  ExternalRuntimeDependenciesPlugin,
} = require('../../../tools/webpack/external-runtime-dependencies.cjs');

// Nx plugins for webpack.
module.exports = composePlugins(
  withNx({
    target: 'node',
  }),
  (config) => {
    config.output = {
      ...config.output,
      ...(process.env.NODE_ENV !== 'production' && {
        clean: true,
        devtoolModuleFilenameTemplate: '[absolute-resource-path]',
      }),
    };
    config.devtool = 'source-map';
    // Update the webpack config as needed here.
    // e.g. `config.plugins.push(new MyPlugin())`
    // The generated package.json / lockfile must cover every module the bundle requires at runtime.
    config.plugins.push(new ExternalRuntimeDependenciesPlugin());

    return config;
  },
);
