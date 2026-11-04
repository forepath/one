import { ClientUsersRepository } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ChatPlanEntity } from '../entities/chat-plan.entity';
import { ChatPlanActionType, ChatPlanActorType, ChatPlanPhase, ChatPlanStatus } from '../entities/chat-plan.enums';
import { ClientsRepository } from '../repositories/clients.repository';

import { createAgentContentWriter } from '../utils/agent-content-writer.utils';
import { buildChatPlanContextSection } from '../utils/chat-plan-mappers';

import { ChatPlanActivityService } from './chat-plan-activity.service';
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
  const updateQb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };
  const listQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };
  const planRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    createQueryBuilder: jest.fn((alias?: string) => (alias ? listQb : updateQb)),
  };
  const chatPlanChatSync = { emitLiveUpdateFromEntity: jest.fn() };
  const chatPlanActivity = { append: jest.fn().mockResolvedValue(undefined), list: jest.fn() };
  const updatedAt = new Date('2026-11-01T10:00:00.123Z');
  const readyPlan = (overrides: Partial<ChatPlanEntity> = {}): ChatPlanEntity =>
    ({
      id: 'p1',
      clientId: 'c1',
      agentId: 'a1',
      chatId: 'chat-1',
      status: ChatPlanStatus.READY,
      phase: ChatPlanPhase.READY,
      sourcePrompt: 'hello',
      planMarkdown: '# Plan',
      summary: 'Old title',
      resumeSessionSuffix: '-plan-p1',
      completionSignalSeen: true,
      executionStartedAt: null,
      lastEditedAt: null,
      startedAt: updatedAt,
      createdAt: updatedAt,
      updatedAt,
      ...overrides,
    }) as ChatPlanEntity;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatPlanService,
        { provide: getRepositoryToken(ChatPlanEntity), useValue: planRepo },
        { provide: ClientsRepository, useValue: {} },
        { provide: ClientUsersRepository, useValue: {} },
        { provide: ChatPlanChatSyncService, useValue: chatPlanChatSync },
        { provide: ChatPlanActivityService, useValue: chatPlanActivity },
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
    expect(dto.editable).toBe(true);
    expect(dto.executionStartedAt).toBeNull();
  });

  it('mapPlan marks executed and drafting plans read-only', () => {
    expect(service.mapPlan(readyPlan({ executionStartedAt: new Date() })).editable).toBe(false);
    expect(
      service.mapPlan(readyPlan({ status: ChatPlanStatus.EXECUTED, executionStartedAt: new Date() })).editable,
    ).toBe(false);
    expect(service.mapPlan(readyPlan({ status: ChatPlanStatus.REFINING })).editable).toBe(false);
    // Cancelled / failed before execution: still editable.
    expect(service.mapPlan(readyPlan({ status: ChatPlanStatus.CANCELLED })).editable).toBe(true);
    expect(service.mapPlan(readyPlan({ status: ChatPlanStatus.FAILED })).editable).toBe(true);
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
    expect(chatPlanActivity.append).toHaveBeenCalledWith(
      'plan-uuid',
      ChatPlanActionType.CREATED,
      { type: ChatPlanActorType.HUMAN, userId: 'user-1' },
      { chatId: 'chat-1' },
    );
  });

  it('get throws when plan missing', async () => {
    planRepo.findOne.mockResolvedValue(null);
    await expect(service.get('c1', 'a1', 'missing')).rejects.toThrow(NotFoundException);
  });

  describe('update', () => {
    it('saves the edited markdown conditionally on the edited version and logs the edit', async () => {
      planRepo.findOne.mockResolvedValueOnce(readyPlan());
      planRepo.findOne.mockResolvedValueOnce(
        readyPlan({ planMarkdown: '# New plan', summary: 'New title', lastEditedAt: new Date() }),
      );
      updateQb.execute.mockResolvedValue({ affected: 1 });

      const dto = await service.update('c1', 'a1', 'p1', {
        planMarkdown: '# New plan',
        summary: ' New title ',
        expectedUpdatedAt: updatedAt.toISOString(),
      });

      expect(updateQb.set).toHaveBeenCalledWith(
        expect.objectContaining({ planMarkdown: '# New plan', summary: 'New title', lastEditedByUserId: 'user-1' }),
      );
      expect(updateQb.andWhere).toHaveBeenCalledWith('execution_started_at IS NULL');
      expect(updateQb.andWhere).toHaveBeenCalledWith('status IN (:...statuses)', {
        statuses: [ChatPlanStatus.READY, ChatPlanStatus.FAILED, ChatPlanStatus.CANCELLED],
      });
      expect(updateQb.andWhere).toHaveBeenCalledWith("date_trunc('milliseconds', updated_at) = :expected", {
        expected: updatedAt,
      });
      expect(chatPlanActivity.append).toHaveBeenCalledWith(
        'p1',
        ChatPlanActionType.CONTENT_UPDATED,
        { type: ChatPlanActorType.HUMAN, userId: 'user-1' },
        { fields: ['planMarkdown', 'summary'] },
      );
      expect(chatPlanChatSync.emitLiveUpdateFromEntity).toHaveBeenCalled();
      expect(dto.planMarkdown).toBe('# New plan');
    });

    it('refuses edits once the plan entered execution', async () => {
      planRepo.findOne.mockResolvedValue(
        readyPlan({ status: ChatPlanStatus.EXECUTED, executionStartedAt: new Date() }),
      );

      await expect(
        service.update('c1', 'a1', 'p1', { planMarkdown: '# x', expectedUpdatedAt: updatedAt.toISOString() }),
      ).rejects.toThrow('This plan has been executed and is read-only.');
      expect(updateQb.execute).not.toHaveBeenCalled();
    });

    it('refuses edits while the agent drafts the plan', async () => {
      planRepo.findOne.mockResolvedValue(readyPlan({ status: ChatPlanStatus.REFINING }));

      await expect(
        service.update('c1', 'a1', 'p1', { planMarkdown: '# x', expectedUpdatedAt: updatedAt.toISOString() }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a stale version', async () => {
      planRepo.findOne.mockResolvedValue(readyPlan());

      await expect(
        service.update('c1', 'a1', 'p1', {
          planMarkdown: '# x',
          expectedUpdatedAt: '2026-11-01T09:00:00.000Z',
        }),
      ).rejects.toThrow('The plan changed since you opened it; reload it before saving.');
      expect(updateQb.execute).not.toHaveBeenCalled();
    });

    it('reports execution that started between the read and the conditional write', async () => {
      planRepo.findOne
        .mockResolvedValueOnce(readyPlan())
        .mockResolvedValueOnce(readyPlan({ status: ChatPlanStatus.EXECUTING, executionStartedAt: new Date() }));
      updateQb.execute.mockResolvedValue({ affected: 0 });

      await expect(
        service.update('c1', 'a1', 'p1', { planMarkdown: '# x', expectedUpdatedAt: updatedAt.toISOString() }),
      ).rejects.toThrow('This plan has been executed and is read-only.');
      expect(chatPlanActivity.append).not.toHaveBeenCalled();
    });

    it('rejects an empty plan body', async () => {
      planRepo.findOne.mockResolvedValue(readyPlan());

      await expect(
        service.update('c1', 'a1', 'p1', { planMarkdown: '   ', expectedUpdatedAt: updatedAt.toISOString() }),
      ).rejects.toThrow(BadRequestException);
    });

    it('is a no-op without changes', async () => {
      planRepo.findOne.mockResolvedValue(readyPlan());

      const dto = await service.update('c1', 'a1', 'p1', {
        planMarkdown: '# Plan',
        summary: 'Old title',
        expectedUpdatedAt: updatedAt.toISOString(),
      });

      expect(dto.id).toBe('p1');
      expect(updateQb.execute).not.toHaveBeenCalled();
      expect(chatPlanActivity.append).not.toHaveBeenCalled();
    });
  });

  describe('listForAgent', () => {
    it('searches title, request and body with escaped wildcards and pages newest first', async () => {
      listQb.getManyAndCount.mockResolvedValue([[readyPlan()], 7]);

      const result = await service.listForAgent('c1', 'a1', { search: ' 50%_off ', limit: 10, offset: 20 });

      expect(planRepo.createQueryBuilder).toHaveBeenCalledWith('p');
      expect(listQb.andWhere).toHaveBeenCalledWith(expect.stringContaining('p.plan_markdown ILIKE :pattern'), {
        pattern: '%50\\%\\_off%',
      });
      expect(listQb.orderBy).toHaveBeenCalledWith('p.started_at', 'DESC');
      expect(listQb.take).toHaveBeenCalledWith(10);
      expect(listQb.skip).toHaveBeenCalledWith(20);
      expect(result.total).toBe(7);
      expect(result.items[0].id).toBe('p1');
    });

    it('filters editable plans and caps the page size', async () => {
      listQb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.listForAgent('c1', 'a1', { state: 'editable', limit: 10_000 });

      expect(listQb.andWhere).toHaveBeenCalledWith('p.execution_started_at IS NULL');
      expect(listQb.take).toHaveBeenCalledWith(100);
    });

    it('filters read-only plans', async () => {
      listQb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.listForAgent('c1', 'a1', { state: 'readonly' });

      expect(listQb.andWhere).toHaveBeenCalledWith(
        '(p.execution_started_at IS NOT NULL OR p.status NOT IN (:...editable))',
        expect.anything(),
      );
    });
  });

  it('listActivity requires the plan to belong to the agent', async () => {
    planRepo.findOne.mockResolvedValue(null);

    await expect(service.listActivity('c1', 'a1', 'p1', {})).rejects.toThrow(NotFoundException);
    expect(chatPlanActivity.list).not.toHaveBeenCalled();
  });

  it('cancel logs the cancellation', async () => {
    planRepo.findOne.mockResolvedValue(readyPlan({ status: ChatPlanStatus.EXPLORING }));
    planRepo.save.mockImplementation(async (row: ChatPlanEntity) => row);

    await service.cancel('c1', 'a1', 'p1', undefined, 'user-2');

    expect(chatPlanActivity.append).toHaveBeenCalledWith(
      'p1',
      ChatPlanActionType.CANCELLED,
      { type: ChatPlanActorType.HUMAN, userId: 'user-2' },
      {},
    );
  });

  describe('plans as context', () => {
    const LONG = 'a'.repeat(40);

    it('create derives the plan SHA (sha1 of the id) for plan:<sha> refs', async () => {
      planRepo.findOne.mockResolvedValue(null);
      planRepo.save.mockImplementation(async (row: ChatPlanEntity) => ({
        ...row,
        id: row.id ?? '11111111-1111-4111-8111-111111111111',
        createdAt: updatedAt,
        updatedAt,
      }));

      const dto = await service.create({ clientId: 'c1', agentId: 'a1', chatId: 'chat-1', message: 'plan this' });

      expect(dto.shas?.long).toBe(ChatPlanEntity.deriveLongSha('11111111-1111-4111-8111-111111111111'));
      expect(dto.shas?.short).toBe(dto.shas?.long.slice(0, 7));
    });

    it('findForAgentBySha resolves full SHAs within the environment and unique short SHAs only', async () => {
      planRepo.findOne.mockResolvedValue(readyPlan({ longSha: LONG }));
      await expect(service.findForAgentBySha('c1', 'a1', LONG.toUpperCase())).resolves.toMatchObject({ id: 'p1' });
      expect(planRepo.findOne).toHaveBeenCalledWith({ where: { clientId: 'c1', agentId: 'a1', longSha: LONG } });

      const shortQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([readyPlan(), readyPlan({ id: 'p2' })]),
      };

      planRepo.createQueryBuilder.mockReturnValueOnce(shortQb as never);
      await expect(service.findForAgentBySha('c1', 'a1', 'aaaa')).resolves.toBeNull();
      expect(shortQb.andWhere).toHaveBeenCalledWith('p.agent_id = :agentId', { agentId: 'a1' });
      await expect(service.findForAgentBySha('c1', 'a1', 'not-a-sha')).resolves.toBeNull();
    });

    it('collectPromptContextsByShas returns sections and refs of this environment only, deduplicated', async () => {
      planRepo.findOne
        .mockResolvedValueOnce(readyPlan({ longSha: LONG }))
        .mockResolvedValueOnce(readyPlan({ longSha: LONG }))
        .mockResolvedValueOnce(null);

      const result = await service.collectPromptContextsByShas('c1', 'a1', [LONG, LONG, 'b'.repeat(40)]);

      expect(result.refs).toEqual([{ sha: LONG, title: 'Old title' }]);
      expect(result.promptSections).toHaveLength(1);
      expect(result.promptSections[0]).toContain('Chat Plan: Old title');
      expect(result.promptSections[0]).toContain('not executed; editable');
    });

    it('updateForAgent applies the same conditional edit, recorded as the agent', async () => {
      planRepo.findOne
        .mockResolvedValueOnce(readyPlan({ longSha: LONG }))
        .mockResolvedValueOnce(readyPlan({ longSha: LONG, planMarkdown: '# By agent' }));
      updateQb.execute.mockResolvedValue({ affected: 1 });

      const writer = createAgentContentWriter('c1', 'a1', 'chat');
      const saved = await service.updateForAgent(writer, LONG, {
        revision: updatedAt.toISOString(),
        content: '# By agent',
      });

      expect(saved.planMarkdown).toBe('# By agent');
      expect(updateQb.set).toHaveBeenCalledWith(expect.objectContaining({ lastEditedByUserId: null }));
      expect(updateQb.andWhere).toHaveBeenCalledWith('execution_started_at IS NULL');
      expect(chatPlanActivity.append).toHaveBeenCalledWith(
        'p1',
        ChatPlanActionType.CONTENT_UPDATED,
        { type: ChatPlanActorType.AI },
        { fields: ['planMarkdown'], agentId: 'a1', via: 'chat' },
      );
    });

    it('updateForAgent refuses executed plans (read-only) like user edits', async () => {
      planRepo.findOne.mockResolvedValue(
        readyPlan({ longSha: LONG, status: ChatPlanStatus.EXECUTED, executionStartedAt: new Date() }),
      );

      await expect(
        service.updateForAgent(createAgentContentWriter('c1', 'a1', 'chat'), LONG, {
          revision: updatedAt.toISOString(),
          content: '# x',
        }),
      ).rejects.toThrow('This plan has been executed and is read-only.');
      expect(updateQb.execute).not.toHaveBeenCalled();
    });

    it('context sections state execution (read-only) and include request and body', () => {
      const section = buildChatPlanContextSection(
        readyPlan({ longSha: LONG, status: ChatPlanStatus.EXECUTED, executionStartedAt: new Date() }),
      );

      expect(section).toContain(`Ref: plan:${LONG.slice(0, 7)}`);
      expect(section).toContain('execution started; read-only');
      expect(section).toContain('Original request:\nhello');
      expect(section).toContain('Plan:\n# Plan');
    });
  });
});
