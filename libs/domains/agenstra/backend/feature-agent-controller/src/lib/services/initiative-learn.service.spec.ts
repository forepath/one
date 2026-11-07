import { ConflictException, NotFoundException } from '@nestjs/common';

import { InitiativeChangeProposalEntity } from '../entities/initiative-change-proposal.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { createAgentContentWriter } from '../utils/agent-content-writer.utils';

import { InitiativeLearnService } from './initiative-learn.service';

const initiative = { id: 'ini-1', clientId: 'client-1', title: 'Checkout', iteration: 1, longSha: 'a'.repeat(40) };

function fakeEm(repos: Map<unknown, Record<string, jest.Mock>>, affected: { value: number }) {
  const qb: Record<string, jest.Mock> = {};

  for (const method of ['update', 'set', 'where', 'andWhere']) {
    qb[method] = jest.fn(() => qb);
  }

  qb['execute'] = jest.fn(async () => ({ affected: affected.value }));

  return {
    createQueryBuilder: jest.fn(() => qb),
    getRepository: jest.fn(
      (entity: unknown) =>
        repos.get(entity) ?? {
          save: jest.fn(async (v) => ({ id: 'row', ...v })),
          create: jest.fn((v) => v),
          findOne: jest.fn(async () => null),
          find: jest.fn(async () => []),
          update: jest.fn(),
          exists: jest.fn(async () => true),
        },
    ),
  };
}

