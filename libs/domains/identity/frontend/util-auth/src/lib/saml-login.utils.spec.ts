import { createHash, webcrypto } from 'node:crypto';

import { SAML_CODE_VERIFIER_STORAGE_KEY } from './auth-storage';
import {
  buildSamlLoginUrl,
  computePkceS256Challenge,
  generatePkceCodeVerifier,
  takeSamlCodeVerifier,
} from './saml-login.utils';

describe('saml-login.utils', () => {
  const originalCrypto = globalThis.crypto;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
  });

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('generates a 43 character base64url verifier', () => {
    const verifier = generatePkceCodeVerifier();

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generatePkceCodeVerifier()).not.toBe(verifier);
  });

  it('computes the RFC 7636 S256 challenge', async () => {
    // RFC 7636 appendix B test vector
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    await expect(computePkceS256Challenge(verifier)).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('builds the login URL with a challenge for the stored verifier and a sanitized redirect', async () => {
    const url = new URL(await buildSamlLoginUrl('https://api.example.com/api/', '//evil.example'));
    const verifier = sessionStorage.getItem(SAML_CODE_VERIFIER_STORAGE_KEY);

    expect(url.origin + url.pathname).toBe('https://api.example.com/api/auth/saml/login');
    expect(verifier).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBe(await computePkceS256Challenge(verifier as string));
    expect(url.searchParams.get('redirect')).toBe('/');
  });

  it('keeps a safe redirect path', async () => {
    const url = new URL(await buildSamlLoginUrl('https://api.example.com/api', '/clients/1?tab=x'));

    expect(url.searchParams.get('redirect')).toBe('/clients/1?tab=x');
  });

  it('takes the verifier only once', () => {
    sessionStorage.setItem(SAML_CODE_VERIFIER_STORAGE_KEY, 'verifier');

    expect(takeSamlCodeVerifier()).toBe('verifier');
    expect(takeSamlCodeVerifier()).toBeNull();
  });

  it('passes the tenant of multi-tenant APIs as query parameter (navigation cannot send X-Tenant)', async () => {
    const url = new URL(await buildSamlLoginUrl('https://api.example.com/api', '/x', 'acme'));

    expect(url.searchParams.get('tenant')).toBe('acme');
    expect(new URL(await buildSamlLoginUrl('https://api.example.com/api', '/x')).searchParams.has('tenant')).toBe(
      false,
    );
  });
});
