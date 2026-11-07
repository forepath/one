import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { InitiativeUnknownEntity } from '../entities/initiative-unknown.entity';
import { InitiativeWorkItemDependencyEntity } from '../entities/initiative-work-item-dependency.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeEntity } from '../entities/initiative.entity';
import { TicketStatus } from '../entities/ticket.enums';
import { createAgentContentWriter } from '../utils/agent-content-writer.utils';

import { InitiativeWorkItemsService } from './initiative-work-items.service';
import { InitiativesService } from './initiatives.service';

jest.mock('@forepath/identity/backend', () => ({
  ...jest.requireActual('@forepath/identity/backend'),
  ensureClientAccess: jest.fn(async (_clients: unknown, _users: unknown, clientId: string) => {
    if (clientId !== 'client-1') {
      const { ForbiddenException: Forbidden } = jest.requireActual('@nestjs/common');

      throw new Forbidden('You do not have access to this client');
    }

    return { isClientCreator: true };
  }),
}));

const initiative = {
  id: 'ini-1',
  clientId: 'client-1',
  title: 'Checkout',
  path: 'epic',
  state: 'active',
  iteration: 2,
  version: 7,
  prerequisiteSatisfiedAt: 'done',
} as InitiativeEntity;

function qb(affected: { value: number }) {
  const builder: Record<string, jest.Mock> = {};

  for (const method of ['update', 'set', 'where', 'andWhere']) {
    builder[method] = jest.fn(() => builder);
  }

  builder['execute'] = jest.fn(async () => ({ affected: affected.value }));

  return builder;
}

