/** `amr` of console sessions created from a validated SAML assertion. */
export const SAML_SESSION_AMR = 'saml';

/** Outstanding AuthnRequest / relay state lifetime (time the user may spend at the IdP). */
export const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;

/** One-time login code lifetime (redirect from ACS to the console and exchange). */
export const SAML_LOGIN_CODE_TTL_MS = 60 * 1000;

/** Login code prefix (SHA-256 hash stored). */
export const SAML_LOGIN_CODE_PREFIX = 'fp_slc_';

/** Error code appended to the frontend callback when sign-in fails (details are only logged). */
export const SAML_LOGIN_ERROR_CODE = 'saml_failed';

/** Maximum accepted size of a base64 encoded SAMLResponse (bytes). */
export const SAML_RESPONSE_MAX_LENGTH = 512 * 1024;
