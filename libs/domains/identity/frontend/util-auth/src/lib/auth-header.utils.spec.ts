import { firstValueFrom } from 'rxjs';

import { resolveAuthorizationHeader$ } from './auth-header.utils';
import { API_KEY_STORAGE_KEY, USERS_JWT_STORAGE_KEY } from './auth-storage';
import * as mtlsCredential from './mtls-credential';

describe('resolveAuthorizationHeader$', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the configured API key, then the stored one', async () => {
    await expect(firstValueFrom(resolveAuthorizationHeader$({ type: 'api-key', apiKey: 'env-key' }))).resolves.toBe(
      'Bearer env-key',
    );

    localStorage.setItem(API_KEY_STORAGE_KEY, 'stored-key');

    await expect(firstValueFrom(resolveAuthorizationHeader$({ type: 'api-key' }))).resolves.toBe('Bearer stored-key');
  });

  it.each(['users', 'saml'] as const)('uses the session JWT for %s', async (type) => {
    await expect(firstValueFrom(resolveAuthorizationHeader$({ type }))).resolves.toBeNull();

    localStorage.setItem(USERS_JWT_STORAGE_KEY, 'jwt');

    await expect(firstValueFrom(resolveAuthorizationHeader$({ type }))).resolves.toBe('Bearer jwt');
  });

  it('uses a certificate assertion for mtls (null without a stored certificate)', async () => {
    const spy = jest.spyOn(mtlsCredential, 'getMtlsAuthorizationHeader');

    spy.mockResolvedValueOnce('Certificate a.b.c');

    await expect(
      firstValueFrom(resolveAuthorizationHeader$({ type: 'mtls', assertionLifetimeSeconds: 60, audience: 'api' })),
    ).resolves.toBe('Certificate a.b.c');
    expect(spy).toHaveBeenCalledWith({ lifetimeSeconds: 60, audience: 'api' });

    spy.mockResolvedValueOnce(null);

    await expect(firstValueFrom(resolveAuthorizationHeader$({ type: 'mtls' }))).resolves.toBeNull();

    spy.mockRejectedValueOnce(new Error('sign failed'));

    await expect(firstValueFrom(resolveAuthorizationHeader$({ type: 'mtls' }))).resolves.toBeNull();

    spy.mockRestore();
  });

  it('uses the OIDC access token', async () => {
    const oidc = { getToken: jest.fn().mockResolvedValue('access-token') };
    const config = { type: 'oidc' as const, issuer: 'https://idp', clientId: 'console' };

    await expect(firstValueFrom(resolveAuthorizationHeader$(config, oidc))).resolves.toBe('Bearer access-token');

    oidc.getToken.mockRejectedValueOnce(new Error('renew failed'));

    await expect(firstValueFrom(resolveAuthorizationHeader$(config, oidc))).resolves.toBeNull();
    await expect(firstValueFrom(resolveAuthorizationHeader$(config, null))).resolves.toBeNull();
  });

  it('never sends the OIDC token or session JWT in api-key mode', async () => {
    localStorage.setItem(USERS_JWT_STORAGE_KEY, 'jwt');

    await expect(firstValueFrom(resolveAuthorizationHeader$({ type: 'api-key' }))).resolves.toBeNull();
  });
});
