import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { AgentProviderFactory } from '../providers/agent-provider.factory';
import type { AgentsRepository } from '../repositories/agents.repository';

import { AgentActiveTurnsService } from './agent-active-turns.service';
import type { AgentChatSessionsService } from './agent-chat-sessions.service';
import { AGENT_HANDOFF_PROFILE_PROMPT, AgentHandoffsApiService } from './agent-handoffs-api.service';

describe('AgentHandoffsApiService', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const targetAgentId = '22222222-2222-4222-8222-222222222222';
  const handoffId = '33333333-3333-4333-8333-333333333333';
  const chatId = '44444444-4444-4444-8444-444444444444';
  const primaryChatId = '55555555-5555-4555-8555-555555555555';
  const handoff = { id: handoffId, sourceAgentId: agentId, targetAgentId };
  let service: AgentHandoffsApiService;
  let turns: AgentActiveTurnsService;
  let chatSessions: { ensurePrimarySession: jest.Mock; getSession: jest.Mock };
  let agentsRepository: { findById: jest.Mock; update: jest.Mock };
  let provider: { sendMessage: jest.Mock; toParseableStrings: jest.Mock; toUnifiedResponse: jest.Mock };
  let agentRows: Record<string, Record<string, unknown>>;
  let requestControllerHandoffs: jest.Mock;
  let endTurn: () => void;

  const build = () =>
    new AgentHandoffsApiService(
      turns,
      chatSessions as unknown as AgentChatSessionsService,
      agentsRepository as unknown as AgentsRepository,
      { getProvider: jest.fn().mockReturnValue(provider) } as unknown as AgentProviderFactory,
    );

  beforeEach(() => {
    turns = new AgentActiveTurnsService();
    chatSessions = {
      ensurePrimarySession: jest.fn().mockResolvedValue({ id: primaryChatId }),
      getSession: jest.fn(async (_agentId: string, id: string) => ({ id })),
    };
    agentRows = {
      [agentId]: { id: agentId, name: 'Backend', containerId: 'c-a', agentType: 'opencode' },
      [targetAgentId]: { id: targetAgentId, name: 'Reviewer', containerId: 'c-b', agentType: 'opencode' },
    };
    agentsRepository = {
      findById: jest.fn(async (id: string) => (agentRows[id] ? { ...agentRows[id] } : null)),
      update: jest.fn(async (id: string, patch: Record<string, unknown>) => {
        agentRows[id] = { ...agentRows[id], ...patch };

        return { ...agentRows[id] };
      }),
    };
    provider = {
      sendMessage: jest.fn().mockResolvedValue('raw'),
      toParseableStrings: jest.fn().mockReturnValue(['line']),
      toUnifiedResponse: jest.fn().mockReturnValue({ type: 'result', result: '  I own the review pipeline.  ' }),
    };
    // The MCP call happens inside a turn of a visible chat.
    endTurn = turns.begin(agentId, `-chat-${chatId}`);
    service = build();
    requestControllerHandoffs = jest.fn().mockResolvedValue({ ok: true, handoff, agents: [] });
    service.registerBridge({ requestControllerHandoffs });
  });

  it('is unavailable without a gateway bridge', async () => {
    await expect(build().agents(agentId)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('binds every request to the authenticated agent', async () => {
    await service.agents(agentId);
    await service.get(agentId, handoffId);
    await service.respond(agentId, handoffId, { status: 'completed', response: 'done' });

    expect(requestControllerHandoffs.mock.calls.map(([id, request]) => [id, request])).toEqual([
      [agentId, { op: 'agents', agentId }],
      [agentId, { op: 'get', agentId, handoffId }],
      [agentId, { op: 'respond', agentId, handoffId, input: { status: 'completed', response: 'done' } }],
    ]);
  });

  it('defaults the model to the last chat model of the target, then of the caller', async () => {
    const input = { targetAgentId, title: 't', message: 'm' };

    await service.create(agentId, input);
    expect(requestControllerHandoffs.mock.calls[0][1]).toEqual({ op: 'create', agentId, sourceChatId: chatId, input });

    service.rememberChatModel(agentId, ' openai/gpt-5 ');
    await service.create(agentId, input);
    expect(requestControllerHandoffs.mock.calls[1][1].input.model).toBe('openai/gpt-5');

    service.rememberChatModel(targetAgentId, 'anthropic/claude-opus-5-5');
    await service.create(agentId, input);
    expect(requestControllerHandoffs.mock.calls[2][1].input.model).toBe('anthropic/claude-opus-5-5');

    await service.create(agentId, { ...input, model: 'explicit/model' });
    expect(requestControllerHandoffs.mock.calls[3][1].input.model).toBe('explicit/model');
  });

  it('sends the model of the requesting chat for the response turn', async () => {
    service.rememberChatModel(agentId, 'other/model', '66666666-6666-4666-8666-666666666666');
    service.rememberChatModel(agentId, 'chat/model', chatId);
    service.rememberChatModel(agentId, 'latest/model', '66666666-6666-4666-8666-666666666666');

    await service.create(agentId, { targetAgentId, title: 't', message: 'm' });

    expect(requestControllerHandoffs.mock.calls[0][1]).toEqual(
      expect.objectContaining({ sourceModel: 'chat/model', input: expect.objectContaining({ model: 'chat/model' }) }),
    );
  });

  it('maps controller errors to HTTP errors with their status', async () => {
    requestControllerHandoffs.mockResolvedValue({ ok: false, error: 'Target agent not found', status: 404 });

    await expect(service.create(agentId, { targetAgentId, title: 't', message: 'm' })).rejects.toMatchObject({
      message: 'Target agent not found',
      status: 404,
    });

    requestControllerHandoffs.mockResolvedValue({ ok: false, error: 'boom' });

    await expect(service.agents(agentId)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects malformed success responses', async () => {
    requestControllerHandoffs.mockResolvedValue({ ok: true });

    await expect(service.get(agentId, handoffId)).rejects.toBeInstanceOf(HttpException);
  });

  it('sends the primary chat id for handoffs from the primary chat', async () => {
    endTurn();
    endTurn = turns.begin(agentId, '');

    await service.create(agentId, { targetAgentId, title: 't', message: 'm' });

    expect(requestControllerHandoffs.mock.calls[0][1].sourceChatId).toBe(primaryChatId);
  });

  it('refuses handoffs when the requesting chat cannot be determined or a response could not arrive', async () => {
    const input = { targetAgentId, title: 't', message: 'm' };

    endTurn();
    await expect(service.create(agentId, input)).rejects.toBeInstanceOf(BadRequestException);

    const endTask = turns.begin(agentId, '-task-1');

    await expect(service.create(agentId, input)).rejects.toThrow(/only available in visible chats/);

    endTurn = turns.begin(agentId, `-chat-${chatId}`);
    await expect(service.create(agentId, input)).rejects.toBeInstanceOf(ConflictException);

    endTask();
    chatSessions.getSession.mockRejectedValue(new NotFoundException('Chat session not found'));
    await expect(service.create(agentId, input)).rejects.toThrow(/no longer exists/);

    expect(requestControllerHandoffs).not.toHaveBeenCalled();
  });

  it('lists peers with the own entry so the agent sees what others read about it', async () => {
    agentRows[agentId].handoffProfile = 'Owns the API';
    requestControllerHandoffs.mockResolvedValue({ ok: true, agents: [{ id: targetAgentId, name: 'Reviewer' }] });

    await expect(service.agents(agentId)).resolves.toEqual({
      self: { id: agentId, name: 'Backend', handoffProfile: 'Owns the API' },
      agents: [{ id: targetAgentId, name: 'Reviewer' }],
    });
  });

  it('updates only the calling agent profile and clears it with an empty string', async () => {
    await expect(service.updateProfile(agentId, { profile: ' Owns the API ' })).resolves.toEqual(
      expect.objectContaining({ id: agentId, handoffProfile: 'Owns the API' }),
    );
    await service.updateProfile(agentId, { profile: '' });

    expect(agentsRepository.update).toHaveBeenNthCalledWith(1, agentId, { handoffProfile: 'Owns the API' });
    expect(agentsRepository.update).toHaveBeenNthCalledWith(2, agentId, { handoffProfile: null });
  });

  describe('peerProfile', () => {
    beforeEach(() => {
      requestControllerHandoffs.mockResolvedValue({
        ok: true,
        agents: [{ id: targetAgentId, name: 'Reviewer', containerType: 'generic' }],
      });
    });

    it('only serves agents of the workspace (controller list)', async () => {
      await expect(service.peerProfile(agentId, '99999999-9999-4999-8999-999999999999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(provider.sendMessage).not.toHaveBeenCalled();
    });

    it('returns an existing profile without generating', async () => {
      requestControllerHandoffs.mockResolvedValue({
        ok: true,
        agents: [{ id: targetAgentId, name: 'Reviewer', handoffProfile: 'Reviews code' }],
      });

      await expect(service.peerProfile(agentId, targetAgentId)).resolves.toEqual(
        expect.objectContaining({ handoffProfile: 'Reviews code' }),
      );
      expect(provider.sendMessage).not.toHaveBeenCalled();
    });

    it('generates a missing profile once in a read-only session with the fixed prompt and stores it', async () => {
      service.rememberChatModel(targetAgentId, 'target/model');

      const [first, second] = await Promise.all([
        service.peerProfile(agentId, targetAgentId),
        service.peerProfile(agentId, targetAgentId),
      ]);

      expect(first).toEqual(
        expect.objectContaining({
          id: targetAgentId,
          handoffProfile: 'I own the review pipeline.',
          containerType: 'generic',
        }),
      );
      expect(second.handoffProfile).toBe('I own the review pipeline.');
      expect(provider.sendMessage).toHaveBeenCalledTimes(1);
      expect(provider.sendMessage).toHaveBeenCalledWith(targetAgentId, 'c-b', AGENT_HANDOFF_PROFILE_PROMPT, {
        model: 'target/model',
        resumeSessionSuffix: '-handoff-profile',
      });
      expect(agentsRepository.update).toHaveBeenCalledWith(targetAgentId, {
        handoffProfile: 'I own the review pipeline.',
      });
    });

    it('keeps a profile written meanwhile and reports agents that cannot describe themselves', async () => {
      provider.sendMessage.mockImplementationOnce(async () => {
        agentRows[targetAgentId].handoffProfile = 'Written in the console';

        return 'raw';
      });

      await expect(service.peerProfile(agentId, targetAgentId)).resolves.toEqual(
        expect.objectContaining({ handoffProfile: 'Written in the console' }),
      );

      delete agentRows[targetAgentId].handoffProfile;
      provider.sendMessage.mockRejectedValueOnce(new Error('container stopped'));

      await expect(service.peerProfile(agentId, targetAgentId)).rejects.toMatchObject({ status: 502 });
    });
  });
});
