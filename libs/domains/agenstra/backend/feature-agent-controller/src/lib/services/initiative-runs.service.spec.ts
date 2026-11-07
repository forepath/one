import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { createAgentContentWriter } from '../utils/agent-content-writer.utils';

import { InitiativeRunsService } from './initiative-runs.service';

const initiative = {
  id: 'ini-1',
  clientId: 'client-1',
  title: 'Checkout',
  intent: 'Faster checkout',
  path: 'epic',
  state: 'active',
  iteration: 1,
  defaultAgentId: 'agent-1',
  defaultModel: 'openai/gpt-5',
  longSha: 'a'.repeat(40),
};

/** Entity manager fake: conditional updates succeed unless `affected` is overridden; repos come from a map. */
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
          update: jest.fn(),
          count: jest.fn(async () => 0),
          exists: jest.fn(async () => false),
        },
    ),
    qb,
  };
}

describe('InitiativeRunsService', () => {
  let runRepo: Record<string, jest.Mock>;
  let turnRepo: Record<string, jest.Mock>;
  let workItems: Record<string, jest.Mock>;
  let artifacts: Record<string, jest.Mock>;
  let learn: Record<string, jest.Mock>;
  let initiatives: Record<string, jest.Mock>;
  let credentials: Record<string, jest.Mock>;
  let service: InitiativeRunsService;
  let em: ReturnType<typeof fakeEm>;
  let affected: { value: number };
  let driver: { startTurn: jest.Mock };
  let run: Record<string, unknown>;

  const emptyTree = {
    initiative,
    items: [] as Array<Record<string, unknown>>,
    dependencies: [],
    unknowns: [],
    ticketStatusByItemId: new Map(),
    statusById: new Map<string, string>(),
    dtos: [],
  };

  beforeEach(() => {
    affected = { value: 1 };
    run = {
      id: 'run-1',
      initiativeId: 'ini-1',
      clientId: 'client-1',
      step: 'prd',
      mode: 'update',
      status: 'ready',
      baseVersions: { 'art-1': 2 },
      findingIds: [],
      targetWorkItemId: null,
      result: { status: 'ready', draftMarkdown: '# PRD v3', workItems: [], findings: [], decisions: [] },
    };
    runRepo = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => run),
      count: jest.fn(async () => 0),
      exists: jest.fn(async () => false),
      update: jest.fn(),
      manager: {} as never,
    };
    em = fakeEm(new Map(), affected);
    (runRepo['manager'] as unknown) = { transaction: jest.fn(async (cb: (e: unknown) => unknown) => cb(em)) };
    turnRepo = { find: jest.fn(async () => []), findOne: jest.fn(async () => null), count: jest.fn(async () => 0) };
    workItems = {
      loadTree: jest.fn(async () => emptyTree),
      snapshot: jest.fn(async () => ({
        path: 'epic',
        hasIntent: true,
        acceptedArtifactTypes: new Set(),
        epics: [],
        openFindings: 0,
        openProposals: 0,
      })),
      emitTree: jest.fn(),
      conditionalItemUpdate: jest.fn(),
      createItems: jest.fn(async () => new Map()),
      saveUnknown: jest.fn(),
    };
    artifacts = {
      findExisting: jest.fn(async () => null),
      writeArtifact: jest.fn(async () => ({ id: 'art-1' })),
      emitArtifact: jest.fn(),
    };
    learn = {
      recordFinding: jest.fn(),
      recordDecisions: jest.fn(),
      createProposal: jest.fn(async () => ({ id: 'prop-1' })),
      setRetrospectiveVerdict: jest.fn(),
    };
    initiatives = {
      getEntityForPrincipal: jest.fn(async () => initiative),
      assertNotArchived: jest.fn(),
      assertHuman: jest.fn((principal) => {
        if (principal && (principal as Record<symbol, unknown>)[Object.getOwnPropertySymbols(principal)[0]]) {
          throw new NotFoundException('Not found in this workspace');
        }
      }),
      actorOf: jest.fn(() => ({ actorType: 'human', actorUserId: 'user-1', agentId: null, attribution: {} })),
      appendActivity: jest.fn(),
      bumpVersion: jest.fn(async () => initiative),
      lockInitiative: jest.fn(async () => undefined),
      lockWorkspaceRuns: jest.fn(async () => undefined),
      emit: jest.fn(),
      publish: jest.fn(),
    };
    credentials = { findByClientAndAgent: jest.fn(async () => ({ id: 'cred' })) };
    service = new InitiativeRunsService(
      runRepo as never,
      turnRepo as never,
      { find: jest.fn(async () => []), manager: {} } as never,
      {} as never,
      { find: jest.fn(async () => []) } as never,
      initiatives as never,
      workItems as never,
      artifacts as never,
      learn as never,
      credentials as never,
    );
    driver = { startTurn: jest.fn() };
    service.registerDriver(driver);
  });

  describe('start', () => {
    it('only runs on environments of the workspace', async () => {
      credentials['findByClientAndAgent'].mockResolvedValue(null);

      await expect(service.start('ini-1', { step: 'prd' }, undefined)).rejects.toBeInstanceOf(NotFoundException);
      expect(credentials['findByClientAndAgent']).toHaveBeenCalledWith('client-1', 'agent-1');
    });

    it('requires an epic of the initiative for epic steps and checks hard needs', async () => {
      await expect(service.start('ini-1', { step: 'refine-epic' }, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.start('ini-1', { step: 'refine-epic', workItemId: 'foreign' }, undefined)).rejects.toThrow(
        'The target must be an epic of the initiative',
      );
    });

    it('limits active runs per workspace and per target under the initiative lock', async () => {
      const { InitiativeRunEntity } = await import('../entities/initiative-run.entity');
      const repo = {
        count: jest.fn(async () => 99),
        exists: jest.fn(async () => false),
        save: jest.fn(),
        create: jest.fn(),
      };

      em = fakeEm(new Map<unknown, Record<string, jest.Mock>>([[InitiativeRunEntity, repo]]), affected);
      (runRepo['manager'] as unknown) = { transaction: jest.fn(async (cb: (e: unknown) => unknown) => cb(em)) };
      await expect(service.start('ini-1', { step: 'prd' }, undefined)).rejects.toBeInstanceOf(ConflictException);
      expect(initiatives['lockInitiative']).toHaveBeenCalledWith(em, 'ini-1');
      expect(initiatives['lockWorkspaceRuns']).toHaveBeenCalledWith(em, 'client-1');

      repo.count.mockResolvedValue(0);
      repo.exists.mockResolvedValue(true);
      await expect(service.start('ini-1', { step: 'prd' }, undefined)).rejects.toThrow('already running');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('refuses validating a document that does not exist and unsupported modes', async () => {
      await expect(service.start('ini-1', { step: 'prd', mode: 'validate' }, undefined)).rejects.toThrow(
        'no document to validate',
      );
      await expect(service.start('ini-1', { step: 'refine-epic', mode: 'validate' }, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates the run with a reserved session suffix and starts the first turn', async () => {
      const repo = {
        save: jest.fn(async (v) => ({ id: 'run-new', ...v })),
        create: jest.fn((v) => v),
        update: jest.fn(),
        count: jest.fn(async () => 0),
        exists: jest.fn(async () => false),
        findOne: jest.fn(async () => null),
      };

      em = fakeEm(
        new Map<unknown, Record<string, jest.Mock>>([
          [(await import('../entities/initiative-run.entity')).InitiativeRunEntity, repo],
        ]),
        affected,
      );
      (runRepo['manager'] as unknown) = { transaction: jest.fn(async (cb: (e: unknown) => unknown) => cb(em)) };
      runRepo['findOne'].mockResolvedValue({ ...run, id: 'run-new' });

      await service.start('ini-1', { step: 'prd', message: 'Focus on B2B' }, undefined);

      expect(repo['update']).toHaveBeenCalledWith('run-new', { resumeSessionSuffix: '-initiative-run-new' });
      expect(repo['create']).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', model: 'openai/gpt-5', mode: 'create' }),
      );
      expect(driver.startTurn).toHaveBeenCalledWith('run-new', 'Focus on B2B', true);
    });
  });

  describe('accept', () => {
    it('is human only', async () => {
      await expect(
        service.accept(
          'run-1',
          { expectedVersion: 1 },
          createAgentContentWriter('client-1', 'agent-1', 'chat') as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('writes and accepts the document when it did not move on', async () => {
      artifacts['findExisting'].mockResolvedValue({ id: 'art-1', currentVersion: 2 });

      await service.accept('run-1', { expectedVersion: 1 }, undefined);

      expect(artifacts['writeArtifact']).toHaveBeenCalledWith(
        em,
        initiative,
        expect.objectContaining({ type: 'prd', content: '# PRD v3', accept: true, source: 'run' }),
      );
      expect(learn['createProposal']).not.toHaveBeenCalled();
    });

    it('turns the result into a proposal when the document changed while the run worked', async () => {
      artifacts['findExisting'].mockResolvedValue({ id: 'art-1', currentVersion: 3 });

      await service.accept('run-1', { expectedVersion: 1 }, undefined);

      expect(artifacts['writeArtifact']).not.toHaveBeenCalled();
      expect(learn['createProposal']).toHaveBeenCalledWith(
        em,
        initiative,
        expect.objectContaining({ artifacts: [{ type: 'prd', content: '# PRD v3' }] }),
        expect.objectContaining({ origin: 'run', bumpsIteration: false }),
      );
    });

    it('refuses stale decisions (another user accepted or the run changed)', async () => {
      affected.value = 0;

      await expect(service.accept('run-1', { expectedVersion: 1 }, undefined)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(artifacts['writeArtifact']).not.toHaveBeenCalled();
    });

    it('forces a rejected retrospective while stories are unfinished', async () => {
      run = {
        ...run,
        step: 'retrospective',
        mode: 'create',
        targetWorkItemId: 'e1',
        result: {
          status: 'ready',
          draftMarkdown: '# Retro',
          verdict: 'accepted',
          workItems: [],
          findings: [],
          decisions: [{ title: 'ADR', body: '' }],
        },
      };
      runRepo['findOne'].mockResolvedValue(run);
      workItems['loadTree'].mockResolvedValue({
        ...emptyTree,
        items: [
          { id: 'e1', key: 'E1', kind: 'epic', parentId: null },
          { id: 's1', key: 'E1.S1', kind: 'story', parentId: 'e1' },
        ],
        statusById: new Map([
          ['e1', 'draft'],
          ['s1', 'in-progress'],
        ]),
      });

      await service.accept('run-1', { expectedVersion: 1 }, undefined);

      expect(learn['setRetrospectiveVerdict']).toHaveBeenCalledWith(
        em,
        initiative,
        'e1',
        'rejected',
        expect.anything(),
        false,
      );
      // Retrospective decisions are only proposed (a human accepts each one).
      expect(learn['recordDecisions']).toHaveBeenCalledWith(
        em,
        initiative,
        expect.anything(),
        [{ title: 'ADR', body: '' }],
        expect.objectContaining({ status: 'proposed' }),
      );
      expect(initiatives['publish']).toHaveBeenCalledWith(
        'initiative.retrospective.completed',
        'client-1',
        expect.objectContaining({ verdict: 'rejected' }),
      );
    });
  });

  describe('answers', () => {
    it('moves the run to working and starts a follow-up turn', async () => {
      await service.message('run-1', { message: ' Yes, B2B only ' }, undefined);

      expect(em.qb['where']).toHaveBeenCalledWith('id = :runId AND status IN (:...from)', {
        runId: 'run-1',
        from: ['needs_input', 'ready'],
      });
      expect(driver.startTurn).toHaveBeenCalledWith('run-1', 'Yes, B2B only', false);
    });

    it('refuses messages while the agent is answering', async () => {
      affected.value = 0;

      await expect(service.message('run-1', { message: 'Hello' }, undefined)).rejects.toBeInstanceOf(ConflictException);
      expect(driver.startTurn).not.toHaveBeenCalled();
    });
  });
});
