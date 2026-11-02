import { RELEASE_SIGNING_KEYS } from '@forepath/shared/shared/util-release-keys';
import { resolveTrustedReleaseKeys } from '@forepath/shared/shared/util-release-signing';

/**
 * Which release bundles the control plane, the node agent and the CLI accept (3.26). The public keys are Loadweaver's
 * entry in the shared key registry (`RELEASE_SIGNING_KEYS.loadweaver`, `@forepath/shared/shared/util-release-keys`);
 * the private key exists only as the CI secret `LOADWEAVER_RELEASE_SIGNING_KEY` (see `docs/loadweaver/features/
 * updates.md`, "Signatures and key handling").
 */

/** Environment: extra public keys (PEM, concatenated) for development and tests; refused in production. */
export const RELEASE_DEV_KEYS_ENV = 'LOADWEAVER_RELEASE_DEV_KEYS';
/** Environment: accept unsigned bundles (development / VM labs only; plans warn, imports are audited). */
export const ALLOW_UNSIGNED_BUNDLES_ENV = 'LOADWEAVER_ALLOW_UNSIGNED_BUNDLES';
/**
 * Environment: the second, explicit opt-in that `ALLOW_UNSIGNED_BUNDLES_ENV` needs with `NODE_ENV=production`
 * (value `i-understand`; M6 review L1). Without it a production process refuses unsigned bundles regardless.
 */
export const ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION_ENV = 'LOADWEAVER_ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION';

/**
 * The keys a bundle may be signed with: the compiled-in release keys, plus development keys from the environment
 * when `NODE_ENV` isn't `production` (the control-plane container and the packaged agent run with `production`).
 */
export function trustedReleaseKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return resolveTrustedReleaseKeys({
    compiled: RELEASE_SIGNING_KEYS.loadweaver,
    devKeysEnv: RELEASE_DEV_KEYS_ENV,
    env,
  });
}

/**
 * Whether unsigned (development) bundles are accepted: only with the explicit opt-in, and in production
 * (`NODE_ENV=production`, the control-plane container and the packaged agent) only with the second opt-in
 * `LOADWEAVER_ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION=i-understand` as well.
 */
export function unsignedBundlesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[ALLOW_UNSIGNED_BUNDLES_ENV] !== 'true') return false;

  return env['NODE_ENV'] !== 'production' || env[ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION_ENV] === 'i-understand';
}

/** A loud startup / status line about the unsigned-bundle setting (null: unsigned bundles are refused, as usual). */
export function unsignedBundlesNotice(env: NodeJS.ProcessEnv = process.env): string | null {
  if (unsignedBundlesAllowed(env))
    return `${ALLOW_UNSIGNED_BUNDLES_ENV}=true: UNSIGNED release bundles are accepted${
      env['NODE_ENV'] === 'production' ? ' IN PRODUCTION' : ''
    } — anyone who can upload a bundle or answer the update source can run code on this cluster`;

  if (env[ALLOW_UNSIGNED_BUNDLES_ENV] === 'true')
    return `${ALLOW_UNSIGNED_BUNDLES_ENV}=true is ignored with NODE_ENV=production (set ${ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION_ENV}=i-understand to accept unsigned bundles anyway)`;

  return null;
}
