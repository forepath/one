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
  let service: AgentContentChangesService;

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
});
