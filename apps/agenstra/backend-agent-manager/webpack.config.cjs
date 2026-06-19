const path = require('path');

const { composePlugins, withNx } = require('@nx/webpack');
const { applyExtensionWebpackExternals } = require(
  path.join(
    __dirname,
    '../../../libs/domains/shared/backend/util-extension-core/webpack-externals.cjs',
  ),
);

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

    return applyExtensionWebpackExternals(config, {
      extensionsEnvKeys: [
        'AGENSTRA_AGENT_PROVIDER_EXTENSIONS',
        'AGENSTRA_PIPELINE_PROVIDER_EXTENSIONS',
        'AGENSTRA_CHAT_FILTER_EXTENSIONS',
      ],
    });
  },
);
