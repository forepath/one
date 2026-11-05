/** App secret prefix (shown once on create/rotate; bcrypt hash stored). */
export const APP_SECRET_PREFIX = 'fp_aps_';

/** Authorization code prefix (handed to the app via its return URL; SHA-256 hash stored). */
export const APP_AUTHORIZATION_CODE_PREFIX = 'fp_apc_';

/** Refresh token prefix (rotating per app session; SHA-256 hash stored). */
export const APP_REFRESH_TOKEN_PREFIX = 'fp_apr_';

/** Leading secret characters stored for identification in the UI: `fp_aps_` + 8 body characters. */
export const APP_SECRET_DISPLAY_PREFIX_LENGTH = 15;

/** Authorization codes are single-use and short-lived. */
export const APP_AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;

/** App access JWT lifetime; the app renews it with its rotating refresh token. */
export const APP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** `amr` of app access JWTs. `pat` keeps every machine-token check (scopes, interactive-only routes) fail-closed. */
export const APP_JWT_AMR = ['pat', 'app'] as const;

/** Stable machine-readable code when the grant page needs a second factor. */
export const APP_AUTHORIZATION_2FA_REQUIRED_CODE = 'APP_AUTHORIZATION_2FA_REQUIRED';

/** Submitted second factor on the grant page was wrong or expired. */
export const APP_AUTHORIZATION_2FA_INVALID_CODE = 'APP_AUTHORIZATION_2FA_INVALID';

/** Max length of the opaque `state` echoed back to the app. */
export const APP_STATE_MAX_LENGTH = 512;

/** Return URL query parameter values (`status`). */
export type AppAuthorizationStatus = 'approved' | 'denied' | 'error';

/** OAuth-style error codes used in the return URL and the token endpoint. */
export type AppAuthorizationErrorCode =
  | 'access_denied'
  | 'invalid_request'
  | 'invalid_scope'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'server_error';

/** Precomputed bcrypt (cost 12) for timing-safe compares when the app id is unknown. */
export { DUMMY_PAT_BCRYPT_HASH as DUMMY_APP_SECRET_BCRYPT_HASH } from './pat.constants';
