import { OpenCodeSessionService } from './opencode-session.service';

describe('OpenCodeSessionService', () => {
  it('creates automation sessions with allow-all permission and platform agent', async () => {
    const create = jest.fn().mockResolvedValue({ data: { id: 'ses_auto' } });
    const clientFactory = {
      getClient: jest.fn().mockResolvedValue({
        session: {
          get: jest.fn().mockRejectedValue(new Error('missing')),
          create,
        },
      }),
    };
    const agentsRepository = {
      findPersistedAcpSessionId: jest.fn().mockResolvedValue(null),
      saveAcpSession: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OpenCodeSessionService(clientFactory as never, agentsRepository as never);

    await service.getOrCreateSessionId({
      agentId: 'agent-1',
      containerId: 'ctr-1',
      resumeSessionSuffix: '-ticket-auto-loop',
    });

    expect(create).toHaveBeenCalledWith({
      body: {
        title: 'agenstra (-ticket-auto-loop)',
        agent: 'agenstra-automation',
        permission: [{ permission: '*', pattern: '*', action: 'allow' }],
      },
    });
  });

  it('does not attach automation permission override for interactive chat', async () => {
    const create = jest.fn().mockResolvedValue({ data: { id: 'ses_chat' } });
    const clientFactory = {
      getClient: jest.fn().mockResolvedValue({
        session: {
          get: jest.fn().mockRejectedValue(new Error('missing')),
          create,
        },
      }),
    };
    const agentsRepository = {
      findPersistedAcpSessionId: jest.fn().mockResolvedValue(null),
      saveAcpSession: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OpenCodeSessionService(clientFactory as never, agentsRepository as never);

    await service.getOrCreateSessionId({
      agentId: 'agent-1',
      containerId: 'ctr-1',
      resumeSessionSuffix: '-chat-abc',
    });

    expect(create).toHaveBeenCalledWith({
      body: {
        title: 'agenstra (-chat-abc)',
      },
    });
  });
});
