import { NotFoundException } from '@nestjs/common';
import axios from 'axios';

import { ClientAgentMembershipService } from './client-agent-membership.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';

jest.mock('axios');
jest.mock('../utils/client-endpoint-security', () => ({
  ...jest.requireActual('../utils/client-endpoint-security'),
  validateClientEndpointWithDnsOrThrow: jest.fn().mockResolvedValue(undefined),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Workspace isolation of the proxy: the manager behind a workspace may serve other workspaces' agents too. */
describe('ClientAgentProxyService workspace membership', () => {
  const clientId = 'client-a';
  let membership: ClientAgentMembershipService;
  let credentials: { saveCredentials: jest.Mock; deleteCredentials: jest.Mock };
  let service: ClientAgentProxyService;

  const respond = (data: unknown) =>
    mockedAxios.request.mockResolvedValueOnce({
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    membership = new ClientAgentMembershipService({
      findByClientAndAgent: jest.fn(async (client: string, agent: string) =>
        client === clientId && ['own-1', 'own-2', 'own-3'].includes(agent) ? { id: 'cred' } : null,
      ),
    } as never);
    credentials = { saveCredentials: jest.fn(), deleteCredentials: jest.fn() };
    service = new ClientAgentProxyService(
      { getAccessToken: jest.fn() } as never,
      {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: clientId,
          endpoint: 'http://manager:3000',
          authenticationType: 'api_key',
          apiKey: 'key',
        }),
      } as never,
      credentials as never,
      {
        recordEntityCreated: jest.fn().mockResolvedValue(undefined),
        recordEntityDeleted: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
      membership,
    );
  });

  it('lists only the workspace agents and pages after filtering', async () => {
    const managerAgents = ['foreign-1', 'own-1', 'foreign-2', 'own-2', 'own-3'].map((id) => ({ id, name: id }));

    respond(managerAgents);
    await expect(service.getClientAgents(clientId, 2, 0)).resolves.toEqual([
      { id: 'own-1', name: 'own-1' },
      { id: 'own-2', name: 'own-2' },
    ]);
    expect(mockedAxios.request).toHaveBeenCalledWith(expect.objectContaining({ params: { limit: 1000, offset: 0 } }));

    respond(managerAgents);
    await expect(service.getClientAgents(clientId, 2, 2)).resolves.toEqual([{ id: 'own-3', name: 'own-3' }]);
  });

  it('refuses single foreign agents without asking the manager', async () => {
    await expect(service.getClientAgent(clientId, 'foreign-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('keeps manager-wide progress to own agents and own creates in flight', async () => {
    const release = membership.trackCreate(clientId, 'new env');

    respond([
      { operationId: '1', agentId: 'own-1', agentName: 'own-1' },
      { operationId: '2', agentId: 'foreign-1', agentName: 'foreign-1' },
      { operationId: '3', agentId: null, agentName: 'new env' },
      { operationId: '4', agentId: null, agentName: 'someone else' },
    ]);
    await expect(service.getClientEnvironmentProgress(clientId)).resolves.toEqual([
      { operationId: '1', agentId: 'own-1', agentName: 'own-1' },
      { operationId: '3', agentId: null, agentName: 'new env' },
    ]);
    release();
  });

  it('keeps egress events of own agents and the cursor of the whole page', async () => {
    respond({
      events: [
        { seq: '1', agentId: 'foreign-1' },
        { seq: '2', agentId: 'own-2' },
      ],
      nextSeq: '2',
      hasMore: false,
    });

    await expect(service.listClientEgressEvents(clientId, '0', 50)).resolves.toEqual({
      events: [{ seq: '2', agentId: 'own-2' }],
      nextSeq: '2',
      hasMore: false,
    });
  });

  it('makes a created agent a member at once and drops it when deleted', async () => {
    const forget = jest.spyOn(membership, 'forget');

    respond({ id: 'new-agent', name: 'new env', password: 'secret' });
    await service.createClientAgent(clientId, { name: 'new env' } as never);
    expect(credentials.saveCredentials).toHaveBeenCalledWith(clientId, 'new-agent', 'secret');
    expect(forget).toHaveBeenCalledWith(clientId, 'new-agent');
    expect(membership.isPendingCreate(clientId, 'new env')).toBe(false);

    respond(undefined);
    await service.deleteClientAgent(clientId, 'own-1');
    expect(forget).toHaveBeenCalledWith(clientId, 'own-1');
  });
});
