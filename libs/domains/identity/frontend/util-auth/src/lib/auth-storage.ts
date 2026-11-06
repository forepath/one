/** localStorage key for the static API key (api-key mode). */
export const API_KEY_STORAGE_KEY = 'agent-controller-api-key';

/** localStorage key for the console session JWT (users and saml modes). */
export const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

/** sessionStorage key of the PKCE verifier of a pending SAML sign-in. */
export const SAML_CODE_VERIFIER_STORAGE_KEY = 'identity-saml-code-verifier';

function storage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return typeof globalThis[kind] === 'undefined' ? null : globalThis[kind];
  } catch {
    return null;
  }
}

/** SSR-safe localStorage read. */
export function readLocalStorage(key: string): string | null {
  return storage('localStorage')?.getItem(key) ?? null;
}

/** SSR-safe sessionStorage access. */
export function getSessionStorage(): Storage | null {
  return storage('sessionStorage');
}
