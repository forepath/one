import { ClientAgentMembershipService } from './client-agent-membership.service';

describe('ClientAgentMembershipService', () => {
  const clientId = 'client-a';
  let credentials: { findByClientAndAgent: jest.Mock };
  let membership: ClientAgentMembershipService;

  beforeEach(() => {
    credentials = {
      findByClientAndAgent: jest.fn(async (client: string, agent: string) =>
        client === clientId && agent === 'own-agent' ? { id: 'cred' } : null,
      ),
    };
    membership = new ClientAgentMembershipService(credentials as never);
  });

  it('knows only agents with stored credentials of the workspace (case-insensitive ids)', async () => {
    await expect(membership.isMember(clientId, 'OWN-AGENT')).resolves.toBe(true);
    await expect(membership.isMember(clientId, 'foreign-agent')).resolves.toBe(false);
    await expect(membership.isMember('client-b', 'own-agent')).resolves.toBe(false);
  });

  it('filters agent lists in order and caches lookups until forgotten', async () => {
    const agents = [{ id: 'foreign-agent' }, { id: 'own-agent' }, { id: 'other' }];

    await expect(membership.filterMembers(clientId, agents)).resolves.toEqual([{ id: 'own-agent' }]);
    await membership.isMember(clientId, 'own-agent');
    expect(credentials.findByClientAndAgent).toHaveBeenCalledTimes(3);

    // Credentials removed (agent deleted): the next check reads them again.
    credentials.findByClientAndAgent.mockResolvedValue(null);
    membership.forget(clientId, 'own-agent');
    await expect(membership.isMember(clientId, 'own-agent')).resolves.toBe(false);
  });

  it('re-reads non-members quickly so a newly created agent is reachable', async () => {
    jest.useFakeTimers();

    try {
      await expect(membership.isMember(clientId, 'new-agent')).resolves.toBe(false);
      credentials.findByClientAndAgent.mockResolvedValue({ id: 'cred' });
      await expect(membership.isMember(clientId, 'new-agent')).resolves.toBe(false);
      jest.advanceTimersByTime(5_001);
      await expect(membership.isMember(clientId, 'new-agent')).resolves.toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('attributes manager-wide progress to the workspace that is creating the agent', async () => {
    const release = membership.trackCreate(clientId, ' new env ');

    await expect(membership.concernsWorkspace(clientId, { agentId: null, agentName: 'new env' })).resolves.toBe(true);
    await expect(membership.concernsWorkspace('client-b', { agentId: null, agentName: 'new env' })).resolves.toBe(
      false,
    );
    await expect(membership.concernsWorkspace(clientId, { agentId: 'own-agent', agentName: 'x' })).resolves.toBe(true);
    await expect(membership.concernsWorkspace(clientId, { agentId: 'foreign-agent' })).resolves.toBe(false);

    release();
    await expect(membership.concernsWorkspace(clientId, { agentId: null, agentName: 'new env' })).resolves.toBe(false);
  });
});
