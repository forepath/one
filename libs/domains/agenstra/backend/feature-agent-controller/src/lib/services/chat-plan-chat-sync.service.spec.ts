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
    };

    expect(payload.hydrate).toBe(true);
    expect(payload.plan.id).toBe('p1');
    expect(payload.plan.chatId).toBe('chat-1');
  });
});
