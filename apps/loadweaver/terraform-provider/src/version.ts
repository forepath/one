declare const LOADWEAVER_TF_PROVIDER_VERSION: string | undefined;

/** The provider release (webpack `DefinePlugin`: `VERSION` of release builds, else the root package.json's). */
export const PROVIDER_VERSION =
  typeof LOADWEAVER_TF_PROVIDER_VERSION === 'string' ? LOADWEAVER_TF_PROVIDER_VERSION : '0.0.0-dev';
