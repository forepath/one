import * as mtlsCredential from './mtls-credential';
import { createSocketAuthOption, type SocketAuthPayload } from './socket-auth.utils';

describe('createSocketAuthOption', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [{ type: 'api-key' } as const],
    [{ type: 'users' } as const],
    [{ type: 'saml' } as const],
    [{ type: 'oidc', issuer: 'https://idp', clientId: 'console' } as const],
  ])('returns the static payload for %p', (config) => {
    expect(createSocketAuthOption(config, 'Bearer x')).toEqual({ Authorization: 'Bearer x' });
    expect(createSocketAuthOption(config, 'Bearer x', { tenantId: 't1' })).toEqual({
      Authorization: 'Bearer x',
      tenantId: 't1',
    });
  });

  it('signs a fresh assertion for every mtls handshake (reconnects included)', async () => {
    const spy = jest
      .spyOn(mtlsCredential, 'getMtlsAuthorizationHeader')
      .mockResolvedValueOnce('Certificate first')
      .mockResolvedValueOnce('Certificate second');
    const option = createSocketAuthOption({ type: 'mtls', assertionLifetimeSeconds: 60, audience: 'api' }, 'unused', {
      tenantId: 't1',
    });

    expect(typeof option).toBe('function');

    const handshake = () =>
      new Promise<SocketAuthPayload>((resolve) =>
        (option as (callback: (payload: SocketAuthPayload) => void) => void)(resolve),
      );

    await expect(handshake()).resolves.toEqual({ Authorization: 'Certificate first', tenantId: 't1' });
    await expect(handshake()).resolves.toEqual({ Authorization: 'Certificate second', tenantId: 't1' });
    expect(spy).toHaveBeenCalledWith({ lifetimeSeconds: 60, audience: 'api' });
  });

  it('sends the handshake without Authorization when no certificate is available', async () => {
    jest.spyOn(mtlsCredential, 'getMtlsAuthorizationHeader').mockResolvedValueOnce(null);
    jest.spyOn(mtlsCredential, 'getMtlsAuthorizationHeader').mockRejectedValueOnce(new Error('sign failed'));

    const option = createSocketAuthOption({ type: 'mtls' }, 'unused') as (
      callback: (payload: SocketAuthPayload) => void,
    ) => void;

    await expect(new Promise((resolve) => option(resolve))).resolves.toEqual({});
  });
});
