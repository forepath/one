import { parseAgentHandoffChatMessage } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator, type Repository } from 'typeorm';

import { AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS } from '../constants/agent-handoffs.constants';
import type { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';

import { AgentHandoffRunnerService } from './agent-handoff-runner.service';
import type { ClientAgentChatsProxyService } from './client-agent-chats-proxy.service';
import type { RemoteAgentsSessionService, RemoteChatStreamingParams } from './remote-agents-session.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- typeorm FindOperator internals in the repository fake */

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];

    if (expected instanceof FindOperator) {
      const op = expected as any;

      switch (op.type) {
        case 'isNull':
          return actual === null || actual === undefined;
        case 'in':
          return (op.value as unknown[]).includes(actual);
        default:
          throw new Error(`unsupported operator ${op.type}`);
      }
    }

    return actual === expected;
  });
}

/** Single-row repository fake: enough for the conditional updates of the runner. */
function createRepo(initial: AgentHandoffEntity) {
  const state = { row: { ...initial } as AgentHandoffEntity };
  const repo = {
    state,
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      matches(state.row as any, where) ? { ...state.row } : null,
    ),
    findOneOrFail: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (!matches(state.row as any, where)) {
        throw new Error('not found');
      }

      return { ...state.row };
    }),
    update: jest.fn(async (criteria: Record<string, unknown>, patch: Partial<AgentHandoffEntity>) => {
      if (!matches(state.row as any, criteria)) {
        return { affected: 0 };
      }

      state.row = { ...state.row, ...patch, updatedAt: new Date() };

      return { affected: 1 };
    }),
    increment: jest.fn(async (_criteria: unknown, column: keyof AgentHandoffEntity, by: number) => {
      (state.row as any)[column] = ((state.row as any)[column] ?? 0) + by;
    }),
    find: jest.fn().mockResolvedValue([]),
  };

  return repo;
}