describe('InitiativesService', () => {
  const affected = { value: 1 };
  let repo: Record<string, jest.Mock>;
  let service: InitiativesService;

  beforeEach(() => {
    affected.value = 1;
    repo = {
      findOne: jest.fn(async () => initiative),
      manager: {
        createQueryBuilder: jest.fn(() => qb(affected)),
        getRepository: jest.fn(() => ({ findOne: jest.fn(async () => initiative) })),
      } as never,
    };
    service = new InitiativesService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { emitToClient: jest.fn() } as never,
    );
  });

  it('checks workspace access of users and binds agents to their workspace', async () => {
    await expect(service.getEntityForPrincipal('ini-1', { user: { id: 'u' } } as never)).resolves.toBe(initiative);
    await expect(
      service.getEntityForPrincipal('ini-1', createAgentContentWriter('client-2', 'agent-1', 'chat')),
    ).rejects.toBeInstanceOf(NotFoundException);

    repo['findOne'].mockResolvedValue({ ...initiative, clientId: 'client-2' });
    await expect(service.getEntityForPrincipal('ini-1', { user: { id: 'u' } } as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    repo['findOne'].mockResolvedValue(null);
    await expect(service.getEntityForPrincipal('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bumps versions conditionally (409 when stale)', async () => {
    await expect(service.bumpVersion('ini-1', 7)).resolves.toBe(initiative);

    affected.value = 0;
    await expect(service.bumpVersion('ini-1', 6)).rejects.toBeInstanceOf(ConflictException);
  });

  it('records agents as AI actors and never lets them take human decisions', () => {
    const writer = createAgentContentWriter('client-1', 'agent-1', 'task');

    expect(service.actorOf(writer)).toEqual({
      actorType: 'ai',
      actorUserId: null,
      agentId: 'agent-1',
      attribution: { agentId: 'agent-1', via: 'task' },
    });
    expect(() => service.assertHuman(writer)).toThrow(NotFoundException);
    expect(() => service.assertHuman({ user: { id: 'u' } } as never)).not.toThrow();
  });

  it('sends live activity with the actor e-mail, like the REST list', async () => {
    const realtime = { emitToClient: jest.fn() };
    const activityRepo = {
      save: jest.fn(async (row) => ({ id: 'act-1', occurredAt: new Date('2026-11-07T10:00:00Z'), ...row })),
      create: jest.fn((row) => row),
    };
    const em = {
      queryRunner: undefined,
      getRepository: jest.fn((entity) =>
        entity === InitiativeEntity ? { findOne: jest.fn(async () => initiative) } : activityRepo,
      ),
    };
    const users = { findById: jest.fn(async () => ({ id: 'user-1', email: 'a@example.test' })) };
    const live = new InitiativesService(
      repo as never,
      { manager: em } as never,
      {} as never,
      {} as never,
      users as never,
      realtime as never,
    );

    await live.appendActivity(
      'ini-1',
      'CREATED' as never,
      { actorType: 'human', actorUserId: 'user-1', agentId: null, attribution: {} } as never,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(realtime.emitToClient).toHaveBeenCalledWith(
      'client-1',
      'initiativeActivityCreated',
      expect.objectContaining({ actorUserId: 'user-1', actorEmail: 'a@example.test' }),
    );
  });
});

describe('InitiativeWorkItemsService', () => {
  const affected = { value: 1 };
  let items: Array<Partial<InitiativeWorkItemEntity>>;
  let dependencies: Array<Partial<InitiativeWorkItemDependencyEntity>>;
  let saved: Array<Partial<InitiativeWorkItemEntity>>;
  let em: Record<string, jest.Mock>;
  let initiatives: Record<string, jest.Mock>;
  let tickets: Record<string, jest.Mock>;
  let ticketRepo: Record<string, jest.Mock>;
  let service: InitiativeWorkItemsService;

  beforeEach(() => {
    affected.value = 1;
    saved = [];
    items = [
      {
        id: 'e1',
        initiativeId: 'ini-1',
        key: 'E1',
        kind: 'epic',
        parentId: null,
        sortOrder: 0,
        status: 'draft',
        version: 1,
      },
      {
        id: 's1',
        initiativeId: 'ini-1',
        key: 'E1.S1',
        kind: 'story',
        parentId: 'e1',
        sortOrder: 0,
        status: 'draft',
        version: 1,
        ticketId: 't1',
      },
    ];
    dependencies = [];
    const repos = new Map<unknown, Record<string, jest.Mock>>([
      [
        InitiativeWorkItemEntity,
        {
          find: jest.fn(async () => items),
          save: jest.fn(async (row: Partial<InitiativeWorkItemEntity>) => {
            const created = { id: `new-${saved.length}`, ...row };

            saved.push(created);

            return created;
          }),
          create: jest.fn((row) => row),
        },
      ],
      [
        InitiativeWorkItemDependencyEntity,
        { find: jest.fn(async () => dependencies), save: jest.fn(), create: jest.fn((row) => row), delete: jest.fn() },
      ],
      [InitiativeUnknownEntity, { save: jest.fn(async (row) => row), create: jest.fn((row) => row) }],
    ]);

    em = {
      getRepository: jest.fn((entity) => repos.get(entity)),
      createQueryBuilder: jest.fn(() => qb(affected)),
      transaction: jest.fn(async (cb: (e: unknown) => unknown) => cb(em)),
    };
    initiatives = {
      getEntityForPrincipal: jest.fn(async () => initiative),
      getEntityOrThrow: jest.fn(async () => initiative),
      bumpVersion: jest.fn(async () => initiative),
      appendActivity: jest.fn(),
      actorOf: jest.fn(() => ({ actorType: 'human', actorUserId: 'u', agentId: null, attribution: {} })),
      assertHuman: jest.fn(),
      assertNotArchived: jest.fn(),
      lockInitiative: jest.fn(async () => undefined),
      emit: jest.fn(),
      emitInitiative: jest.fn(),
    };
    tickets = { update: jest.fn() };
    ticketRepo = {
      findOne: jest.fn(async () => ({ id: 't1', status: TicketStatus.PROTOTYPE })),
      exists: jest.fn(async () => true),
      find: jest.fn(async () => []),
    };
    const itemRepo = {
      findOne: jest.fn(async ({ where }) => items.find((row) => row.id === where.id) ?? null),
      manager: em,
      find: jest.fn(async () => items),
      exists: jest.fn(),
    };

    service = new InitiativeWorkItemsService(
      itemRepo as never,
      {} as never,
      {} as never,
      ticketRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      initiatives as never,
      tickets as never,
    );
    jest
      .spyOn(service, 'emitTree')
      .mockResolvedValue({ initiativeId: 'ini-1', items: [], initiativeVersion: 7, unknowns: [] });
  });

  it('allocates stable keys and resolves placeholder dependencies', async () => {
    const created = await service.createItems(
      em as never,
      initiative,
      [
        { key: 'N1', kind: 'story', title: 'A', after: ['E1.S1'], unknowns: [{ question: 'Q?', resolution: 'spike' }] },
        { key: 'N2', kind: 'spike', title: 'B', after: ['N1'], unknowns: [] },
      ],
      'e1',
      { actorType: 'human', actorUserId: 'u', agentId: null, attribution: {} } as never,
    );

    expect([...created.values()].map((row) => row.key)).toEqual(['E1.S2', 'E1.S3']);
    expect(saved[0]).toMatchObject({ iterationCreated: 2, clientId: 'client-1', parentId: 'e1' });

    const depRepo = em['getRepository'](InitiativeWorkItemDependencyEntity);

    expect(depRepo['save']).toHaveBeenCalledWith([
      expect.objectContaining({ workItemId: 'new-0', prerequisiteId: 's1', initiativeId: 'ini-1' }),
      expect.objectContaining({ workItemId: 'new-1', prerequisiteId: 'new-0' }),
    ]);
  });

  it('refuses stories without an epic and epics with a parent', async () => {
    await expect(
      service.createItems(
        em as never,
        initiative,
        [{ key: 'N1', kind: 'story', title: 'A', after: [], unknowns: [] }],
        null,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createItems(
        em as never,
        initiative,
        [{ key: 'N1', kind: 'epic', title: 'A', after: [], unknowns: [] }],
        's1',
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses dependency cycles and prerequisites of other initiatives', async () => {
    dependencies = [{ workItemId: 's1', prerequisiteId: 'e1', initiativeId: 'ini-1' }];
    em['getRepository'](InitiativeWorkItemEntity)['find'].mockImplementation(
      async ({ where }: { where: { id?: unknown } }) => (where.id ? [items[1]] : items),
    );

    await expect(service.replaceDependencies(em as never, initiative, items[0] as never, ['s1'])).rejects.toThrow(
      'cycle',
    );

    em['getRepository'](InitiativeWorkItemEntity)['find'].mockResolvedValue([]);
    await expect(service.replaceDependencies(em as never, initiative, items[0] as never, ['foreign'])).rejects.toThrow(
      'same initiative',
    );
  });

  it('never rewrites the content of built or done items', async () => {
    await expect(
      service.update('s1', { expectedVersion: 1, requirements: 'changed' }, undefined),
    ).rejects.toBeInstanceOf(ConflictException);

    // Checkpoints may still change (not content).
    await service.update('s1', { expectedVersion: 1, doneCheckpoint: true }, undefined);
    expect(initiatives['appendActivity']).toHaveBeenCalled();
  });

  it('changes the linked ticket when a human marks a transferred story done', async () => {
    await service.setStatus('s1', { status: 'done' }, { user: { id: 'u' } } as never);

    expect(tickets['update']).toHaveBeenCalledWith('t1', { status: TicketStatus.DONE }, { user: { id: 'u' } });
    await expect(service.setStatus('s1', { status: 'blocked' }, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });
});
