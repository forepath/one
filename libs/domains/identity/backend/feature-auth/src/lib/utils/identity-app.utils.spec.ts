import { createHash } from 'node:crypto';

import {
  buildAppReturnUrl,
  evaluateAppScopes,
  generateAppCredential,
  hashAppCredential,
  normalizeAppReturnUrl,
  sameScopeSet,
  verifyPkceS256,
} from './identity-app.utils';

const CATALOG = ['tickets:read', 'tickets:write', 'users:admin', 'billing:admin'];
const USER_CATALOG = ['tickets:read', 'tickets:write'];

describe('evaluateAppScopes', () => {
  it('caps grantable scopes to what the user role may grant (no privilege escalation by app)', () => {
    const result = evaluateAppScopes({
      appScopes: ['tickets:read', 'users:admin'],
      catalog: CATALOG,
      roleCatalog: USER_CATALOG,
      consentedScopes: null,
    });

    expect(result.grantable).toEqual(['tickets:read']);
    expect(result.ungrantable).toEqual(['users:admin']);
    expect(result.effective).toEqual([]);
    expect(result.needsReauthorization).toBe(true);
  });

  it('drops scopes that left the product catalog', () => {
    const result = evaluateAppScopes({
      appScopes: ['tickets:read', 'legacy:read'],
      catalog: CATALOG,
      roleCatalog: CATALOG,
      consentedScopes: ['tickets:read', 'legacy:read'],
    });

    expect(result.requested).toEqual(['tickets:read']);
    expect(result.effective).toEqual(['tickets:read']);
  });

  it('requires re-authorization when the app gained a scope, keeping consented scopes effective', () => {
    const result = evaluateAppScopes({
      appScopes: ['tickets:read', 'tickets:write'],
      catalog: CATALOG,
      roleCatalog: USER_CATALOG,
      consentedScopes: ['tickets:read'],
    });

    expect(result.needsReauthorization).toBe(true);
    expect(result.effective).toEqual(['tickets:read']);
  });

  it('shrinks effective scopes immediately when the app drops a scope (no re-authorization needed)', () => {
    const result = evaluateAppScopes({
      appScopes: ['tickets:read'],
      catalog: CATALOG,
      roleCatalog: USER_CATALOG,
      consentedScopes: ['tickets:read', 'tickets:write'],
    });

    expect(result.effective).toEqual(['tickets:read']);
    expect(result.needsReauthorization).toBe(false);
  });

  it('removes admin scopes from effective scopes once the user is demoted', () => {
    const result = evaluateAppScopes({
      appScopes: ['tickets:read', 'users:admin'],
      catalog: CATALOG,
      roleCatalog: USER_CATALOG,
      consentedScopes: ['tickets:read', 'users:admin'],
    });

    expect(result.effective).toEqual(['tickets:read']);
    expect(result.needsReauthorization).toBe(false);
  });

  it('requires re-authorization after promotion when the app requests scopes the user can now grant', () => {
    const result = evaluateAppScopes({
      appScopes: ['tickets:read', 'users:admin'],
      catalog: CATALOG,
      roleCatalog: CATALOG,
      consentedScopes: ['tickets:read'],
    });

    expect(result.effective).toEqual(['tickets:read']);
    expect(result.needsReauthorization).toBe(true);
  });
});

describe('sameScopeSet', () => {
  it('compares order-insensitively', () => {
    expect(sameScopeSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameScopeSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameScopeSet(['a'], undefined)).toBe(false);
  });
});

describe('normalizeAppReturnUrl', () => {
  it.each([
    ['https://app.example.com/callback', 'https://app.example.com/callback'],
    ['https://app.example.com/cb?tenant=a', 'https://app.example.com/cb?tenant=a'],
    ['http://localhost:4000/cb', 'http://localhost:4000/cb'],
    ['http://127.0.0.1:4000/cb', 'http://127.0.0.1:4000/cb'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeAppReturnUrl(input)).toBe(expected);
  });

  it.each([
    'http://app.example.com/cb',
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://app.example.com/cb',
    'https://user:pass@app.example.com/cb',
    'https://app.example.com/cb#frag',
    '/relative/cb',
    'not a url',
  ])('rejects %s', (input) => {
    expect(normalizeAppReturnUrl(input)).toBeNull();
  });
});

describe('buildAppReturnUrl', () => {
  it('appends status, app id, code and state to the registered URL', () => {
    const url = new URL(
      buildAppReturnUrl('https://app.example.com/cb?keep=1', {
        status: 'approved',
        appId: 'app-1',
        code: 'fp_apc_x',
        state: 'a b&c',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://app.example.com/cb');
    expect(url.searchParams.get('keep')).toBe('1');
    expect(url.searchParams.get('status')).toBe('approved');
    expect(url.searchParams.get('app_id')).toBe('app-1');
    expect(url.searchParams.get('code')).toBe('fp_apc_x');
    expect(url.searchParams.get('state')).toBe('a b&c');
    expect(url.searchParams.has('error')).toBe(false);
  });

  it('reports denial without a code', () => {
    const url = new URL(
      buildAppReturnUrl('https://app.example.com/cb', {
        status: 'denied',
        appId: 'app-1',
        error: 'access_denied',
        errorDescription: 'denied',
      }),
    );

    expect(url.searchParams.get('status')).toBe('denied');
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.has('code')).toBe(false);
    expect(url.searchParams.has('state')).toBe(false);
  });
});

describe('credentials', () => {
  it('generates prefixed high-entropy values and stable SHA-256 hashes', () => {
    const a = generateAppCredential('fp_apr_');
    const b = generateAppCredential('fp_apr_');

    expect(a).toMatch(/^fp_apr_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashAppCredential(a)).toHaveLength(64);
    expect(hashAppCredential(a)).toBe(hashAppCredential(a));
  });

  it('verifies PKCE S256', () => {
    const verifier = 'v'.repeat(50);
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256('w'.repeat(50), challenge)).toBe(false);
  });
});
