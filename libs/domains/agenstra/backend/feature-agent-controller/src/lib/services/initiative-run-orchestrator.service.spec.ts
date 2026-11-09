import { InitiativeRunOrchestratorService } from './initiative-run-orchestrator.service';

const initiative = {
  id: 'ini-1',
  clientId: 'client-1',
  title: 'Checkout',
  path: 'epic',
  iteration: 1,
  longSha: 'a'.repeat(40),
};

describe('InitiativeRunOrchestratorService', () => {
  let run: Record<string, unknown>;
  let runRepo: Record<string, jest.Mock>;
  let runs: Record<string, jest.Mock>;
  let remote: { sendChatStreaming: jest.Mock };
  let initiatives: Record<string, jest.Mock>;
  let service: InitiativeRunOrchestratorService;

  const turn = async (message: string, firstTurn: boolean) => {
    await (service as unknown as { runTurn(id: string, m: string, f: boolean): Promise<void> })['runTurn'](
      'run-1',
      message,
      firstTurn,
    );
  };

  beforeEach(() => {
    run = {
      id: 'run-1',
      initiativeId: 'ini-1',
      clientId: 'client-1',
      agentId: 'agent-1',
      step: 'prd',
      mode: 'create',
      style: 'fast',
      status: 'working',
      model: 'openai/gpt-5',
      resumeSessionSuffix: '-initiative-run-1',
      targetWorkItemId: null,
      targetArtifactId: null,
      findingIds: [],
      result: null,
    };
    runRepo = {
      findOne: jest.fn(async () => run),
      update: jest.fn(async () => ({ affected: 1 })),
      manager: { transaction: jest.fn(async (cb: (e: unknown) => unknown) => cb({})) } as never,
    };
    runs = { transition: jest.fn(), appendTurn: jest.fn(), emitRun: jest.fn(), registerDriver: jest.fn() };
    remote = { sendChatStreaming: jest.fn() };
    initiatives = { getEntityOrThrow: jest.fn(async () => initiative), publish: jest.fn(), appendActivity: jest.fn() };
    service = new InitiativeRunOrchestratorService(
      runRepo as never,
      { findOne: jest.fn(async () => null) } as never,
      { findOne: jest.fn(async () => null) } as never,
      { find: jest.fn(async () => []) } as never,
      runs as never,
      initiatives as never,
      {
        buildSessionContext: jest.fn(async () => ({
          initiativeContexts: ['OVERVIEW'],
          initiativeContextRefs: [{ kind: 'initiative', sha: 'a'.repeat(40), title: 'Checkout' }],
        })),
      } as never,
      remote as never,
    );
  });

  it('fails runs that stopped making progress (restart) so they can be retried, and tells the boards', async () => {
    const qb: Record<string, jest.Mock> = {};

    for (const method of ['update', 'set', 'where', 'andWhere', 'returning']) {
      qb[method] = jest.fn(() => qb);
    }

    qb['execute'] = jest.fn(async () => ({ raw: [{ id: 'run-1' }] }));
    runRepo['createQueryBuilder'] = jest.fn(() => qb);
    run['status'] = 'failed';

    await expect(service.failInterruptedRuns(1000)).resolves.toBe(1);
    expect(qb['set']).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', failureCode: 'RUN_INTERRUPTED' }),
    );
    expect(qb['where']).toHaveBeenCalledWith('status IN (:...statuses)', { statuses: ['pending', 'working'] });
    expect(runs['emitRun']).toHaveBeenCalledWith({ clientId: 'client-1' }, run);

    (service as unknown as { drivenRunIds: Set<string> }).drivenRunIds.add('run-driven');
    await service.failInterruptedRuns(1000);
    expect(qb['andWhere']).toHaveBeenCalledWith('id NOT IN (:...driven)', { driven: ['run-driven'] });

    qb['execute'].mockRejectedValueOnce(new Error('db down'));
    await expect(service.failInterruptedRuns()).resolves.toBe(0);
  });

  it('runs the first turn in the hidden read-only session with the pre-granted initiative context', async () => {
    remote.sendChatStreaming.mockResolvedValue({
      text: 'Draft\n```json\n{"status":"ready","message":"Done","draftMarkdown":"# PRD"}\n```',
    });

    await turn('Focus on B2B', true);

    const params = remote.sendChatStreaming.mock.calls[0][0];

    expect(params).toMatchObject({
      clientId: 'client-1',
      agentId: 'agent-1',
      resumeSessionSuffix: '-initiative-run-1',
      ephemeral: true,
      continue: false,
      contextInjection: expect.objectContaining({ includeWorkspace: false, initiativeContexts: ['OVERVIEW'] }),
    });
    expect(params).not.toHaveProperty('unattendedAutomation');
    expect(params.message).toContain('You are the Product Manager');
    expect(params.message).toContain(`Read first: initiative:${'a'.repeat(40)}`);
    expect(params.message).toContain('<user-request>\nFocus on B2B\n</user-request>');
    expect(runs['transition']).toHaveBeenCalledWith(
      {},
      'run-1',
      ['working'],
      expect.objectContaining({ status: 'ready' }),
    );
    expect(runs['appendTurn']).toHaveBeenCalledWith({}, run, 'agent', 'Done', null);
    expect(initiatives['publish']).toHaveBeenCalledWith('initiative.run.ready', 'client-1', expect.anything());
  });

  it('keeps the previous draft when a question turn omits it', async () => {
    run['result'] = { status: 'ready', draftMarkdown: '# Earlier', workItems: [], findings: [], decisions: [] };
    remote.sendChatStreaming.mockResolvedValue({
      text: '```json\n{"status":"needs_input","message":"Which users?"}\n```',
    });

    await turn('More detail', false);

    expect(remote.sendChatStreaming.mock.calls[0][0]).toMatchObject({ continue: true });
    expect(runs['transition']).toHaveBeenCalledWith(
      {},
      'run-1',
      ['working'],
      expect.objectContaining({
        status: 'needs_input',
        result: expect.objectContaining({ draftMarkdown: '# Earlier' }),
      }),
    );
  });

  it('asks for a repair and fails after repeated answers without a status block', async () => {
    remote.sendChatStreaming.mockResolvedValue({ text: 'just prose' });

    await turn('', true);

    expect(remote.sendChatStreaming).toHaveBeenCalledTimes(3);
    expect(remote.sendChatStreaming.mock.calls[1][0].message).toContain('no usable status block');
    expect(runs['transition']).toHaveBeenCalledWith(
      {},
      'run-1',
      ['pending', 'working'],
      expect.objectContaining({ status: 'failed', failureCode: 'agent_no_status' }),
    );
    expect(initiatives['publish']).toHaveBeenCalledWith('initiative.run.failed', 'client-1', expect.anything());
  });

  it('stops quietly when the run was cancelled meanwhile', async () => {
    remote.sendChatStreaming.mockImplementation(async () => {
      run['status'] = 'cancelled';

      return { text: '```json\n{"status":"ready"}\n```' };
    });

    await turn('', true);

    expect(runs['transition']).not.toHaveBeenCalledWith({}, 'run-1', ['working'], expect.anything());
  });
});
