import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

import { OidcAuthGuard } from './oidc-auth.guard';
import type { OidcTokenVerifier } from './oidc-token-verifier.service';

function context(request: Record<string, unknown>, handler: () => void = () => undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class Test {},
  } as unknown as ExecutionContext;
}

describe('OidcAuthGuard', () => {
  const envBackup = process.env.AUTHENTICATION_METHOD;
  let verifier: jest.Mocked<Pick<OidcTokenVerifier, 'verifyAccessToken'>>;
  let guard: OidcAuthGuard;

  beforeEach(() => {
    process.env.AUTHENTICATION_METHOD = 'oidc';
    verifier = { verifyAccessToken: jest.fn() };
    guard = new OidcAuthGuard(new Reflector(), verifier as unknown as OidcTokenVerifier);
  });

  afterAll(() => {
    if (envBackup === undefined) delete process.env.AUTHENTICATION_METHOD;
    else process.env.AUTHENTICATION_METHOD = envBackup;
  });

  it('sets request.user and request.oidcClaims for a valid token', async () => {
    const claims = { sub: 's', exp: 1 };
    const request: Record<string, unknown> = { url: '/api/clients', headers: { authorization: 'Bearer abc' } };

    verifier.verifyAccessToken.mockResolvedValue(claims as never);

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith('abc');
    expect(request.user).toBe(claims);
    expect(request.oidcClaims).toBe(claims);
  });

  it('rejects missing or malformed authorization headers', async () => {
    await expect(guard.canActivate(context({ url: '/api/x', headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(context({ url: '/api/x', headers: { authorization: 'Basic abc' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(context({ url: '/api/x', headers: { authorization: 'Bearer a b' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('propagates verifier rejections as 401', async () => {
    verifier.verifyAccessToken.mockRejectedValue(new Error('boom'));

    await expect(
      guard.canActivate(context({ url: '/api/x', headers: { authorization: 'Bearer abc' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('skips public routes, PAT-authenticated requests and other methods', async () => {
    const handler = () => undefined;

    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    await expect(guard.canActivate(context({ url: '/api/x', headers: {} }, handler))).resolves.toBe(true);
    await expect(guard.canActivate(context({ url: '/api/x', headers: {}, patAuthenticated: true }))).resolves.toBe(
      true,
    );

    process.env.AUTHENTICATION_METHOD = 'users';
    await expect(guard.canActivate(context({ url: '/api/x', headers: {} }))).resolves.toBe(true);
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });
});
