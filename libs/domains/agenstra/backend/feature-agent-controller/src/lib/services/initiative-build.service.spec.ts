import { ConflictException, NotFoundException } from '@nestjs/common';

import type { InitiativeWorkItemResponseDto } from '../dto/initiatives/initiative-response.dto';
import { TicketStatus } from '../entities/ticket.enums';

import { InitiativeBuildService } from './initiative-build.service';
import type { InitiativeTree } from './initiative-work-items.service';

const initiative = {
  id: 'ini-1',
  clientId: 'client-1',
  title: 'Checkout',
  state: 'active',
  autoRelease: false,
  iteration: 1,
  longSha: 'a'.repeat(40),
  defaultModel: null,
};

function view(overrides: Partial<InitiativeWorkItemResponseDto>): InitiativeWorkItemResponseDto {
  return {
    id: 'item',
    kind: 'story',
    key: 'E1.S1',
    status: 'draft',
    ready: true,
    blockedBy: [],
    ticketId: 'ticket',
    ticketStatus: TicketStatus.DRAFT,
    prerequisiteIds: [],
    ...overrides,
  } as InitiativeWorkItemResponseDto;
}

function tree(items: Array<Record<string, unknown>>, dtos: InitiativeWorkItemResponseDto[]): InitiativeTree {
  return {
    initiative,
    items: items.length ? items : dtos.map((d) => ({ id: d.id, ticketId: d.ticketId, automationBlocked: false })),
    dependencies: [],
    unknowns: [],
    ticketStatusByItemId: new Map(
      dtos.filter((d) => d.ticketStatus).map((d) => [d.id, d.ticketStatus as TicketStatus]),
    ),
    statusById: new Map(dtos.map((d) => [d.id, d.status])),
    dtos,
  } as unknown as InitiativeTree;
}