describe('AgentHandoffRunnerService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const sourceAgentId = '00000000-0000-4000-8000-000000000020';
  const targetAgentId = '00000000-0000-4000-8000-000000000030';
  const handoffId = '00000000-0000-4000-8000-000000000040';
  const sourceChatId = '00000000-0000-4000-8000-000000000050';
  const targetChatId = '00000000-0000-4000-8000-000000000060';
  let repo: ReturnType<typeof createRepo>;
  let remoteChat: { sendChatStreaming: jest.Mock };
  let chatsProxy: { get: jest.Mock };
  let runner: AgentHandoffRunnerService;

  const baseHandoff = (overrides: Partial<AgentHandoffEntity> = {}): AgentHandoffEntity =>
    ({
      id: handoffId,
      clientId,
      sourceAgentId,
      sourceAgentName: 'Backend',
      sourceChatId,
      parentHandoffId: null,
      depth: 1,
      targetAgentId,
      targetAgentName: 'Reviewer',
      targetChatId,
      title: 'Review the API',
      message: 'Check the endpoints.',
      model: 'openai/gpt-5',
      sourceModel: 'anthropic/claude-opus-5-5',
      status: 'pending',
      response: null,
      failureMessage: null,
      deliveredAt: null,
      deliveryAttempts: 0,
      deliveryFailureMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as AgentHandoffEntity;

  const respond = (status: 'completed' | 'failed', response: string) => {
    repo.state.row = { ...repo.state.row, status, response, finishedAt: new Date() };
  };

  /** Delivery turns report the accepted user message like the manager does. */
  const acceptDelivery = async (params: RemoteChatStreamingParams) => {
    await params.onEvent?.({ success: true, data: { kind: 'userMessage', correlationId: params.correlationId } });

    return { text: 'Thanks, continuing.' };
  };

  const targetCalls = () =>
    remoteChat.sendChatStreaming.mock.calls
      .map(([params]) => params as RemoteChatStreamingParams)
      .filter((params) => params.agentId === targetAgentId);
  const deliveryCalls = () =>
    remoteChat.sendChatStreaming.mock.calls
      .map(([params]) => params as RemoteChatStreamingParams)
      .filter((params) => params.agentId === sourceAgentId);

  const setup = (handoff: AgentHandoffEntity) => {
    repo = createRepo(handoff);
    runner = new AgentHandoffRunnerService(
      repo as unknown as Repository<AgentHandoffEntity>,
      remoteChat as unknown as RemoteAgentsSessionService,
      chatsProxy as unknown as ClientAgentChatsProxyService,
    );
  };

  beforeEach(() => {
    remoteChat = { sendChatStreaming: jest.fn() };
    chatsProxy = { get: jest.fn().mockResolvedValue({ id: 'chat' }) };
    setup(baseHandoff());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs the target in its handoff chat and delivers the response into the source chat', async () => {
    remoteChat.sendChatStreaming.mockImplementation(async (params: RemoteChatStreamingParams) => {
      if (params.agentId === targetAgentId) {
        respond('completed', 'Looks good.');

        return { text: 'Reviewed, responding now.' };
      }

      return acceptDelivery(params);
    });

    await runner.executeHandoff({ handoffId });

    const [target] = targetCalls();
    const [delivery] = deliveryCalls();

    expect(target).toEqual(
      expect.objectContaining({
        clientId,
        chatId: targetChatId,
        ephemeral: false,
        suppressUserMessage: false,
        model: 'openai/gpt-5',
        statisticsInteractionKind: StatisticsInteractionKind.AGENT_HANDOFF,
      }),
    );
    expect(parseAgentHandoffChatMessage(target.message)).toEqual(
      expect.objectContaining({ kind: 'request', meta: expect.objectContaining({ sourceChatId }) }),
    );
    expect(delivery).toEqual(
      expect.objectContaining({ clientId, chatId: sourceChatId, ephemeral: false, model: 'anthropic/claude-opus-5-5' }),
    );
    expect(parseAgentHandoffChatMessage(delivery.message)).toEqual({
      kind: 'response',
      meta: expect.objectContaining({ status: 'completed', targetChatId, targetAgentId }),
      body: 'Looks good.',
    });
    expect(repo.state.row.deliveredAt).toBeInstanceOf(Date);
  });

  it('repairs turns that ended without a response (hidden prompt, same chat)', async () => {
    let turns = 0;

    remoteChat.sendChatStreaming.mockImplementation(async (params: RemoteChatStreamingParams) => {
      if (params.agentId === targetAgentId) {
        turns++;

        if (turns === 2) {
          respond('completed', 'Done after reminder.');
        }

        return { text: 'Working on it.' };
      }

      return acceptDelivery(params);
    });

    await runner.executeHandoff({ handoffId });

    const calls = targetCalls();

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(expect.objectContaining({ chatId: targetChatId, suppressUserMessage: true }));
    expect(calls[1].message).toContain('You have not answered');
    expect(deliveryCalls()).toHaveLength(1);
  });

  it('falls back to the last answer when the target never responds', async () => {
    remoteChat.sendChatStreaming.mockImplementation(async (params: RemoteChatStreamingParams) =>
      params.agentId === targetAgentId ? { text: 'Here is what I found.' } : acceptDelivery(params),
    );

    await runner.executeHandoff({ handoffId });

    expect(targetCalls()).toHaveLength(3);
    expect(repo.state.row.status).toBe('completed');
    expect(repo.state.row.response).toContain('Here is what I found.');
    expect(parseAgentHandoffChatMessage(deliveryCalls()[0].message)?.body).toContain('Here is what I found.');
  });

  it('fails and still responds when the target turn errors', async () => {
    remoteChat.sendChatStreaming.mockImplementation(async (params: RemoteChatStreamingParams) => {
      if (params.agentId === targetAgentId) {
        throw new BadRequestException('Timed out waiting for agent chat response');
      }

      return acceptDelivery(params);
    });

    await runner.executeHandoff({ handoffId });

    expect(repo.state.row.status).toBe('failed');
    expect(repo.state.row.failureMessage).toContain('Timed out');
    expect(parseAgentHandoffChatMessage(deliveryCalls()[0].message)?.meta).toEqual(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('keeps a response recorded before the turn errored', async () => {
    remoteChat.sendChatStreaming.mockImplementation(async (params: RemoteChatStreamingParams) => {
      if (params.agentId === targetAgentId) {
        respond('completed', 'Done.');
        throw new BadRequestException('Remote chat failed');
      }

      return acceptDelivery(params);
    });

    await runner.executeHandoff({ handoffId });

    expect(repo.state.row.status).toBe('completed');
    expect(parseAgentHandoffChatMessage(deliveryCalls()[0].message)?.body).toBe('Done.');
  });

  it('never redirects a response: a deleted requesting chat makes it undeliverable', async () => {
    setup(baseHandoff({ status: 'completed', response: 'ok' }));
    chatsProxy.get.mockRejectedValue(new NotFoundException('Chat session not found'));

    await runner.executeHandoff({ handoffId });

    expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
    expect(repo.state.row.deliveryFailureMessage).toBe('The requesting chat no longer exists.');

    await runner.executeHandoff({ handoffId });
    expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
  });

  it('gives up delivering after the last attempt instead of retrying forever', async () => {
    setup(
      baseHandoff({ status: 'completed', response: 'ok', deliveryAttempts: AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS - 1 }),
    );
    remoteChat.sendChatStreaming.mockRejectedValue(new BadRequestException('Remote socket connect timeout'));

    await expect(runner.executeHandoff({ handoffId })).resolves.toBeUndefined();
    expect(repo.state.row.deliveryFailureMessage).toContain('could not be delivered');
  });

  it('reports a target that disappeared during its turn', async () => {
    let targetChecks = 0;

    chatsProxy.get.mockImplementation(async (_clientId: string, agentId: string) => {
      if (agentId === targetAgentId && ++targetChecks > 1) {
        throw new NotFoundException('Agent not found');
      }

      return { id: 'chat' };
    });
    remoteChat.sendChatStreaming.mockImplementation(async (params: RemoteChatStreamingParams) => {
      if (params.agentId === targetAgentId) {
        throw new BadRequestException('Remote login timeout');
      }

      return acceptDelivery(params);
    });

    await runner.executeHandoff({ handoffId });

    expect(repo.state.row.failureMessage).toBe('The target agent "Reviewer" or its handoff chat no longer exists.');
    expect(deliveryCalls()[0].chatId).toBe(sourceChatId);
  });

  it('fails the handoff when its chat was deleted before it started', async () => {
    chatsProxy.get.mockImplementation(async (_clientId: string, agentId: string) => {
      if (agentId === targetAgentId) {
        throw new NotFoundException('Chat session not found');
      }

      return { id: sourceChatId };
    });
    remoteChat.sendChatStreaming.mockImplementation(acceptDelivery);

    await runner.executeHandoff({ handoffId });

    expect(targetCalls()).toHaveLength(0);
    expect(repo.state.row.status).toBe('failed');
    expect(deliveryCalls()[0].chatId).toBe(sourceChatId);
  });

  it('retries deliveries that were not accepted and never repeats accepted ones', async () => {
    setup(baseHandoff({ status: 'completed', response: 'ok' }));
    remoteChat.sendChatStreaming.mockRejectedValueOnce(new BadRequestException('Remote socket connect timeout'));

    await expect(runner.executeHandoff({ handoffId })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.state.row.deliveryAttempts).toBe(1);
    expect(repo.state.row.deliveredAt).toBeNull();

    remoteChat.sendChatStreaming.mockImplementationOnce(async (params: RemoteChatStreamingParams) => {
      await acceptDelivery(params);
      throw new BadRequestException('Timed out waiting for agent chat response');
    });

    await expect(runner.executeHandoff({ handoffId })).resolves.toBeUndefined();
    expect(repo.state.row.deliveredAt).toBeInstanceOf(Date);

    await runner.executeHandoff({ handoffId });
    expect(remoteChat.sendChatStreaming).toHaveBeenCalledTimes(2);
  });

  it('does not prompt the target again for re-delivered running units', async () => {
    setup(baseHandoff({ status: 'running' }));

    await runner.executeHandoff({ handoffId });

    expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
  });

  it('ignores deliveries of other turns when detecting acceptance', async () => {
    setup(baseHandoff({ status: 'completed', response: 'ok' }));
    remoteChat.sendChatStreaming.mockImplementation(async (params: RemoteChatStreamingParams) => {
      await params.onEvent?.({ success: true, data: { kind: 'userMessage', correlationId: 'someone-else' } });
      throw new BadRequestException('Remote chat failed');
    });

    await expect(runner.executeHandoff({ handoffId })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.state.row.deliveredAt).toBeNull();
  });

  describe('sweep', () => {
    it('fails stalled runs and re-enqueues lost units and undelivered responses', async () => {
      setup(baseHandoff({ status: 'running', startedAt: new Date(0) }));
      repo.find
        .mockResolvedValueOnce([{ ...repo.state.row }])
        .mockResolvedValueOnce([{ id: 'other-pending' }, { id: handoffId }]);

      const enqueue = jest.fn().mockResolvedValue(undefined);

      await expect(runner.sweep(enqueue, new Date())).resolves.toBe(2);

      expect(repo.state.row.status).toBe('failed');
      expect(repo.state.row.failureMessage).toContain('did not finish');
      expect(enqueue.mock.calls.map(([job]) => job.handoffId).sort()).toEqual([handoffId, 'other-pending'].sort());
    });
  });
});
