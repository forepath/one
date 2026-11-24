import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';

import { ActionCenterMutationInterceptor } from './action-center-mutation.interceptor';

function context(
  method: string,
  type = 'http',
  request: Record<string, unknown> = { user: { id: 'u' } },
): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ method, ...request }) }),
  } as unknown as ExecutionContext;
}

describe('ActionCenterMutationInterceptor', () => {
  const actionCenter = { currentScopeKey: jest.fn(() => 'tenant-a'), signalChange: jest.fn() };
  const interceptor = new ActionCenterMutationInterceptor(actionCenter as never);
  const handler = (value: unknown = 'ok'): CallHandler => ({ handle: () => of(value) });

  beforeEach(() => jest.clearAllMocks());

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('signals a change after a successful %s', async (method) => {
    await lastValueFrom(interceptor.intercept(context(method), handler()));

    expect(actionCenter.signalChange).toHaveBeenCalledWith('tenant-a');
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('ignores %s', async (method) => {
    await lastValueFrom(interceptor.intercept(context(method), handler()));

    expect(actionCenter.signalChange).not.toHaveBeenCalled();
  });

  it('ignores anonymous requests but accepts the static credential', async () => {
    await lastValueFrom(interceptor.intercept(context('POST', 'http', {}), handler()));
    expect(actionCenter.signalChange).not.toHaveBeenCalled();

    await lastValueFrom(interceptor.intercept(context('POST', 'http', { apiKeyAuthenticated: true }), handler()));
    expect(actionCenter.signalChange).toHaveBeenCalledWith('tenant-a');
  });

  it('ignores failed requests and non-http contexts', async () => {
    await expect(
      lastValueFrom(interceptor.intercept(context('POST'), { handle: () => throwError(() => new Error('400')) })),
    ).rejects.toThrow('400');
    await lastValueFrom(interceptor.intercept(context('POST', 'ws'), handler()));

    expect(actionCenter.signalChange).not.toHaveBeenCalled();
  });
});
