import { IS_PUBLIC_KEY, UserRole } from '@forepath/identity/backend';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ExternalIdentityAuthGuard } from './external-identity-auth.guard';

function context(request: Record<string, unknown>, handler: () => void = () => undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class Test {},
  } as unknown as ExecutionContext;
}

describe('ExternalIdentityAuthGuard', () => {
  const envBackup = process.env.AUTHENTICATION_METHOD;
  const resolveUser = jest.fn();
  const verifier = { getEmail: jest.fn((claims: { email?: string }) => claims.email) };
  let guard: ExternalIdentityAuthGuard;

  beforeEach(() => {
    process.env.AUTHENTICATION_METHOD = 'oidc';
    resolveUser.mockReset().mockResolvedValue({ id: 'local-1', email: 'u@example.com', role: UserRole.ADMIN });
    guard = new ExternalIdentityAuthGuard({ resolveUser } as never, verifier as never, new Reflector());
  });

  afterAll(() => {
    if (envBackup === undefined) delete process.env.AUTHENTICATION_METHOD;
    else process.env.AUTHENTICATION_METHOD = envBackup;
  });

  it('replaces IdP claims with the local user (local role, amr oidc)', async () => {
    const claims = {
      sub: 'idp-sub',
      email: 'u@example.com',
      email_verified: 'true',
      exp: 123,
      realm_access: { roles: [] },
    };
    const request: Record<string, unknown> = { oidcClaims: claims, user: claims };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(resolveUser).toHaveBeenCalledWith({
      provider: 'oidc',
      subject: 'idp-sub',
      email: 'u@example.com',
      emailVerified: true,
    });
    expect(request.user).toEqual({
      id: 'local-1',
      email: 'u@example.com',
      roles: [UserRole.ADMIN],
      amr: ['oidc'],
      exp: 123,
    });
  });

  it('propagates rejections (locked user, linking refused)', async () => {
    resolveUser.mockRejectedValue(new Error('locked'));

    await expect(guard.canActivate(context({ oidcClaims: { sub: 's' } }))).rejects.toThrow('locked');
  });

  it('skips PAT sessions, requests without claims, public routes and other methods', async () => {
    await expect(guard.canActivate(context({ patAuthenticated: true, oidcClaims: { sub: 's' } }))).resolves.toBe(true);
    await expect(guard.canActivate(context({}))).resolves.toBe(true);

    const handler = () => undefined;

    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    await expect(guard.canActivate(context({ oidcClaims: { sub: 's' } }, handler))).resolves.toBe(true);

    process.env.AUTHENTICATION_METHOD = 'saml';
    await expect(guard.canActivate(context({ oidcClaims: { sub: 's' } }))).resolves.toBe(true);
    expect(resolveUser).not.toHaveBeenCalled();
  });
});
