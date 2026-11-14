import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { ClientAgentMembershipInterceptor } from './client-agent-membership.interceptor';

describe('ClientAgentMembershipInterceptor', () => {
  let membership: { isMember: jest.Mock };
  let interceptor: ClientAgentMembershipInterceptor;
  const http = (path: string, params: Record<string, string>) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ route: { path }, params }) }),
    }) as unknown as ExecutionContext;
  const handler = () => ({ handle: jest.fn(() => of('proxied')) });

  beforeEach(() => {
    membership = { isMember: jest.fn(async (_client: string, agent: string) => agent === 'own') };
    interceptor = new ClientAgentMembershipInterceptor(membership as never);
  });

  it.each([
    ['/api/clients/:id/agents/:agentId', { id: 'c1', agentId: 'own' }],
    ['/api/clients/:id/agents/:agentId/files/*path', { id: 'c1', agentId: 'own' }],
    ['/api/clients/:clientId/agents/:agentId/vcs/status', { clientId: 'c1', agentId: 'own' }],
  ])('proxies %s for agents of the workspace', async (path, params) => {
    const next = handler();

    await expect(firstValueFrom(interceptor.intercept(http(path, params), next))).resolves.toBe('proxied');
    expect(membership.isMember).toHaveBeenCalledWith('c1', 'own');
  });

  it('answers foreign agents like unknown ones without proxying', async () => {
    const next = handler();

    await expect(
      firstValueFrom(
        interceptor.intercept(
          http('/api/clients/:clientId/agents/:agentId/egress', { clientId: 'c1', agentId: 'x' }),
          next,
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('ignores routes without a workspace agent and non-http contexts', async () => {
    for (const [path, params] of [
      ['/api/clients/:id/agents', { id: 'c1' }],
      ['/api/tickets/:id', { id: 't1', agentId: 'x' }],
    ] as const) {
      await expect(firstValueFrom(interceptor.intercept(http(path, params), handler()))).resolves.toBe('proxied');
    }

    const ws = { getType: () => 'ws' } as unknown as ExecutionContext;

    await expect(firstValueFrom(interceptor.intercept(ws, handler()))).resolves.toBe('proxied');
    expect(membership.isMember).not.toHaveBeenCalled();
  });
});
