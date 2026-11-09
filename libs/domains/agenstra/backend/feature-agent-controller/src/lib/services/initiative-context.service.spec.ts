import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { createAgentContentWriter } from '../utils/agent-content-writer.utils';

import { InitiativeContextService, type InitiativeAgentChange } from './initiative-context.service';

const INITIATIVE_SHA = 'a'.repeat(40);

function queryBuilder(rows: unknown[]) {
  const qb: Record<string, jest.Mock> = {};

  for (const method of ['where', 'andWhere', 'orderBy', 'take']) {
    qb[method] = jest.fn(() => qb);
  }

  qb['getMany'] = jest.fn(async () => rows);

  return qb;
}

describe('InitiativeContextService', () => {
  const initiative = {
    id: 'ini-1',
    clientId: 'client-1',
    title: 'Checkout',
    intent: 'Faster checkout',
    path: 'epic',
    phase: 'plan',
    state: 'active',
    iteration: 1,
    prerequisiteSatisfiedAt: 'done',
    version: 4,
    longSha: INITIATIVE_SHA,
    updatedAt: new Date(),
  };
  let initiativeRepo: Record<string, jest.Mock>;
  let artifactRepo: Record<string, jest.Mock>;
  let itemRepo: Record<string, jest.Mock>;
  let learn: { createProposal: jest.Mock; recordFinding: jest.Mock };
  let service: InitiativeContextService;
  let lastInitiativeQuery: ReturnType<typeof queryBuilder>;

  beforeEach(() => {
    lastInitiativeQuery = queryBuilder([initiative]);
    initiativeRepo = {
      findOne: jest.fn(async ({ where }) =>
        where.clientId === 'client-1' && (where.longSha === INITIATIVE_SHA || where.id === 'ini-1') ? initiative : null,
      ),
      find: jest.fn(async () => [initiative]),
      createQueryBuilder: jest.fn(() => lastInitiativeQuery),
      manager: { transaction: jest.fn(async (cb: (em: unknown) => unknown) => cb({})) } as never,
    } as unknown as Record<string, jest.Mock>;
    artifactRepo = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(() => queryBuilder([])),
    };
    itemRepo = { findOne: jest.fn(async () => null) };
    learn = { createProposal: jest.fn(async () => ({ id: 'p1' })), recordFinding: jest.fn(async () => ({ id: 'f1' })) };
    service = new InitiativeContextService(
      initiativeRepo as never,
      artifactRepo as never,
      { findOne: jest.fn() } as never,
      itemRepo as never,
      { find: jest.fn(async () => []) } as never,
      { count: jest.fn(async () => 0) } as never,
      { find: jest.fn(async () => []) } as never,
      {
        actorOf: jest.fn(() => ({ actorType: 'ai', actorUserId: null, agentId: 'agent-1', attribution: {} })),
      } as never,
      {
        loadTree: jest.fn(async () => ({
          initiative,
          items: [],
          dependencies: [],
          unknowns: [],
          ticketStatusByItemId: new Map(),
          statusById: new Map(),
          dtos: [],
        })),
      } as never,
      learn as never,
    );
  });

  it('searches initiatives within the workspace of the connection only', async () => {
    const results = await service.search('client-1', 'check', ['initiative'], 10);

    expect(lastInitiativeQuery['where']).toHaveBeenCalledWith('i.client_id = :clientId', { clientId: 'client-1' });
    expect(results).toEqual([expect.objectContaining({ kind: 'initiative', sha: INITIATIVE_SHA, title: 'Checkout' })]);
  });

  it('serves the overview with the version as revision and nothing for other workspaces', async () => {
    const [content] = await service.content('client-1', [{ kind: 'initiative', sha: INITIATIVE_SHA }]);

    expect(content.revision).toBe('4');
    expect(content.content).toContain('# Initiative: Checkout');
    expect(content.content).toContain('Faster checkout');
    expect(await service.content('client-2', [{ kind: 'initiative', sha: INITIATIVE_SHA }])).toEqual([]);
  });

  describe('agent changes', () => {
    const writer = createAgentContentWriter('client-1', 'agent-1', 'chat');

    it('stores proposals as open proposals (never applied by the agent)', async () => {
      const change: InitiativeAgentChange = {
        operation: 'initiative.propose',
        sha: INITIATIVE_SHA,
        title: 'Add SSO',
        workItems: [{ op: 'add', parentKey: 'E1', item: { key: 'N1', title: 'SSO' } }],
      };
      const result = await service.applyAgentChange(writer, change);

      expect(result).toEqual({ kind: 'initiative', sha: INITIATIVE_SHA, title: 'Checkout', revision: '4' });
      expect(learn.createProposal).toHaveBeenCalledWith(
        expect.anything(),
        initiative,
        expect.objectContaining({ title: 'Add SSO' }),
        expect.objectContaining({ origin: 'chat' }),
      );
    });

    it('refuses empty proposals, unknown items and foreign workspaces', async () => {
      await expect(
        service.applyAgentChange(writer, {
          operation: 'initiative.propose',
          sha: INITIATIVE_SHA,
          title: 'x',
          workItems: [{ op: 'nope' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.applyAgentChange(writer, {
          operation: 'initiative.finding',
          sha: INITIATIVE_SHA,
          body: 'x',
          itemKey: 'E9.S9',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.applyAgentChange(createAgentContentWriter('client-2', 'agent-1', 'chat'), {
          operation: 'initiative.finding',
          sha: INITIATIVE_SHA,
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('records findings with the session as source', async () => {
      await service.applyAgentChange(createAgentContentWriter('client-1', 'agent-1', 'task'), {
        operation: 'initiative.finding',
        sha: INITIATIVE_SHA,
        body: 'Rate limits missing',
        severity: 'major',
      });

      expect(learn.recordFinding).toHaveBeenCalledWith(
        expect.anything(),
        initiative,
        expect.anything(),
        expect.objectContaining({ source: 'task', severity: 'major', workItemId: null }),
      );
    });
  });

  describe('automation findings', () => {
    it('only allows findings on the story of the running ticket', async () => {
      itemRepo['findOne'].mockResolvedValue({ id: 'item-1', key: 'E1.S2', initiativeId: 'ini-1' });

      const change: InitiativeAgentChange = { operation: 'initiative.finding', sha: INITIATIVE_SHA, body: 'Deferred' };

      await service.assertAutomationFinding('client-1', 'ticket-1', change);
      expect(change.itemKey).toBe('E1.S2');

      await expect(
        service.assertAutomationFinding('client-1', 'ticket-1', { ...change, itemKey: 'E1.S3' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.assertAutomationFinding('client-1', 'ticket-1', { ...change, sha: 'b'.repeat(40) }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.assertAutomationFinding('client-1', 'ticket-1', {
          operation: 'initiative.propose',
          sha: INITIATIVE_SHA,
          title: 'x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses tickets that are not linked to a story', async () => {
      await expect(
        service.assertAutomationFinding('client-1', 'ticket-9', {
          operation: 'initiative.finding',
          sha: INITIATIVE_SHA,
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