describe('InitiativeBuildService', () => {
  let itemRepo: Record<string, jest.Mock>;
  let ticketRepo: Record<string, jest.Mock>;
  let initiatives: Record<string, jest.Mock>;
  let workItems: Record<string, jest.Mock>;
  let ticketsService: Record<string, jest.Mock>;
  let ticketAutomation: Record<string, jest.Mock>;
  let chatPlans: Record<string, jest.Mock>;
  let planOrchestrator: Record<string, jest.Mock>;
  let credentials: Record<string, jest.Mock>;
  let ticketBoard: { onTicketChange: jest.Mock };
  let service: InitiativeBuildService;
  let currentTree: InitiativeTree;

  beforeEach(() => {
    currentTree = tree([], []);
    itemRepo = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    ticketRepo = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
    initiatives = {
      getEntityOrThrow: jest.fn(async () => initiative),
      getEntityForPrincipal: jest.fn(async () => initiative),
      assertNotArchived: jest.fn(),
      appendActivity: jest.fn(async () => ({})),
      actorOf: jest.fn(() => ({ actorType: 'human', actorUserId: 'user-1', agentId: null, attribution: {} })),
      publish: jest.fn(),
      bumpVersion: jest.fn(async () => initiative),
    };
    workItems = {
      loadTree: jest.fn(async () => currentTree),
      publishTree: jest.fn(async () => undefined),
      list: jest.fn(async () => ({
        initiativeId: 'ini-1',
        items: currentTree.dtos,
        initiativeVersion: 1,
        unknowns: [],
      })),
      getItemForPrincipal: jest.fn(),
      setTreeChangeListener: jest.fn(),
    };
    ticketsService = {
      create: jest.fn(async () => ({ id: 'new-ticket' })),
      update: jest.fn(async () => ({})),
      remove: jest.fn(async () => undefined),
      applySystemStatusChange: jest.fn(async () => true),
    };
    ticketAutomation = { patchAutomation: jest.fn(async () => ({})) };
    chatPlans = { create: jest.fn(async () => ({ id: 'plan-1' })) };
    planOrchestrator = { startExplore: jest.fn() };
    credentials = { findByClientAndAgent: jest.fn(async () => ({ id: 'cred' })) };
    ticketBoard = { onTicketChange: jest.fn(() => () => undefined) };
    service = new InitiativeBuildService(
      itemRepo as never,
      {} as never,
      ticketRepo as never,
      initiatives as never,
      workItems as never,
      {
        buildSessionContext: jest.fn(async () => ({ initiativeContexts: ['OVERVIEW'], initiativeContextRefs: [] })),
        contextForTicket: jest.fn(),
      } as never,
      ticketsService as never,
      ticketAutomation as never,
      ticketBoard as never,
      chatPlans as never,
      planOrchestrator as never,
      credentials as never,
    );
  });

  describe('ticket link', () => {
    it('refuses unknown tickets and checks workspace access before reading the link', async () => {
      initiatives['assertClientAccess'] = jest.fn(async () => undefined);
      await expect(service.linkForTicket('missing')).rejects.toBeInstanceOf(NotFoundException);

      ticketRepo['findOne'].mockResolvedValue({ id: 't1', clientId: 'client-1' });
      initiatives['assertClientAccess'].mockRejectedValueOnce(new NotFoundException('Client not found'));
      await expect(service.linkForTicket('t1')).rejects.toBeInstanceOf(NotFoundException);
      expect(itemRepo['findOne']).not.toHaveBeenCalled();
    });

    it('returns null for unlinked tickets and the derived view for linked ones', async () => {
      initiatives['assertClientAccess'] = jest.fn(async () => undefined);
      ticketRepo['findOne'].mockResolvedValue({ id: 't2', clientId: 'client-1' });
      await expect(service.linkForTicket('t2')).resolves.toEqual({ link: null });

      itemRepo['findOne'].mockResolvedValue({ id: 's2', initiativeId: 'ini-1', key: 'E1.S2', status: 'draft' });
      currentTree = tree(
        [],
        [view({ id: 's2', key: 'E1.S2', status: 'ready-for-dev', ready: false, blockedBy: ['E1.S1'] })],
      );

      await expect(service.linkForTicket('t2')).resolves.toEqual({
        link: {
          initiativeId: 'ini-1',
          initiativeTitle: 'Checkout',
          workItemId: 's2',
          key: 'E1.S2',
          status: 'ready-for-dev',
          ready: false,
          blockedBy: ['E1.S1'],
          automationBlocked: true,
        },
      });
      expect(itemRepo['findOne']).toHaveBeenCalledWith({ where: { ticketId: 't2', clientId: 'client-1' } });
    });
  });

  describe('automation gate', () => {
    it('does not block tickets that are not linked to an initiative', async () => {
      await expect(service.isTicketBlocked('ticket-x', 'client-1')).resolves.toBe(false);
    });

    it('blocks linked tickets whose prerequisites are not satisfied or that were dropped', async () => {
      itemRepo['findOne'].mockResolvedValue({ id: 's2', initiativeId: 'ini-1' });
      currentTree = tree([], [view({ id: 's2', ready: false, blockedBy: ['E1.S1'] })]);
      await expect(service.isTicketBlocked('t2', 'client-1')).resolves.toBe(true);

      currentTree = tree([], [view({ id: 's2', status: 'dropped' })]);
      await expect(service.isTicketBlocked('t2', 'client-1')).resolves.toBe(true);

      currentTree = tree([], [view({ id: 's2' })]);
      await expect(service.isTicketBlocked('t2', 'client-1')).resolves.toBe(false);
    });

    it('resyncs a stale query flag when the authoritative check finds the ticket blocked', async () => {
      itemRepo['findOne'].mockResolvedValue({ id: 's2', initiativeId: 'ini-1', automationBlocked: false });
      currentTree = tree(
        [{ id: 's2', ticketId: 't2', automationBlocked: false }],
        [view({ id: 's2', ready: false, blockedBy: ['E1.S1'] })],
      );

      await expect(service.isTicketBlocked('t2', 'client-1')).resolves.toBe(true);
      expect(itemRepo['update']).toHaveBeenCalledWith(
        { id: expect.objectContaining({ _value: ['s2'] }) },
        { automationBlocked: true },
      );
    });

    it('syncs the query flag of linked items only', async () => {
      const items = [
        { id: 's1', ticketId: 't1', automationBlocked: false },
        { id: 's2', ticketId: 't2', automationBlocked: true },
        { id: 's3', ticketId: null, automationBlocked: false },
      ];

      await service.syncAutomationGate(
        tree(items, [
          view({ id: 's1', ready: false }),
          view({ id: 's2', ready: true }),
          view({ id: 's3', ready: false, ticketId: null }),
        ]),
      );

      expect(itemRepo['update']).toHaveBeenCalledWith(
        { id: expect.objectContaining({ _value: ['s1'] }) },
        { automationBlocked: true },
      );
      expect(itemRepo['update']).toHaveBeenCalledWith(
        { id: expect.objectContaining({ _value: ['s2'] }) },
        { automationBlocked: false },
      );
      expect(itemRepo['update']).toHaveBeenCalledTimes(2);
    });
  });

  describe('release', () => {
    it('releases ready draft stories as the user and reports the others', async () => {
      currentTree = tree(
        [],
        [
          view({ id: 's1', key: 'E1.S1', ticketId: 't1' }),
          view({ id: 's2', key: 'E1.S2', ticketId: 't2', ready: false, blockedBy: ['E1.S1'] }),
          view({ id: 's3', key: 'E1.S3', ticketId: 't3', ticketStatus: TicketStatus.TODO, status: 'ready-for-dev' }),
          view({ id: 'e1', key: 'E1', kind: 'epic', ticketId: 'te' }),
        ],
      );

      const result = await service.release('ini-1', { workItemIds: ['s1', 's2', 's3'] }, { user: {} } as never);

      expect(ticketsService['update']).toHaveBeenCalledTimes(1);
      expect(ticketsService['update']).toHaveBeenCalledWith('t1', { status: TicketStatus.TODO }, expect.anything());
      expect(result.ticketIds).toEqual(['t1']);
      expect(result.skipped).toEqual([
        { workItemId: 's2', reason: 'Waiting for E1.S1' },
        { workItemId: 's3', reason: 'Already ready-for-dev' },
      ]);
    });

    it('auto-releases as a conditional system change', async () => {
      currentTree = tree([], [view({ id: 's1', ticketId: 't1' })]);
      initiatives['getEntityOrThrow'].mockResolvedValue({ ...initiative, autoRelease: true });

      await service.refresh('ini-1');

      expect(ticketsService['applySystemStatusChange']).toHaveBeenCalledWith(
        't1',
        'client-1',
        [TicketStatus.DRAFT],
        TicketStatus.TODO,
        expect.objectContaining({ source: 'initiative_auto_release' }),
      );
      expect(ticketsService['update']).not.toHaveBeenCalled();
      expect(workItems['publishTree']).toHaveBeenCalledWith('ini-1');
    });

    it('never auto-releases when the initiative did not opt in', async () => {
      currentTree = tree([], [view({ id: 's1', ticketId: 't1' })]);

      await service.refresh('ini-1');

      expect(ticketsService['applySystemStatusChange']).not.toHaveBeenCalled();
    });
  });

  describe('transfer', () => {
    const epic = {
      id: 'e1',
      key: 'E1',
      kind: 'epic',
      title: 'Accounts',
      parentId: null,
      ticketId: null,
      priority: 'medium',
      planCheckpoint: false,
    };
    const story = {
      id: 's1',
      key: 'E1.S1',
      kind: 'story',
      title: 'Login',
      parentId: 'e1',
      ticketId: null,
      priority: 'high',
      planCheckpoint: true,
    };

    beforeEach(() => {
      currentTree = tree(
        [epic, story],
        [
          view({ id: 'e1', kind: 'epic', ticketId: null, ticketStatus: null }),
          view({ id: 's1', ticketId: null, ticketStatus: null }),
        ],
      );
    });

    it('creates the epic and its stories as tickets through the ticket service and links them conditionally', async () => {
      ticketsService['create']
        .mockResolvedValueOnce({ id: 'epic-ticket' })
        .mockResolvedValueOnce({ id: 'story-ticket' });

      const result = await service.transfer('ini-1', {}, { user: {} } as never);

      expect(ticketsService['create']).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ clientId: 'client-1', title: '[E1] Accounts', status: TicketStatus.DRAFT }),
        expect.anything(),
      );
      expect(ticketsService['create']).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ parentId: 'epic-ticket', title: '[E1.S1] Login' }),
        expect.anything(),
      );
      expect(itemRepo['update']).toHaveBeenCalledWith(
        { id: 's1', ticketId: expect.anything() },
        { ticketId: 'story-ticket' },
      );
      expect(result.ticketIds).toEqual(['epic-ticket', 'story-ticket']);
      expect(initiatives['publish']).toHaveBeenCalledWith(
        'initiative.work_items.transferred',
        'client-1',
        expect.anything(),
      );
    });

    it('removes a duplicate ticket when another transfer linked the item first', async () => {
      ticketsService['create'].mockResolvedValueOnce({ id: 'epic-ticket' }).mockResolvedValueOnce({ id: 'dup-ticket' });
      itemRepo['update'].mockResolvedValueOnce({ affected: 1 }).mockResolvedValueOnce({ affected: 0 });

      const result = await service.transfer('ini-1', {}, { user: {} } as never);

      expect(ticketsService['remove']).toHaveBeenCalledWith('dup-ticket', expect.anything());
      expect(result.skipped).toEqual([{ workItemId: 's1', reason: 'Transferred by someone else meanwhile' }]);
    });

    it('configures automation only with a model and keeps the plan checkpoint as approval', async () => {
      ticketsService['create']
        .mockResolvedValueOnce({ id: 'epic-ticket' })
        .mockResolvedValueOnce({ id: 'story-ticket' });

      const withoutModel = await service.transfer('ini-1', { automation: { eligible: true } }, { user: {} } as never);

      expect(ticketAutomation['patchAutomation']).not.toHaveBeenCalled();
      expect(withoutModel.skipped[0].reason).toContain('needs a model');

      currentTree = tree(
        [epic, story],
        [
          view({ id: 'e1', kind: 'epic', ticketId: null, ticketStatus: null }),
          view({ id: 's1', ticketId: null, ticketStatus: null }),
        ],
      );
      ticketsService['create']
        .mockResolvedValueOnce({ id: 'epic-ticket' })
        .mockResolvedValueOnce({ id: 'story-ticket' });
      await service.transfer('ini-1', { automation: { eligible: true, preferredModel: 'openai/gpt-5' } }, {
        user: {},
      } as never);

      expect(ticketAutomation['patchAutomation']).toHaveBeenCalledWith(
        'story-ticket',
        { eligible: true, preferredModel: 'openai/gpt-5', requiresApproval: true },
        expect.anything(),
      );
    });
  });

  describe('ticket observer', () => {
    it('unlinks items whose ticket moved to another workspace and refreshes the initiative', async () => {
      itemRepo['find'].mockResolvedValue([
        { id: 's1', ticketId: 't1', clientId: 'client-1', initiativeId: 'ini-1', key: 'E1.S1' },
      ]);
      ticketRepo['find'].mockResolvedValue([{ id: 't1', clientId: 'client-2' }]);

      await (service as unknown as { flushTicketChanges(clientId: string): Promise<void> })['flushTicketChanges'].call(
        Object.assign(service, { pendingTicketIdsByClient: new Map([['client-2', new Set(['t1'])]]) }),
        'client-2',
      );

      expect(itemRepo['update']).toHaveBeenCalledWith(
        { id: 's1', ticketId: 't1' },
        { ticketId: null, automationBlocked: false },
      );
      expect(workItems['publishTree']).toHaveBeenCalledWith('ini-1');
    });

    it('refreshes the initiatives of the workspace after a ticket was deleted (its link is already gone)', async () => {
      const qb = {
        select: jest.fn(() => qb),
        where: jest.fn(() => qb),
        getRawMany: jest.fn(async () => [{ initiativeId: 'ini-1' }]),
      };

      itemRepo['createQueryBuilder'] = jest.fn(() => qb);
      itemRepo['find'].mockResolvedValue([]);

      service.onModuleInit();

      const registered = ticketBoard.onTicketChange.mock.calls.at(-1)?.[0] as
        | ((change: { clientId: string; ticketId: string; removed: boolean }) => void)
        | undefined;

      jest.useFakeTimers();

      try {
        registered?.({ clientId: 'client-1', ticketId: 'gone', removed: true });
        await jest.runOnlyPendingTimersAsync();
      } finally {
        jest.useRealTimers();
        service.onModuleDestroy();
      }

      expect(qb.where).toHaveBeenCalledWith('item.client_id = :clientId', { clientId: 'client-1' });
      expect(workItems['publishTree']).toHaveBeenCalledWith('ini-1');
    });
  });

  describe('plan story', () => {
    it('only plans transferred stories on environments of the workspace', async () => {
      workItems['getItemForPrincipal'].mockResolvedValue({
        item: { id: 's1', kind: 'story', ticketId: null, key: 'E1.S1' },
        initiative,
      });
      await expect(service.planStory('s1', { agentId: 'agent-1', chatId: 'chat-1' }, undefined)).rejects.toBeInstanceOf(
        ConflictException,
      );

      workItems['getItemForPrincipal'].mockResolvedValue({
        item: { id: 's1', kind: 'story', ticketId: 't1', key: 'E1.S1', title: 'Login', parentId: 'e1' },
        initiative,
      });
      ticketRepo['findOne'].mockResolvedValue({ id: 't1', longSha: 'f'.repeat(40) });
      credentials['findByClientAndAgent'].mockResolvedValueOnce(null);
      await expect(service.planStory('s1', { agentId: 'agent-x', chatId: 'chat-1' }, undefined)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      const result = await service.planStory('s1', { agentId: 'agent-1', chatId: 'chat-1' }, undefined);

      expect(chatPlans['create']).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          chatId: 'chat-1',
          contextInjection: expect.objectContaining({ ticketShas: ['f'.repeat(40)], initiativeContexts: ['OVERVIEW'] }),
        }),
        undefined,
      );
      expect(planOrchestrator['startExplore']).toHaveBeenCalledWith('plan-1');
      expect(result.planId).toBe('plan-1');
    });
  });
});
