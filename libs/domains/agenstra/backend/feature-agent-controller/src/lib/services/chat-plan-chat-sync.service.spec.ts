import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatPlanEntity } from '../entities/chat-plan.entity';
import { ChatPlanPhase, ChatPlanStatus } from '../entities/chat-plan.enums';

import { AgentConsoleStatusService } from './agent-console-status.service';
import { ChatPlanRealtimeService } from './chat-plan-realtime.service';
import { CHAT_PLAN_HYDRATE_LIMIT, ChatPlanChatSyncService } from './chat-plan-chat-sync.service';

describe('ChatPlanChatSyncService', () => {
  let service: ChatPlanChatSyncService;
  const planRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
  };
  const chatRealtime = { emitToClient: jest.fn(), emitToSocket: jest.fn() };
  const agentConsoleStatusService = {
    onAutomationChatActivity: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    planRepo.createQueryBuilder.mockReturnValue(qb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatPlanChatSyncService,
        { provide: getRepositoryToken(ChatPlanEntity), useValue: planRepo },
        { provide: ChatPlanRealtimeService, useValue: chatRealtime },
        { provide: AgentConsoleStatusService, useValue: agentConsoleStatusService },
      ],
    }).compile();

    service = module.get(ChatPlanChatSyncService);
  });

  it('hydrateForAgentClient queries bounded plans and emits per row', async () => {
    const plan = {
      id: 'p1',
      clientId: 'c1',
      agentId: 'a1',
      chatId: 'chat-1',
      status: ChatPlanStatus.READY,
      phase: ChatPlanPhase.READY,
      sourcePrompt: 'hi',
      planMarkdown: '# Plan',
      summary: null,
      contextInjection: null,
      model: null,
      resumeSessionSuffix: '-plan-p1',
      completionSignalSeen: true,
      failureCode: null,
      failureMessage: null,
      createdByUserId: null,
      startedAt: new Date('2020-01-01'),
      finishedAt: null,
      createdAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-02'),
    } as ChatPlanEntity;

    const qb = planRepo.createQueryBuilder();

    qb.getMany.mockResolvedValue([plan]);
    const socket = { connected: true, emit: jest.fn() } as never;

    await service.hydrateForAgentClient(socket, 'c1', 'a1');
    expect(planRepo.createQueryBuilder).toHaveBeenCalled();
    expect(qb.take).toHaveBeenCalledWith(CHAT_PLAN_HYDRATE_LIMIT);
    expect(chatRealtime.emitToSocket).toHaveBeenCalledTimes(1);
    const payload = (chatRealtime.emitToSocket as jest.Mock).mock.calls[0][1] as {
      hydrate: boolean;
      plan: { id: string; chatId: string };
      actions: Array<{ type: string }>;
    };

    expect(payload.hydrate).toBe(true);
    expect(payload.plan.id).toBe('p1');
    expect(payload.plan.chatId).toBe('chat-1');
    expect(payload.actions.some((action: { type: string }) => action.type === 'executeChatPlan')).toBe(true);
  });

  it('offers re-execution for cancelled plans and stop actions during execution', async () => {
    const cancelledPlan = {
      id: 'p2',
      clientId: 'c1',
      agentId: 'a1',
      chatId: 'chat-1',
      status: ChatPlanStatus.CANCELLED,
      phase: ChatPlanPhase.READY,
      sourcePrompt: 'hi',
      planMarkdown: '# Plan',
      summary: null,
      contextInjection: null,
      model: null,
      resumeSessionSuffix: '-plan-p2',
      completionSignalSeen: true,
      failureCode: 'cancelled',
      failureMessage: 'Cancelled by user',
      createdByUserId: null,
      startedAt: new Date('2020-01-01'),
      finishedAt: new Date('2020-01-02'),
      createdAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-02'),
    } as ChatPlanEntity;

    const executingPlan = {
      ...cancelledPlan,
      id: 'p3',
      status: ChatPlanStatus.EXECUTING,
      phase: ChatPlanPhase.READY,
      failureCode: null,
      failureMessage: null,
      finishedAt: null,
      updatedAt: new Date('2020-01-03'),
    } as ChatPlanEntity;

    const qb = planRepo.createQueryBuilder();
    qb.getMany.mockResolvedValueOnce([cancelledPlan]).mockResolvedValueOnce([executingPlan]);

    const socket = { connected: true, emit: jest.fn() } as never;
    await service.hydrateForAgentClient(socket, 'c1', 'a1');
    const cancelledPayload = (chatRealtime.emitToSocket as jest.Mock).mock.calls[0][1] as {
      actions: Array<{ type: string }>;
    };

    expect(cancelledPayload.actions.some((action) => action.type === 'executeChatPlan')).toBe(true);

    await service.hydrateForAgentClient(socket, 'c1', 'a1');
    const executingPayload = (chatRealtime.emitToSocket as jest.Mock).mock.calls[1][1] as {
      actions: Array<{ type: string }>;
    };

    expect(executingPayload.actions.some((action) => action.type === 'cancelChatPlan')).toBe(true);
  });

  it('offers retry for failed plans', async () => {
    const failedPlan = {
      id: 'p-failed',
      clientId: 'c1',
      agentId: 'a1',
      chatId: 'chat-1',
      status: ChatPlanStatus.FAILED,
      phase: ChatPlanPhase.EXPLORE,
      sourcePrompt: 'hi',
      planMarkdown: null,
      summary: null,
      contextInjection: null,
      model: null,
      resumeSessionSuffix: '-plan-p-failed',
      completionSignalSeen: false,
      failureCode: 'agent_provider_error',
      failureMessage: 'Plan explore turn failed',
      createdByUserId: null,
      startedAt: new Date('2020-01-01'),
      finishedAt: new Date('2020-01-02'),
      createdAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-02'),
    } as ChatPlanEntity;

    const qb = planRepo.createQueryBuilder();
    qb.getMany.mockResolvedValue([failedPlan]);

    const socket = { connected: true, emit: jest.fn() } as never;
    await service.hydrateForAgentClient(socket, 'c1', 'a1');
    const payload = (chatRealtime.emitToSocket as jest.Mock).mock.calls[0][1] as {
      actions: Array<{ type: string; label: string }>;
    };

    expect(payload.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'retryChatPlan', label: 'Retry plan' })]),
    );
  });

  it('emits live plan timeline events as frontend-displayable forwarded chat event rows', async () => {
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234);
    const plan = {
      id: 'p4',
      clientId: 'c1',
      agentId: 'a1',
      chatId: 'chat-1',
      status: ChatPlanStatus.EXPLORING,
      phase: ChatPlanPhase.EXPLORE,
      sourcePrompt: 'hi',
      planMarkdown: null,
      summary: null,
      contextInjection: null,
      model: null,
      resumeSessionSuffix: '-plan-p4',
      completionSignalSeen: false,
      failureCode: null,
      failureMessage: null,
      createdByUserId: null,
      startedAt: new Date('2020-01-01'),
      finishedAt: null,
      createdAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-02'),
    } as ChatPlanEntity;
    const event = { success: true, data: { eventId: 'e1', kind: 'toolCall', payload: {}, timestamp: '2020-01-02' } };

    planRepo.findOne.mockResolvedValue(plan);
    service.addLiveEvent(plan.id, event);
    await service.emitLiveUpdateByPlanId(plan.id);

    const payload = (chatRealtime.emitToClient as jest.Mock).mock.calls[0][1] as {
      timelineEvents: Array<{ payload: unknown; timestamp: number }>;
    };

    expect(payload.timelineEvents).toEqual([{ payload: event, timestamp: 1234 }]);
    dateNowSpy.mockRestore();
  });

  it('does not offer execution for plans with draft content awaiting agent completion', async () => {
    const plan = {
      id: 'p1',
      clientId: 'c1',
      agentId: 'a1',
      chatId: 'chat-1',
      status: ChatPlanStatus.READY,
      phase: ChatPlanPhase.DRAFT,
      sourcePrompt: 'hi',
      planMarkdown: '# Draft',
      summary: null,
      contextInjection: null,
      model: null,
      resumeSessionSuffix: '-plan-p1',
      completionSignalSeen: false,
      failureCode: null,
      failureMessage: null,
      createdByUserId: null,
      startedAt: new Date('2020-01-01'),
      finishedAt: null,
      createdAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-02'),
    } as ChatPlanEntity;

    const qb = planRepo.createQueryBuilder();

    qb.getMany.mockResolvedValue([plan]);
    const socket = { connected: true, emit: jest.fn() } as never;

    await service.hydrateForAgentClient(socket, 'c1', 'a1');
    const payload = (chatRealtime.emitToSocket as jest.Mock).mock.calls[0][1] as {
      plan: { phase: string };
      actions: Array<{ type: string }>;
    };

    expect(payload.plan.phase).toBe(ChatPlanPhase.DRAFT);
    expect(payload.actions.some((action) => action.type === 'executeChatPlan')).toBe(false);
  });
});
