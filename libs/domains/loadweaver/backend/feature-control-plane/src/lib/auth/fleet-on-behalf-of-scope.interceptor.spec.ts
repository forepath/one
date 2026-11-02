import { ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';

import {
  FleetOnBehalfOfScopeInterceptor,
  isPatMintingRequest,
  mayMintOnBehalfOfScope,
  requestsOnBehalfOfScope,
} from './fleet-on-behalf-of-scope.interceptor';

function context(req: Record<string, unknown>) {
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as never;
}

function setup(clusterRole?: string) {
  const access = { caller: jest.fn(async () => ({ isApiKey: false, userId: 'u1', clusterRole, projects: new Map() })) };
  const next = { handle: jest.fn(() => of('created')) };

  return { interceptor: new FleetOnBehalfOfScopeInterceptor(access as never), access, next };
}

const mint = (scopes: unknown, method = 'POST', url = '/api/auth/tokens') => ({
  method,
  originalUrl: url,
  body: { scopes },
});

describe('fleet:on-behalf-of minting (3.24, L2)', () => {
  it('recognises PAT create / change requests and the scope', () => {
    expect(isPatMintingRequest({ method: 'POST', originalUrl: '/api/auth/tokens' } as never)).toBe(true);
    expect(isPatMintingRequest({ method: 'PATCH', originalUrl: '/api/auth/tokens/abc?x=1' } as never)).toBe(true);
    expect(isPatMintingRequest({ method: 'GET', originalUrl: '/api/auth/tokens' } as never)).toBe(false);
    expect(isPatMintingRequest({ method: 'POST', originalUrl: '/api/plans' } as never)).toBe(false);
    expect(requestsOnBehalfOfScope({ scopes: ['cluster:read', ' fleet:on-behalf-of '] })).toBe(true);
    expect(requestsOnBehalfOfScope({ scopes: ['cluster:read'] })).toBe(false);
    expect(requestsOnBehalfOfScope({ scopes: 'fleet:on-behalf-of' })).toBe(false);
  });

  it('refuses the scope for users without a cluster-wide role (project members included)', async () => {
    const { interceptor, next } = setup(undefined);

    await expect(interceptor.intercept(context(mint(['fleet:on-behalf-of'])), next as never)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      interceptor.intercept(context(mint(['fleet:on-behalf-of'], 'PATCH', '/api/auth/tokens/t1')), next as never),
    ).rejects.toThrow(ForbiddenException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('allows cluster admins and fleet service users (cluster-wide role)', async () => {
    for (const role of ['cluster-admin', 'auditor', 'infra-operator']) {
      const { interceptor, next } = setup(role);

      await expect(interceptor.intercept(context(mint(['fleet:on-behalf-of'])), next as never)).resolves.toBeDefined();
      expect(next.handle).toHaveBeenCalled();
    }
  });

  it('does not look at other requests or tokens without the scope', async () => {
    const { interceptor, access, next } = setup(undefined);

    await interceptor.intercept(context(mint(['cluster:read'])), next as never);
    await interceptor.intercept(context({ method: 'POST', originalUrl: '/api/plans', body: {} }), next as never);
    expect(access.caller).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(mayMintOnBehalfOfScope({ isApiKey: true, clusterRole: 'cluster-admin', projects: new Map() })).toBe(false);
  });
});
