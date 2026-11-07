import { KnowledgeNodeType } from '../entities/knowledge-node.enums';
import { TicketAutomationRunStatus } from '../entities/ticket-automation.enums';
import { isAgentContentWriter } from '../utils/agent-content-writer.utils';

import { AgentContentChangesService } from './agent-content-changes.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- repository / service doubles */

describe('AgentContentChangesService', () => {
  const clientId = 'client-1';
  const agentId = '11111111-1111-4111-8111-111111111111';
  const taskId = '22222222-2222-4222-8222-222222222222';
  const rootSha = 'a'.repeat(40);
  const childSha = 'b'.repeat(40);
  const foreignSha = 'f'.repeat(40);
  const pageSha = 'c'.repeat(40);
  const revision = '2026-11-03T10:00:00.000Z';
  const tickets: Record<string, any> = {
    root: { id: 'root', clientId, parentId: null, title: 'Epic', longSha: rootSha, updatedAt: new Date(revision) },
    child: {
      id: 'child',
      clientId,
      parentId: 'root',
      title: 'Story',
      longSha: childSha,
      updatedAt: new Date(revision),
    },
    foreign: {
      id: 'foreign',
      clientId,
      parentId: null,
      title: 'Other',
      longSha: foreignSha,
      updatedAt: new Date(revision),
    },
  };
  const page = { id: 'page', clientId, title: 'Notes', longSha: pageSha, updatedAt: new Date(revision) };
  let ticketRepo: any;
  let knowledgeRepo: any;
  let taskRepo: any;
  let taskRunRepo: any;
  let automationRepo: any;
  let automationRunRepo: any;
  let credentials: any;
  let ticketsService: any;
  let knowledgeTreeService: any;
  let chatPlanService: any;
  let service: AgentContentChangesService;
  const planSha = 'd'.repeat(40);
  const plan = {
    id: 'plan-1',
    clientId,
    agentId,
    summary: 'Login plan',
    sourcePrompt: 'Build login',
    longSha: planSha,
    updatedAt: new Date(revision),
  };

  const handle = (change: Record<string, unknown>, source: Record<string, unknown> = { kind: 'chat' }) =>
    service.handle(clientId, agentId, change, source);

  beforeEach(() => {
    ticketRepo = {
      findOne: jest.fn(
        async ({ where }: any) =>
          Object.values(tickets).find(
            (t) => t.clientId === where.clientId && (where.id ? t.id === where.id : t.longSha === where.longSha),
          ) ?? null,
      ),
    };
    knowledgeRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.longSha === pageSha || where.id === 'page' || where.id === 'new-page'
          ? { ...page, id: where.id ?? 'page' }
          : null,
      ),
    };
    taskRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: taskId, approvedAt: new Date(), allowedContentWrites: ['ticket.comment'] }),
    };
    taskRunRepo = { findOne: jest.fn().mockResolvedValue({ id: 'run-1', status: 'running' }) };
    automationRepo = {
      findOne: jest.fn().mockResolvedValue({ ticketId: 'root', allowedContentWrites: ['ticket.update'] }),
    };
    automationRunRepo = { find: jest.fn().mockResolvedValue([{ id: 'arun', ticketId: 'root' }]) };
    credentials = { findByClientAndAgent: jest.fn().mockResolvedValue({ id: 'cred' }) };
    ticketsService = {
      create: jest.fn().mockResolvedValue({ id: 'child' }),
      update: jest.fn().mockResolvedValue({}),
      addComment: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    chatPlanService = {
      findForAgentBySha: jest.fn(async (_c: string, a: string, sha: string) =>
        a === agentId && sha === planSha ? plan : null,
      ),
      updateForAgent: jest.fn(async () => ({ ...plan, updatedAt: new Date('2026-11-03T11:00:00.000Z') })),
    };
    knowledgeTreeService = {
      createNode: jest.fn().mockResolvedValue({ id: 'new-page' }),
      updateNode: jest.fn().mockResolvedValue({}),
      deleteNode: jest.fn().mockResolvedValue(undefined),
    };
    service = new AgentContentChangesService(
      ticketRepo,
      knowledgeRepo,
      taskRepo,
      taskRunRepo,
      automationRepo,
      automationRunRepo,
      credentials,
      ticketsService,
      knowledgeTreeService,
      chatPlanService,
    );
  });

  it('applies chat changes as the agent of this workspace and reports the new revision', async () => {
    await expect(handle({ operation: 'ticket.comment', sha: childSha, body: ' Done. ' })).resolves.toEqual({
      ok: true,
      changed: { kind: 'ticket', sha: childSha, title: 'Story', revision },
    });

    const [ticketId, dto, writer] = ticketsService.addComment.mock.calls[0];

    expect(ticketId).toBe('child');
    expect(dto).toEqual({ body: 'Done.' });
    expect(isAgentContentWriter(writer)).toBe(true);
    expect(writer).toMatchObject({ clientId, agentId, source: 'chat' });
  });

  it('refuses agents outside the workspace and malformed changes', async () => {
    credentials.findByClientAndAgent.mockResolvedValueOnce(null);

    await expect(handle({ operation: 'ticket.comment', sha: childSha, body: 'x' })).resolves.toMatchObject({
      ok: false,
      status: 404,
    });

    for (const change of [
      { operation: 'ticket.comment', sha: 'bbbb', body: 'x' },
      { operation: 'ticket.update', sha: childSha, title: 'x' },
      { operation: 'ticket.create', sha: childSha, title: 'x' },
      { operation: 'ticket.create', title: '' },
      { operation: 'page.create', title: 'x', nodeType: KnowledgeNodeType.FOLDER, content: 'no' },
      { operation: 'ticket.update', sha: childSha, revision, status: 'archived' },
    ]) {
      await expect(handle(change)).resolves.toMatchObject({ ok: false, status: 400 });
    }

    expect(ticketsService.addComment).not.toHaveBeenCalled();
    expect(ticketsService.update).not.toHaveBeenCalled();
    expect(ticketsService.create).not.toHaveBeenCalled();
    expect(knowledgeTreeService.createNode).not.toHaveBeenCalled();
  });

  it('never overwrites elements changed since the agent read them', async () => {
    await expect(
      handle({ operation: 'ticket.update', sha: childSha, revision: '2026-11-01T00:00:00.000Z', status: 'done' }),
    ).resolves.toMatchObject({ ok: false, status: 409, error: expect.stringContaining('context_get') });
    await expect(
      handle({ operation: 'page.delete', sha: pageSha, revision: '2026-11-01T00:00:00.000Z' }),
    ).resolves.toMatchObject({ ok: false, status: 409 });
    expect(ticketsService.update).not.toHaveBeenCalled();
    expect(knowledgeTreeService.deleteNode).not.toHaveBeenCalled();

    await expect(
      handle({ operation: 'ticket.update', sha: childSha, revision, status: 'done' }),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(ticketsService.update).toHaveBeenCalledWith('child', { status: 'done' }, expect.anything());
  });

  it('creates tickets and pages in the workspace (below the given parent)', async () => {
    await expect(handle({ operation: 'ticket.create', parentSha: rootSha, title: 'Story' })).resolves.toMatchObject({
      ok: true,
      changed: { kind: 'ticket', sha: childSha },
    });
    expect(ticketsService.create).toHaveBeenCalledWith(
      { clientId, parentId: 'root', title: 'Story' },
      expect.objectContaining({ agentId }),
    );

    await expect(handle({ operation: 'page.create', title: 'Notes', content: '# Notes' })).resolves.toMatchObject({
      ok: true,
      changed: { kind: 'knowledge', sha: pageSha },
    });
    expect(knowledgeTreeService.createNode).toHaveBeenCalledWith(
      { clientId, nodeType: KnowledgeNodeType.PAGE, title: 'Notes', content: '# Notes' },
      expect.objectContaining({ agentId }),
    );
  });

  describe('task runs', () => {
    const source = { kind: 'task', taskId };
    const comment = { operation: 'ticket.comment', sha: childSha, body: 'Report' };

    it('apply only operations a user approved for the working task', async () => {
      await expect(handle(comment, source)).resolves.toMatchObject({ ok: true });
      expect(taskRepo.findOne).toHaveBeenCalledWith({ where: { id: taskId, clientId, agentId } });
      expect(taskRunRepo.findOne).toHaveBeenCalledWith({ where: { taskId, status: 'running' } });
    });

    it.each([
      [
        'not approved',
        () =>
          taskRepo.findOne.mockResolvedValue({
            id: taskId,
            approvedAt: null,
            allowedContentWrites: ['ticket.comment'],
          }),
      ],
      [
        'operation not approved',
        () => taskRepo.findOne.mockResolvedValue({ id: taskId, approvedAt: new Date(), allowedContentWrites: [] }),
      ],
      ['not working', () => taskRunRepo.findOne.mockResolvedValue(null)],
      ['unknown task', () => taskRepo.findOne.mockResolvedValue(null)],
    ])('refuse changes when the task is %s', async (_case, arrange) => {
      arrange();

      await expect(handle(comment, source)).resolves.toMatchObject({ ok: false, status: 403 });
      expect(ticketsService.addComment).not.toHaveBeenCalled();
    });
  });

  describe('ticket automation', () => {
    const source = { kind: 'automation' };
    const update = { operation: 'ticket.update', sha: childSha, revision, status: 'done' };

    it('applies allowed ticket operations within the automated ticket tree', async () => {
      await expect(handle(update, source)).resolves.toMatchObject({ ok: true });
      expect(automationRunRepo.find).toHaveBeenCalledWith({
        where: { clientId, agentId, status: TicketAutomationRunStatus.RUNNING },
        take: 2,
      });
    });

    it('refuses tickets outside the tree, other operations, deletes and ambiguous runs', async () => {
      await expect(handle({ ...update, sha: foreignSha }, source)).resolves.toMatchObject({ ok: false, status: 403 });
      await expect(handle({ operation: 'ticket.comment', sha: childSha, body: 'x' }, source)).resolves.toMatchObject({
        ok: false,
        status: 403,
      });

      // Deletes and knowledge changes are never automation operations, even when stored.
      automationRepo.findOne.mockResolvedValue({
        ticketId: 'root',
        allowedContentWrites: ['ticket.delete', 'page.update'],
      });
      await expect(handle({ operation: 'ticket.delete', sha: childSha, revision }, source)).resolves.toMatchObject({
        ok: false,
        status: 403,
      });
      await expect(
        handle({ operation: 'page.update', sha: pageSha, revision, title: 'x' }, source),
      ).resolves.toMatchObject({ ok: false, status: 403 });

      automationRepo.findOne.mockResolvedValue({ ticketId: 'root', allowedContentWrites: ['ticket.create'] });
      await expect(handle({ operation: 'ticket.create', title: 'Root-level' }, source)).resolves.toMatchObject({
        ok: false,
        status: 403,
      });

      automationRunRepo.find.mockResolvedValue([{ ticketId: 'root' }, { ticketId: 'foreign' }]);
      await expect(handle(update, source)).resolves.toMatchObject({ ok: false, status: 403 });

      expect(ticketsService.update).not.toHaveBeenCalled();
      expect(ticketsService.addComment).not.toHaveBeenCalled();
      expect(ticketsService.remove).not.toHaveBeenCalled();
      expect(ticketsService.create).not.toHaveBeenCalled();
      expect(knowledgeTreeService.updateNode).not.toHaveBeenCalled();
    });

    it('never updates the automated ticket itself (its approval would cancel the run)', async () => {
      await expect(handle({ ...update, sha: rootSha }, source)).resolves.toMatchObject({
        ok: false,
        status: 403,
        error: expect.stringContaining('managed by this run'),
      });
      expect(ticketsService.update).not.toHaveBeenCalled();
    });

    it('creates subtasks below tickets of the tree', async () => {
      automationRepo.findOne.mockResolvedValue({ ticketId: 'root', allowedContentWrites: ['ticket.create'] });

      await expect(
        handle({ operation: 'ticket.create', parentSha: childSha, title: 'Sub' }, source),
      ).resolves.toMatchObject({
        ok: true,
      });
    });
  });

  it('refuses unknown sources', async () => {
    await expect(
      handle({ operation: 'ticket.comment', sha: childSha, body: 'x' }, { kind: 'task', taskId: 'nope' }),
    ).resolves.toMatchObject({ ok: false, status: 403 });
    await expect(
      handle({ operation: 'ticket.comment', sha: childSha, body: 'x' }, { kind: 'plan' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
    });
  });

  describe('plan.update', () => {
    it('updates a plan of the agent through the plan service (same edit rules) and reports the new revision', async () => {
      await expect(
        handle({ operation: 'plan.update', sha: planSha, revision, content: '# v2', title: 'Login v2' }),
      ).resolves.toEqual({
        ok: true,
        changed: { kind: 'plan', sha: planSha, title: 'Login plan', revision: '2026-11-03T11:00:00.000Z' },
      });

      const [writer, sha, input] = chatPlanService.updateForAgent.mock.calls[0];

      expect(isAgentContentWriter(writer)).toBe(true);
      expect(writer).toMatchObject({ clientId, agentId, source: 'chat' });
      expect(sha).toBe(planSha);
      expect(input).toEqual({ revision, content: '# v2', title: 'Login v2' });
    });

    it('never changes plans that changed since the agent read them', async () => {
      await expect(
        handle({ operation: 'plan.update', sha: planSha, revision: '2026-01-01T00:00:00.000Z', content: '# v2' }),
      ).resolves.toMatchObject({ ok: false, status: 409 });
      expect(chatPlanService.updateForAgent).not.toHaveBeenCalled();
    });

    it('does not reach plans of other environments', async () => {
      chatPlanService.findForAgentBySha.mockResolvedValueOnce(null);

      await expect(
        handle({ operation: 'plan.update', sha: planSha, revision, content: '# v2' }),
      ).resolves.toMatchObject({ ok: false, status: 404 });
    });

    it('needs the explicit plan.update opt-in for task runs and is never allowed for ticket automation', async () => {
      await expect(
        handle({ operation: 'plan.update', sha: planSha, revision, content: '# v2' }, { kind: 'task', taskId }),
      ).resolves.toMatchObject({ ok: false, status: 403 });

      taskRepo.findOne.mockResolvedValue({ id: taskId, approvedAt: new Date(), allowedContentWrites: ['plan.update'] });
      await expect(
        handle({ operation: 'plan.update', sha: planSha, revision, content: '# v2' }, { kind: 'task', taskId }),
      ).resolves.toMatchObject({ ok: true });

      automationRepo.findOne.mockResolvedValue({ ticketId: 'root', allowedContentWrites: ['plan.update'] });
      await expect(
        handle({ operation: 'plan.update', sha: planSha, revision, content: '# v2' }, { kind: 'automation' }),
      ).resolves.toMatchObject({ ok: false, status: 403 });
    });
  });

  describe('initiative changes', () => {
    const initiativeSha = 'e'.repeat(40);
    let initiativeContext: { applyAgentChange: jest.Mock; assertAutomationFinding: jest.Mock };

    beforeEach(() => {
      initiativeContext = {
        applyAgentChange: jest.fn(async () => ({
          kind: 'initiative',
          sha: initiativeSha,
          title: 'Checkout',
          revision: '3',
        })),
        assertAutomationFinding: jest.fn(async () => undefined),
      };
      service = new AgentContentChangesService(
        ticketRepo,
        knowledgeRepo,
        taskRepo,
        taskRunRepo,
        automationRepo,
        automationRunRepo,
        credentials,
        ticketsService,
        knowledgeTreeService,
        chatPlanService,
        initiativeContext as never,
      );
    });

    const propose = {
      operation: 'initiative.propose',
      sha: initiativeSha,
      title: 'Add SSO',
      workItems: [{ op: 'add', parentKey: 'E1', item: { key: 'N1', title: 'SSO' } }],
    };

    it('forwards approved chat proposals to the initiative services as the agent of this workspace', async () => {
      await expect(handle(propose)).resolves.toEqual({
        ok: true,
        changed: { kind: 'initiative', sha: initiativeSha, title: 'Checkout', revision: '3' },
      });
      expect(initiativeContext.applyAgentChange).toHaveBeenCalledWith(
        expect.objectContaining({ clientId, agentId, source: 'chat' }),
        expect.objectContaining({ operation: 'initiative.propose', title: 'Add SSO' }),
      );
    });

    it('validates the structured parts', async () => {
      await expect(handle({ ...propose, workItems: 'nope' })).resolves.toMatchObject({ ok: false, status: 400 });
      await expect(handle({ ...propose, title: undefined })).resolves.toMatchObject({ ok: false, status: 400 });
      await expect(handle({ operation: 'initiative.finding', sha: initiativeSha })).resolves.toMatchObject({
        ok: false,
        status: 400,
      });
      await expect(
        handle({ operation: 'initiative.finding', sha: initiativeSha, body: 'x', severity: 'fatal' }),
      ).resolves.toMatchObject({ ok: false, status: 400 });
    });

    it('needs the task opt-in for scheduled task runs', async () => {
      await expect(handle(propose, { kind: 'task', taskId })).resolves.toMatchObject({ ok: false, status: 403 });
      expect(initiativeContext.applyAgentChange).not.toHaveBeenCalled();
    });

    it('lets ticket automation only record findings on its own story when allowed', async () => {
      const finding = { operation: 'initiative.finding', sha: initiativeSha, body: 'Deferred: rate limiting' };

      await expect(handle(finding, { kind: 'automation' })).resolves.toMatchObject({ ok: false, status: 403 });

      automationRepo.findOne.mockResolvedValue({ ticketId: 'root', allowedContentWrites: ['initiative.finding'] });
      await expect(handle(finding, { kind: 'automation' })).resolves.toMatchObject({ ok: true });
      expect(initiativeContext.assertAutomationFinding).toHaveBeenCalledWith(
        clientId,
        'root',
        expect.objectContaining({ operation: 'initiative.finding' }),
      );
      // Proposals are never allowed for automation (not part of the automation catalog).
      await expect(handle(propose, { kind: 'automation' })).resolves.toMatchObject({ ok: false, status: 403 });
    });
  });
});
