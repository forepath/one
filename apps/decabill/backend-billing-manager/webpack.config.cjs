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
        clean: true,
        devtoolModuleFilenameTemplate: '[absolute-resource-path]',
      }),
    };
    config.devtool = 'source-map';

    return applyExtensionWebpackExternals(config, {
      extensionsEnvKeys: [
        'BILLING_PAYMENT_PROCESSORS',
        'BILLING_PROVISIONING_PROVIDERS',
      ],
    });
  },
);
