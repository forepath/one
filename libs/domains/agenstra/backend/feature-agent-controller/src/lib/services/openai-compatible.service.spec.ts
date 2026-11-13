import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';

import { FilterDropDirection } from '../entities/statistics-chat-filter-drop.entity';
import { FilterFlagDirection } from '../entities/statistics-chat-filter-flag.entity';
import { OpenAiApiError } from '../utils/openai-compatible-errors';

import { isOpenAiCompatibleApiEnabled, OpenAiCompatibleService } from './openai-compatible.service';
import { RemoteChatTurnAbortedError } from './remote-agents-session.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- collaborator fakes */

describe('OpenAiCompatibleService', () => {
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const chatId = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
  let remoteAgents: { sendVisibleChatTurn: jest.Mock };
  let clientAgentProxy: { listClientAgentModels: jest.Mock; getClientAgent: jest.Mock };
  let chatsProxy: { get: jest.Mock };
  let effectiveConfigSync: { buildPlatformPolicy: jest.Mock };
  let statistics: { recordChatFilterDrop: jest.Mock; recordChatFilterFlag: jest.Mock };
  let notifications: {
    publishChatMessage: jest.Mock;
    publishAgentChatFailed: jest.Mock;
    publishMessageFilterTriggered: jest.Mock;
  };
  let consoleStatus: { onAgentChatActivity: jest.Mock };
  let service: OpenAiCompatibleService;

  beforeEach(() => {
    remoteAgents = { sendVisibleChatTurn: jest.fn() };
    clientAgentProxy = {
      listClientAgentModels: jest.fn().mockResolvedValue({ 'openai/gpt-5': 'GPT-5', 'anthropic/claude': 'Claude' }),
      getClientAgent: jest.fn().mockResolvedValue({ id: agentId, primaryChatId: chatId }),
    };
    chatsProxy = { get: jest.fn() };
    effectiveConfigSync = { buildPlatformPolicy: jest.fn().mockResolvedValue({ messageFilters: [] }) };
    statistics = {
      recordChatFilterDrop: jest.fn().mockResolvedValue(undefined),
      recordChatFilterFlag: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      publishChatMessage: jest.fn(),
      publishAgentChatFailed: jest.fn(),
      publishMessageFilterTriggered: jest.fn(),
    };
    consoleStatus = { onAgentChatActivity: jest.fn().mockResolvedValue(undefined) };
    service = new OpenAiCompatibleService(
      remoteAgents as any,
      clientAgentProxy as any,
      chatsProxy as any,
      effectiveConfigSync as any,
      statistics as any,
      notifications as any,
      consoleStatus as any,
    );
  });

  afterEach(() => {
    delete process.env['OPENAI_COMPATIBLE_API_ENABLED'];
  });

  it('is enabled unless explicitly disabled', () => {
    expect(isOpenAiCompatibleApiEnabled()).toBe(true);
    process.env['OPENAI_COMPATIBLE_API_ENABLED'] = 'FALSE';
    expect(isOpenAiCompatibleApiEnabled()).toBe(false);
    process.env['OPENAI_COMPATIBLE_API_ENABLED'] = 'true';
    expect(isOpenAiCompatibleApiEnabled()).toBe(true);
  });

  describe('models', () => {
    it('lists the default alias and the agent models', async () => {
      await expect(service.listModels(clientId, agentId)).resolves.toEqual({
        object: 'list',
        data: [
          { id: 'default', object: 'model', created: 0, owned_by: 'agenstra' },
          { id: 'openai/gpt-5', object: 'model', created: 0, owned_by: 'openai' },
          { id: 'anthropic/claude', object: 'model', created: 0, owned_by: 'anthropic' },
        ],
      });
      await expect(service.getModel(clientId, agentId, 'openai/gpt-5')).resolves.toEqual(
        expect.objectContaining({ id: 'openai/gpt-5' }),
      );
      await expect(service.getModel(clientId, agentId, 'nope')).rejects.toBeInstanceOf(OpenAiApiError);
    });

    it('resolves default aliases to the agent default and validates explicit models', async () => {
      await expect(service.resolveModel(clientId, agentId, 'default')).resolves.toBeUndefined();
      await expect(service.resolveModel(clientId, agentId, 'agenstra')).resolves.toBeUndefined();
      expect(clientAgentProxy.listClientAgentModels).not.toHaveBeenCalled();
      await expect(service.resolveModel(clientId, agentId, 'openai/gpt-5')).resolves.toBe('openai/gpt-5');
      await expect(service.resolveModel(clientId, agentId, 'gpt-4o')).rejects.toMatchObject({
        errorCode: 'model_not_found',
        param: 'model',
      });
      // Prototype keys are not models.
      await expect(service.resolveModel(clientId, agentId, 'constructor')).rejects.toBeInstanceOf(OpenAiApiError);
    });
  });

  describe('chat sessions', () => {
    it('defaults to the primary session', async () => {
      await expect(service.resolveChatId(clientId, agentId)).resolves.toBe(chatId);
      expect(chatsProxy.get).not.toHaveBeenCalled();
    });

    it('accepts sessions of this agent only', async () => {
      chatsProxy.get.mockResolvedValueOnce({ id: chatId });
      await expect(service.resolveChatId(clientId, agentId, chatId)).resolves.toBe(chatId);
      expect(chatsProxy.get).toHaveBeenCalledWith(clientId, agentId, chatId);

      chatsProxy.get.mockRejectedValueOnce(new NotFoundException('Chat session not found'));
      await expect(service.resolveChatId(clientId, agentId, chatId)).rejects.toMatchObject({
        errorCode: 'conversation_not_found',
      });

      chatsProxy.get.mockRejectedValueOnce(new BadRequestException('Failed to connect'));
      await expect(service.resolveChatId(clientId, agentId, chatId)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('canStreamDeltas', () => {
    const rule = (overrides: Record<string, unknown>) => ({
      name: 'r',
      pattern: 'x',
      flags: 'g',
      direction: 'outgoing',
      action: 'replace',
      enabled: true,
      source: 'global',
      ...overrides,
    });

    it('allows live deltas without rewriting outgoing filters', async () => {
      effectiveConfigSync.buildPlatformPolicy.mockResolvedValue({
        messageFilters: [
          rule({ action: 'flag' }),
          rule({ direction: 'incoming', action: 'drop' }),
          rule({ enabled: false }),
        ],
      });

      await expect(service.canStreamDeltas(clientId, agentId)).resolves.toBe(true);
    });

    it.each([
      ['an outgoing replace rule', { direction: 'outgoing', action: 'replace' }],
      ['an outgoing drop rule', { direction: 'outgoing', action: 'drop' }],
      ['a bidirectional drop rule', { direction: 'bidirectional', action: 'drop' }],
    ])('streams filtered answers only with %s', async (_label, overrides) => {
      effectiveConfigSync.buildPlatformPolicy.mockResolvedValue({ messageFilters: [rule(overrides)] });

      await expect(service.canStreamDeltas(clientId, agentId)).resolves.toBe(false);
    });

    it('fails closed when the policy cannot be resolved', async () => {
      effectiveConfigSync.buildPlatformPolicy.mockRejectedValue(new Error('manager down'));

      await expect(service.canStreamDeltas(clientId, agentId)).resolves.toBe(false);
    });
  });

  describe('runTurn', () => {
    const turn = { clientId, agentId, chatId, prompt: 'hello', model: 'openai/gpt-5', userId: 'user-1' };

    it('runs the turn and publishes console-equivalent side effects', async () => {
      remoteAgents.sendVisibleChatTurn.mockResolvedValue({ text: 'answer', finishReason: 'stop' });

      await expect(service.runTurn(turn)).resolves.toEqual({ text: 'answer', finishReason: 'stop' });

      expect(remoteAgents.sendVisibleChatTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId,
          agentId,
          chatId,
          message: 'hello',
          model: 'openai/gpt-5',
          userId: 'user-1',
          correlationId: expect.stringMatching(/^openai:/),
        }),
      );
      expect(notifications.publishChatMessage).toHaveBeenNthCalledWith(1, clientId, {
        agentId,
        direction: 'incoming',
        source: 'user',
        message: 'hello',
        userId: 'user-1',
        chatId,
      });
      expect(notifications.publishChatMessage).toHaveBeenNthCalledWith(2, clientId, {
        agentId,
        direction: 'outgoing',
        source: 'agent',
        message: 'answer',
        userId: 'user-1',
        chatId,
      });
      expect(consoleStatus.onAgentChatActivity).toHaveBeenCalledWith(clientId, agentId, chatId);
    });

    it('does not publish an outgoing message for a dropped turn', async () => {
      remoteAgents.sendVisibleChatTurn.mockResolvedValue({ text: '', finishReason: 'content_filter' });

      await service.runTurn(turn);

      expect(notifications.publishChatMessage).toHaveBeenCalledTimes(1);
    });

    it('records filter results like the console gateway', async () => {
      remoteAgents.sendVisibleChatTurn.mockImplementation(async (params: any) => {
        params.onFilterResult({
          direction: 'incoming',
          status: 'dropped',
          matchedFilter: { type: 'regex', displayName: 'Secrets', reason: 'secret' },
        });
        params.onFilterResult({ direction: 'outgoing', status: 'filtered', message: 'two words' });

        return { text: '', finishReason: 'content_filter' };
      });

      await service.runTurn(turn);

      expect(statistics.recordChatFilterDrop).toHaveBeenCalledWith(
        clientId,
        agentId,
        'regex',
        'Secrets',
        FilterDropDirection.INCOMING,
        1,
        5,
        'user-1',
        'secret',
      );
      expect(statistics.recordChatFilterFlag).toHaveBeenCalledWith(
        clientId,
        agentId,
        'unknown',
        'Unknown Filter',
        FilterFlagDirection.OUTGOING,
        2,
        9,
        'user-1',
        undefined,
      );
      expect(notifications.publishMessageFilterTriggered).toHaveBeenCalledTimes(2);
      expect(notifications.publishMessageFilterTriggered).toHaveBeenCalledWith(
        clientId,
        expect.objectContaining({
          direction: 'incoming',
          status: 'dropped',
          filterDisplayName: 'Secrets',
          userId: 'user-1',
        }),
      );
    });

    it('publishes agent.chat_failed on agent errors, not on unknown chats or aborts', async () => {
      remoteAgents.sendVisibleChatTurn.mockRejectedValueOnce(new BadGatewayException('The agent failed to answer'));
      await expect(service.runTurn(turn)).rejects.toBeInstanceOf(BadGatewayException);
      expect(notifications.publishAgentChatFailed).toHaveBeenCalledWith(clientId, {
        agentId,
        message: 'The agent failed to answer',
        code: 'CHAT_ERROR',
      });

      notifications.publishAgentChatFailed.mockClear();
      remoteAgents.sendVisibleChatTurn.mockRejectedValueOnce(new NotFoundException('Chat session not found'));
      await expect(service.runTurn(turn)).rejects.toBeInstanceOf(NotFoundException);

      const controller = new AbortController();

      controller.abort();
      remoteAgents.sendVisibleChatTurn.mockRejectedValueOnce(new RemoteChatTurnAbortedError());
      await expect(service.runTurn({ ...turn, signal: controller.signal })).rejects.toBeInstanceOf(
        RemoteChatTurnAbortedError,
      );
      expect(notifications.publishAgentChatFailed).not.toHaveBeenCalled();
    });
  });
});
