import { ClientUsersRepository } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatPlanEntity } from '../entities/chat-plan.entity';
import { ChatPlanPhase, ChatPlanStatus } from '../entities/chat-plan.enums';
import { ClientsRepository } from '../repositories/clients.repository';

import { ChatPlanChatSyncService } from './chat-plan-chat-sync.service';
import { ChatPlanService } from './chat-plan.service';

jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return {
    ...actual,
    ensureClientAccess: jest.fn().mockResolvedValue(undefined),
    getUserFromRequest: jest.fn().mockReturnValue({ userId: 'user-1', userRole: 'admin', isApiKeyAuth: false }),
  };
});

describe('ChatPlanService', () => {
  let service: ChatPlanService;
  const planRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
  };
  const chatPlanChatSync = { emitLiveUpdateFromEntity: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatPlanService,
        { provide: getRepositoryToken(ChatPlanEntity), useValue: planRepo },
        { provide: ClientsRepository, useValue: {} },
        { provide: ClientUsersRepository, useValue: {} },
        { provide: ChatPlanChatSyncService, useValue: chatPlanChatSync },
      ],
    }).compile();

    service = module.get(ChatPlanService);
  });

  it('mapPlan maps entity fields to DTO', () => {
    const now = new Date('2020-01-01');
    const dto = service.mapPlan({
      id: 'p1',
      clientId: 'c1',
      agentId: 'a1',
      chatId: 'chat-1',
      status: ChatPlanStatus.READY,
      phase: ChatPlanPhase.READY,
      sourcePrompt: 'hello',
      planMarkdown: '# Plan',
      summary: 'sum',
      contextInjection: { includeWorkspace: true },
      model: 'openai/gpt',
      resumeSessionSuffix: '-plan-p1',
      completionSignalSeen: true,
      failureCode: null,
      failureMessage: null,
      createdByUserId: 'user-1',
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    } as ChatPlanEntity);

    expect(dto.id).toBe('p1');
    expect(dto.chatId).toBe('chat-1');
    expect(dto.status).toBe(ChatPlanStatus.READY);
    expect(dto.planMarkdown).toBe('# Plan');
    expect(dto.completionSignalSeen).toBe(true);
  });

  it('create rejects when an active exploring plan exists', async () => {
    planRepo.findOne.mockResolvedValue({
      id: 'existing',
      status: ChatPlanStatus.EXPLORING,
    });

    await expect(
      service.create({
        clientId: 'c1',
        agentId: 'a1',
        chatId: 'chat-1',
        message: 'plan this',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create inserts exploring plan with -plan-{id} suffix', async () => {
    planRepo.findOne.mockResolvedValue(null);
    planRepo.save.mockImplementation(async (row: ChatPlanEntity) => {
      if (!row.id) {
        return { ...row, id: 'plan-uuid', createdAt: new Date(), updatedAt: new Date() };
      }

      return { ...row, createdAt: new Date(), updatedAt: new Date() };
    });

    const dto = await service.create({
      clientId: 'c1',
      agentId: 'a1',
      chatId: 'chat-1',
      message: 'plan this',
      model: 'openai/gpt',
    });

    expect(dto.id).toBe('plan-uuid');
    expect(dto.status).toBe(ChatPlanStatus.EXPLORING);
    expect(dto.resumeSessionSuffix).toBe('-plan-plan-uuid');
    expect(chatPlanChatSync.emitLiveUpdateFromEntity).toHaveBeenCalled();
  });

  it('get throws when plan missing', async () => {
    planRepo.findOne.mockResolvedValue(null);
    await expect(service.get('c1', 'a1', 'missing')).rejects.toThrow(NotFoundException);
  });
});
