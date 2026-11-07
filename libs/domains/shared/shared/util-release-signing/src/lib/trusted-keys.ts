import { releaseKeyId } from './signature';

/** The PEM public keys contained in a string (keys concatenated in an environment variable or a file). */
export function splitPublicKeyPems(value: string): string[] {
  return value.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? [];
}

export interface TrustedReleaseKeysOptions {
  /** The product's compiled-in public keys (PEM). */
  compiled: readonly string[];
  /** Environment variable with extra public keys for development and tests; ignored when `NODE_ENV=production`. */
  devKeysEnv?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The keys a release document may be signed with: the compiled-in keys, plus development keys from `devKeysEnv` when
 * `NODE_ENV` isn't `production`. Malformed keys fail loudly here instead of silently never verifying.
 */
export function resolveTrustedReleaseKeys({
  compiled,
  devKeysEnv,
  env = process.env,
}: TrustedReleaseKeysOptions): string[] {
  const dev = devKeysEnv && env['NODE_ENV'] !== 'production' ? splitPublicKeyPems(env[devKeysEnv] ?? '') : [];
  const keys = [...compiled, ...dev];

  keys.forEach((k) => releaseKeyId(k));

  return keys;
}