describe('InitiativeLearnService proposals', () => {
  let proposalRepo: Record<string, jest.Mock>;
  let artifacts: Record<string, jest.Mock>;
  let workItems: Record<string, jest.Mock>;
  let tickets: Record<string, jest.Mock>;
  let initiatives: Record<string, jest.Mock>;
  let service: InitiativeLearnService;
  let affected: { value: number };
  let proposal: Partial<InitiativeChangeProposalEntity>;
  let tree: Record<string, unknown>;

  beforeEach(() => {
    affected = { value: 1 };
    proposal = {
      id: 'prop-1',
      initiativeId: 'ini-1',
      title: 'Re-plan',
      status: 'open',
      bumpsIteration: true,
      baseVersions: { 'art-1': 2 },
      changes: {
        title: 'Re-plan',
        rationale: '',
        artifacts: [{ type: 'prd', content: '# v3' }],
        workItems: [],
        decisions: [],
      },
    };
    tree = {
      initiative,
      items: [{ id: 's1', key: 'E1.S1', kind: 'story', parentId: 'e1', ticketId: 't1' }],
      dependencies: [],
      unknowns: [],
      ticketStatusByItemId: new Map([['s1', 'prototype']]),
      statusById: new Map([['s1', 'built']]),
      dtos: [],
    };
    const em = fakeEm(
      new Map<unknown, Record<string, jest.Mock>>([
        [InitiativeChangeProposalEntity, { findOne: jest.fn(async () => ({ ...proposal, status: 'accepted' })) }],
        [InitiativeWorkItemEntity, { findOne: jest.fn(async () => null), exists: jest.fn(async () => true) }],
        [TicketEntity, { findOne: jest.fn(async () => null) }],
      ]),
      affected,
    );

    proposalRepo = {
      findOne: jest.fn(async () => proposal),
      update: jest.fn(),
      manager: { transaction: jest.fn(async (cb: (e: unknown) => unknown) => cb(em)) } as never,
    };
    artifacts = {
      findExisting: jest.fn(async () => ({ id: 'art-1', title: 'PRD', currentVersion: 2 })),
      writeArtifact: jest.fn(async () => ({ id: 'art-1' })),
      emitArtifact: jest.fn(),
    };
    workItems = {
      loadTree: jest.fn(async () => tree),
      emitTree: jest.fn(),
      conditionalItemUpdate: jest.fn(),
      createItems: jest.fn(async () => new Map()),
      moveBefore: jest.fn(),
      replaceDependencies: jest.fn(),
    };
    tickets = { update: jest.fn(), addComment: jest.fn() };
    initiatives = {
      getEntityForPrincipal: jest.fn(async () => initiative),
      assertHuman: jest.fn((principal) => {
        if (principal && Object.getOwnPropertySymbols(principal).length) {
          throw new NotFoundException('Not found in this workspace');
        }
      }),
      actorOf: jest.fn(() => ({ actorType: 'human', actorUserId: 'user-1', agentId: null, attribution: {} })),
      bumpVersion: jest.fn(async () => ({ ...initiative, iteration: 2 })),
      appendActivity: jest.fn(),
      emit: jest.fn(),
      publish: jest.fn(),
      userIdOf: jest.fn(() => 'user-1'),
    };
    service = new InitiativeLearnService(
      {} as never,
      proposalRepo as never,
      {} as never,
      {} as never,
      initiatives as never,
      workItems as never,
      artifacts as never,
      tickets as never,
    );
  });

  it('marks the proposal stale when a work item it rewrites was edited after it was made', async () => {
    tree['items'] = [{ id: 's2', key: 'E1.S2', kind: 'story', parentId: 'e1', ticketId: null, version: 4 }];
    tree['statusById'] = new Map([['s2', 'draft']]);
    proposal.baseVersions = { 'item:s2': 3 };
    proposal.changes = {
      title: 'Re-plan',
      rationale: '',
      artifacts: [],
      workItems: [{ op: 'update', key: 'E1.S2', title: 'New' }],
      decisions: [],
    };

    await expect(service.acceptProposal('prop-1', {}, undefined)).rejects.toThrow(
      'E1.S2 was edited after the proposal',
    );
    expect(proposalRepo['update']).toHaveBeenCalledWith({ id: 'prop-1', status: 'open' }, { status: 'stale' });
    expect(workItems['conditionalItemUpdate']).not.toHaveBeenCalled();
  });

  it('records a finding instead of failing when a ticket cannot be closed after the accept committed', async () => {
    const findingSave = jest.fn(async (v) => ({ id: 'finding-1', ...v }));
    const findingEm = fakeEm(new Map(), affected);

    (findingEm.getRepository as jest.Mock).mockImplementation(() => ({
      save: findingSave,
      create: jest.fn((v) => v),
      exists: jest.fn(async () => true),
    }));
    service = new InitiativeLearnService(
      { manager: { transaction: jest.fn(async (cb: (e: unknown) => unknown) => cb(findingEm)) } } as never,
      proposalRepo as never,
      {} as never,
      {} as never,
      initiatives as never,
      workItems as never,
      artifacts as never,
      tickets as never,
    );
    tree['items'] = [{ id: 's2', key: 'E1.S2', kind: 'story', parentId: 'e1', ticketId: 't2', version: 3 }];
    tree['ticketStatusByItemId'] = new Map([['s2', 'todo']]);
    tree['statusById'] = new Map([['s2', 'ready-for-dev']]);
    proposal.baseVersions = { 'item:s2': 3 };
    proposal.changes = {
      title: 'Re-plan',
      rationale: '',
      artifacts: [],
      workItems: [{ op: 'drop', key: 'E1.S2' }],
      decisions: [],
    };
    tickets['update'].mockRejectedValueOnce(new NotFoundException('Ticket not found'));

    await expect(service.acceptProposal('prop-1', { closeDroppedTickets: true }, undefined)).resolves.toMatchObject({
      id: 'prop-1',
    });
    expect(findingSave).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 's2',
        severity: 'major',
        body: expect.stringContaining('could not update ticket t2'),
      }),
    );
    expect(workItems['emitTree']).toHaveBeenCalledWith('ini-1');
    expect(initiatives['emit']).toHaveBeenCalled();
  });

  it('accepts as a human only', async () => {
    await expect(
      service.acceptProposal('prop-1', {}, createAgentContentWriter('client-1', 'agent-1', 'chat') as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('applies document versions as accepted and opens the next iteration', async () => {
    await service.acceptProposal('prop-1', {}, undefined);

    const bumped = initiatives['bumpVersion'].mock.calls[0][3] as { iteration: () => string; phase: string };

    // Incremented in SQL (concurrent accepts cannot write the same iteration twice).
    expect(bumped.phase).toBe('plan');
    expect(bumped.iteration()).toBe('iteration + 1');
    expect(artifacts['writeArtifact']).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ iteration: 2 }),
      expect.objectContaining({ type: 'prd', content: '# v3', accept: true, source: 'proposal', proposalId: 'prop-1' }),
    );
    expect(initiatives['publish']).toHaveBeenCalledWith(
      'initiative.proposal.decided',
      'client-1',
      expect.objectContaining({ status: 'accepted' }),
    );
  });

  it('marks a proposal stale when a changed document moved on', async () => {
    artifacts['findExisting'].mockResolvedValue({ id: 'art-1', title: 'PRD', currentVersion: 5 });

    await expect(service.acceptProposal('prop-1', {}, undefined)).rejects.toBeInstanceOf(ConflictException);
    expect(proposalRepo['update']).toHaveBeenCalledWith({ id: 'prop-1', status: 'open' }, { status: 'stale' });
  });

  it('never rewrites built or done items', async () => {
    proposal.changes = {
      title: 'x',
      rationale: '',
      artifacts: [],
      workItems: [{ op: 'update', key: 'E1.S1', requirements: 'new' }],
      decisions: [],
    };

    await expect(service.acceptProposal('prop-1', {}, undefined)).rejects.toThrow('never rewritten');
    expect(workItems['conditionalItemUpdate']).not.toHaveBeenCalled();
  });

  it('needs explicit confirmation before closing tickets of dropped stories', async () => {
    tree['statusById'] = new Map([['s1', 'ready-for-dev']]);
    tree['ticketStatusByItemId'] = new Map([['s1', 'todo']]);
    proposal.changes = {
      title: 'x',
      rationale: '',
      artifacts: [],
      workItems: [{ op: 'drop', key: 'E1.S1' }],
      decisions: [],
    };

    await expect(service.acceptProposal('prop-1', {}, undefined)).rejects.toThrow('confirm closing');

    await service.acceptProposal('prop-1', { closeDroppedTickets: true }, { user: { id: 'user-1' } } as never);
    expect(tickets['update']).toHaveBeenCalledWith('t1', { status: 'closed' }, { user: { id: 'user-1' } });
  });

  it('refuses deciding twice', async () => {
    affected.value = 0;

    await expect(service.rejectProposal('prop-1', {}, undefined)).rejects.toBeInstanceOf(ConflictException);
  });
});
