/** Matches backend `EMAIL_NOT_CONFIRMED_CODE` on interactive login 401 responses. */
export const EMAIL_NOT_CONFIRMED_CODE = 'EMAIL_NOT_CONFIRMED';

/** Matches backend `LOGIN_2FA_REQUIRED_CODE` on interactive login 401 responses. */
export const LOGIN_2FA_REQUIRED_CODE = 'LOGIN_2FA_REQUIRED';

/** Matches backend `LOGIN_2FA_INVALID_CODE` when a submitted 2FA code was wrong or expired. */
export const LOGIN_2FA_INVALID_CODE = 'LOGIN_2FA_INVALID';

/** sessionStorage key for the password while completing login 2FA. */
export const PENDING_LOGIN_PASSWORD_STORAGE_KEY = 'identity-pending-login-password';

/** Matches backend `APP_AUTHORIZATION_2FA_REQUIRED_CODE` when approving an app needs a second factor. */
export const APP_AUTHORIZATION_2FA_REQUIRED_CODE = 'APP_AUTHORIZATION_2FA_REQUIRED';

/** Matches backend `APP_AUTHORIZATION_2FA_INVALID_CODE` when the second factor on the grant page was wrong. */
export const APP_AUTHORIZATION_2FA_INVALID_CODE = 'APP_AUTHORIZATION_2FA_INVALID';

/** sessionStorage key: where to continue after login (the app grant page or a console deep link). */
export const POST_LOGIN_RETURN_URL_STORAGE_KEY = 'identity-post-login-return-url';

/** A pending post-login return expires so an abandoned grant flow does not hijack a later login. */
const POST_LOGIN_RETURN_TTL_MS = 30 * 60 * 1000;

/** Only in-app grant page URLs may be resumed after login (never absolute URLs: no open redirect). */
export function isAllowedPostLoginReturnUrl(url: unknown): url is string {
  return typeof url === 'string' && /^\/authorize(\?[^#\\]*)?$/.test(url);
}

/** Sign-in / account-recovery pages: never a post-login target (they would loop or leak flow state). */
const AUTH_PAGE_PATHS =
  /^\/(login|login-2fa|register|confirm-email|request-password-reset|request-password-reset-confirmation|reset-password|saml|oidc|authorize)(\/|\?|$)/;
const CONSOLE_RETURN_URL_MAX_LENGTH = 2048;

/**
 * Console deep links that may be resumed after a password / API-key login (e.g. a shared ticket link): same-app
 * absolute paths only (no scheme, no protocol-relative `//`, no backslashes, fragments or control characters), never
 * the sign-in pages, and not the root (which already resolves to the role's home page).
 */
export function isAllowedConsoleReturnUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.length <= CONSOLE_RETURN_URL_MAX_LENGTH &&
    /^\/[^/\\]/.test(url) &&
    !/[\\#]/.test(url) &&
    ![...url].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) &&
    !AUTH_PAGE_PATHS.test(url)
  );
}

/** Remember the console page a signed-out user tried to open, so login resumes it (see `isAllowedConsoleReturnUrl`). */
export function storeConsoleReturnUrl(url: string): void {
  if (!isAllowedConsoleReturnUrl(url)) {
    return;
  }

  try {
    sessionStorage.setItem(POST_LOGIN_RETURN_URL_STORAGE_KEY, JSON.stringify({ url, at: Date.now() }));
  } catch {
    /* storage unavailable: the user lands on the default page after login */
  }
}

export function storePostLoginReturnUrl(url: string): void {
  if (!isAllowedPostLoginReturnUrl(url)) {
    return;
  }

  try {
    sessionStorage.setItem(POST_LOGIN_RETURN_URL_STORAGE_KEY, JSON.stringify({ url, at: Date.now() }));
  } catch {
    /* storage unavailable: the user lands on the default page after login */
  }
}

/** Read and clear the pending return URL; `null` when missing, expired or not allowed. */
export function consumePostLoginReturnUrl(now: number = Date.now()): string | null {
  let raw: string | null = null;

  try {
    raw = sessionStorage.getItem(POST_LOGIN_RETURN_URL_STORAGE_KEY);
    sessionStorage.removeItem(POST_LOGIN_RETURN_URL_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { url?: unknown; at?: unknown };

    if (typeof parsed.at !== 'number' || now - parsed.at > POST_LOGIN_RETURN_TTL_MS) {
      return null;
    }

    return isAllowedPostLoginReturnUrl(parsed.url) || isAllowedConsoleReturnUrl(parsed.url) ? parsed.url : null;
  } catch {
    return null;
  }
}
