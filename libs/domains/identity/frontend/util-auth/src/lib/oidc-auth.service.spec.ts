import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { IDENTITY_AUTH_ENVIRONMENT, type IdentityAuthEnvironment } from './auth-environment';
import { createMockIdentityAuthEnvironment } from './auth-environment.test-fixtures';
import { OidcAuthService } from './oidc-auth.service';

const managerMock = {
  events: { addUserLoaded: jest.fn(), addUserUnloaded: jest.fn() },
  signinRedirect: jest.fn(),
  signinRedirectCallback: jest.fn(),
  signinSilent: jest.fn(),
  signoutRedirect: jest.fn(),
  getUser: jest.fn(),
  removeUser: jest.fn(),
  clearStaleState: jest.fn(),
};
const userManagerCtor = jest.fn();

jest.mock('oidc-client-ts', () => ({
  UserManager: jest.fn().mockImplementation((settings: unknown) => {
    userManagerCtor(settings);

    return managerMock;
  }),
  WebStorageStateStore: jest.fn().mockImplementation((args: unknown) => ({ args })),
}));

function createService(
  authentication: IdentityAuthEnvironment['authentication'],
  platformId: 'browser' | 'server' = 'browser',
): OidcAuthService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IDENTITY_AUTH_ENVIRONMENT, useValue: createMockIdentityAuthEnvironment({ authentication }) },
      { provide: PLATFORM_ID, useValue: platformId },
    ],
  });

  return TestBed.inject(OidcAuthService);
}

const oidcConfig = { type: 'oidc' as const, issuer: 'https://idp.example.com/realms/x', clientId: 'console' };

describe('OidcAuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    managerMock.clearStaleState.mockResolvedValue(undefined);
    managerMock.getUser.mockResolvedValue(null);
    window.history.replaceState(null, '', '/');
  });

  it('is a no-op outside oidc mode and on the server', async () => {
    const usersMode = createService({ type: 'users' });

    await usersMode.initialize();
    await expect(usersMode.getToken()).resolves.toBeNull();
    expect(userManagerCtor).not.toHaveBeenCalled();

    const server = createService(oidcConfig, 'server');

    await expect(server.getToken()).resolves.toBeNull();
    expect(userManagerCtor).not.toHaveBeenCalled();
  });

  it('configures Authorization Code + PKCE with session storage and the callback path', async () => {
    const service = createService({ ...oidcConfig, scope: 'openid email' });

    await service.initialize();

    expect(userManagerCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: oidcConfig.issuer,
        client_id: 'console',
        response_type: 'code',
        scope: 'openid email',
        redirect_uri: 'http://localhost/login/oidc/callback',
        automaticSilentRenew: true,
      }),
    );
    const settings = userManagerCtor.mock.calls[0][0] as { userStore: { args: { store: Storage } } };

    expect(settings.userStore.args.store).toBe(window.sessionStorage);
  });

  it('restores a stored session', async () => {
    managerMock.getUser.mockResolvedValue({
      expired: false,
      access_token: 'at',
      profile: { sub: 's', email: 'a@b.c' },
    });
    const service = createService(oidcConfig);

    await service.initialize();

    expect(service.isLoggedIn()).toBe(true);
    expect(service.getProfile()).toEqual({ sub: 's', email: 'a@b.c' });
    await expect(service.getToken()).resolves.toBe('at');
  });

  it('completes the redirect callback and returns to the sanitized return URL', async () => {
    window.history.replaceState(null, '', '/login/oidc/callback?code=c&state=s');
    managerMock.signinRedirectCallback.mockResolvedValue({
      expired: false,
      access_token: 'at',
      profile: { sub: 's' },
      state: { returnUrl: '/clients/1' },
    });
    const service = createService(oidcConfig);

    await service.initialize();

    expect(managerMock.signinRedirectCallback).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/clients/1');
    expect(window.location.search).toBe('');
  });

  it('never redirects to a foreign origin from callback state', async () => {
    window.history.replaceState(null, '', '/login/oidc/callback?code=c&state=s');
    managerMock.signinRedirectCallback.mockResolvedValue({
      expired: false,
      profile: { sub: 's' },
      state: { returnUrl: '//evil.example' },
    });
    const service = createService(oidcConfig);

    await service.initialize();

    expect(window.location.pathname).toBe('/');
  });

  it('sends the user to the login page with an error flag when the callback fails', async () => {
    window.history.replaceState(null, '', '/login/oidc/callback?code=c&state=bad');
    managerMock.signinRedirectCallback.mockRejectedValue(new Error('state mismatch'));
    const service = createService(oidcConfig);

    await service.initialize();

    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?sso_error=oidc');
    expect(service.isLoggedIn()).toBe(false);
  });

  it('renews an expired session silently and drops it when renewal fails', async () => {
    managerMock.getUser.mockResolvedValue({ expired: true, access_token: 'old', profile: { sub: 's' } });
    managerMock.signinSilent.mockResolvedValueOnce({ expired: false, access_token: 'new', profile: { sub: 's' } });
    const service = createService(oidcConfig);

    await service.initialize();
    await expect(service.getToken()).resolves.toBe('new');

    managerMock.getUser.mockResolvedValue({ expired: true, access_token: 'old', profile: { sub: 's' } });
    managerMock.signinSilent.mockRejectedValueOnce(new Error('login_required'));
    const second = createService(oidcConfig);

    await second.initialize();
    await expect(second.getToken()).resolves.toBeNull();
    expect(managerMock.removeUser).toHaveBeenCalled();
  });

  it('passes a sanitized return URL to the sign-in redirect', async () => {
    const service = createService(oidcConfig);

    await service.login('https://evil.example');
    await service.login('/clients?x=1');

    expect(managerMock.signinRedirect).toHaveBeenNthCalledWith(1, { state: { returnUrl: '/' } });
    expect(managerMock.signinRedirect).toHaveBeenNthCalledWith(2, { state: { returnUrl: '/clients?x=1' } });
  });

  it('logs out at the provider with the id token hint', async () => {
    managerMock.getUser.mockResolvedValue({ expired: false, id_token: 'idt', profile: { sub: 's' } });
    const service = createService(oidcConfig);

    await service.initialize();
    await service.logout();

    expect(managerMock.signoutRedirect).toHaveBeenCalledWith({ id_token_hint: 'idt' });
    expect(service.isLoggedIn()).toBe(false);
  });
});
