import { UnauthorizedException } from '@nestjs/common';

import { isMachineJwtAmr, normalizeMachineJwtAmr, resolveMachineJwtSession } from './machine-jwt-session.util';

describe('machine-jwt-session.util', () => {
  const verifiers = () => ({
    personalAccessTokenService: { assertPatJwtActive: jest.fn().mockResolvedValue({ scopes: ['clients:read'] }) },
    appAuthorizationService: { assertAppJwtActive: jest.fn().mockResolvedValue({ scopes: ['tickets:read'] }) },
  });

  it('detects machine amr values', () => {
    expect(isMachineJwtAmr(['pat'])).toBe(true);
    expect(isMachineJwtAmr(['pat', 'app'])).toBe(true);
    expect(isMachineJwtAmr(['app'])).toBe(true);
    expect(isMachineJwtAmr(['pwd'])).toBe(false);
    expect(isMachineJwtAmr(undefined)).toBe(false);
  });

  it('always includes pat in machine amr values', () => {
    expect(normalizeMachineJwtAmr(['pat', 'app'])).toEqual(['pat', 'app']);
    expect(normalizeMachineJwtAmr(['app'])).toEqual(['pat', 'app']);
    expect(normalizeMachineJwtAmr(undefined)).toEqual(['pat']);
  });

  it('checks PAT JWTs against the live PAT', async () => {
    const v = verifiers();

    await expect(
      resolveMachineJwtSession(
        { sub: 'u1', email: 'e', roles: [], amr: ['pat'], patId: 'p1', scopes: ['clients:read'] },
        v,
      ),
    ).resolves.toEqual({ scopes: ['clients:read'], patId: 'p1' });
    expect(v.personalAccessTokenService.assertPatJwtActive).toHaveBeenCalledWith('p1', 'u1', ['clients:read']);
    expect(v.appAuthorizationService.assertAppJwtActive).not.toHaveBeenCalled();
  });

  it('checks app access tokens against the live app session', async () => {
    const v = verifiers();

    await expect(
      resolveMachineJwtSession(
        {
          sub: 'u1',
          email: 'e',
          roles: [],
          amr: ['pat', 'app'],
          appId: 'a1',
          appSessionId: 's1',
          scopes: ['tickets:read'],
        },
        v,
      ),
    ).resolves.toEqual({ scopes: ['tickets:read'], appId: 'a1', appSessionId: 's1' });
    expect(v.personalAccessTokenService.assertPatJwtActive).not.toHaveBeenCalled();
  });

  it('rejects PAT JWTs without a PAT id', async () => {
    await expect(
      resolveMachineJwtSession({ sub: 'u1', email: 'e', roles: [], amr: ['pat'] }, verifiers()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('propagates verifier rejections', async () => {
    const v = verifiers();

    v.personalAccessTokenService.assertPatJwtActive.mockRejectedValue(new UnauthorizedException('revoked'));

    await expect(
      resolveMachineJwtSession({ sub: 'u1', email: 'e', roles: [], amr: ['pat'], patId: 'p1' }, v),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
