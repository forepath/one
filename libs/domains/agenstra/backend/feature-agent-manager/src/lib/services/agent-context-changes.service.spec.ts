import { BadRequestException } from '@nestjs/common';

import type {
  AgentContextControllerRequest,
  AgentContextControllerResponse,
  AgentContextTicketRecord,
} from '../types/agent-context.types';

import { AgentContextAccessService } from './agent-context-access.service';
import { AgentContextApiService, type AgentContextGatewayBridge } from './agent-context-api.service';
import { AgentContextChangesService } from './agent-context-changes.service';
import { AgentContextTicketsService } from './agent-context-tickets.service';

jest.mock('../constants/agent-context.constants', () => ({
  ...jest.requireActual('../constants/agent-context.constants'),
  AGENT_CONTEXT_ACCESS_WAIT_MS: 50,
}));

const TICKET_SHA = 'a'.repeat(40);
const CREATED_SHA = 'c'.repeat(40);
const PAGE_SHA = 'b'.repeat(40);
const PLAN_SHA = 'd'.repeat(40);
const TASK_ID = '22222222-2222-4222-8222-222222222222';

describe('AgentContextChangesService', () => {
  let tickets: AgentContextTicketsService;
  let api: AgentContextApiService;
  let service: AgentContextChangesService;
  let bridge: jest.Mocked<AgentContextGatewayBridge>;
  let changeResponse: AgentContextControllerResponse;

  const mint = (overrides: Partial<Parameters<AgentContextTicketsService['mint']>[0]> = {}): AgentContextTicketRecord =>
    tickets.mint({
      agentId: 'agent-1',
      sessionKey: 'chat-1',
      chatSessionId: 'chat-1',
      ephemeral: false,
      correlationId: 'corr',
      accessMode: 'ask',
      items: [{ kind: 'ticket', title: 'Fix login', sha: TICKET_SHA, content: 'BODY' }],
      ...overrides,
    });
  const comment = { operation: 'ticket.comment', ref: `ticket:${TICKET_SHA.slice(0, 8)}`, body: 'Done.' };
  const changeCalls = () =>
    bridge.requestControllerContext.mock.calls
      .map(([, request]) => request)
      .filter(
        (request): request is Extract<AgentContextControllerRequest, { op: 'change' }> => request.op === 'change',
      );
  const questionId = () => bridge.publishContextChangeQuestion.mock.calls.at(-1)?.[1] as string;

  beforeEach(() => {
    tickets = new AgentContextTicketsService();
    api = new AgentContextApiService(tickets, new AgentContextAccessService());
    changeResponse = { ok: true, changed: { kind: 'ticket', sha: TICKET_SHA, title: 'Fix login', revision: 'r2' } };
    bridge = {
      requestControllerContext: jest.fn(
        async (_record, request: AgentContextControllerRequest): Promise<AgentContextControllerResponse> => {
          if (request.op === 'describe') {
            // Resolves short refs to the full SHA of the element (unique prefix).
            return {
              ok: true,
              items: request.refs.map((ref) => ({
                kind: ref.kind,
                sha: [TICKET_SHA, CREATED_SHA, PAGE_SHA, PLAN_SHA].find((sha) => sha.startsWith(ref.sha)) ?? ref.sha,
                title: 'Element',
              })),
            };
          }

          return request.op === 'change' ? changeResponse : { ok: true };
        },
      ),
      publishContextAccessQuestion: jest.fn(),
      publishContextChangeQuestion: jest.fn(),
      publishInteractionAnswered: jest.fn(),
    };
    api.registerBridge(bridge);
    service = new AgentContextChangesService(tickets, api);
  });

  describe('parse', () => {
    it('accepts well-formed changes and normalizes refs', () => {
      expect(service.parse({ ...comment, reason: ' why ' })).toEqual({
        request: { operation: 'ticket.comment', ref: `ticket:${TICKET_SHA.slice(0, 8)}`, body: 'Done.', reason: 'why' },
        target: { kind: 'ticket', sha: TICKET_SHA.slice(0, 8) },
      });
      expect(service.parse({ operation: 'page.create', title: 'Notes', parentRef: '' }).request).toEqual({
        operation: 'page.create',
        title: 'Notes',
        nodeType: 'page',
      });
    });

    it.each([
      [{ operation: 'ticket.drop' }],
      [{ operation: 'ticket.update', ref: `ticket:${TICKET_SHA}`, title: 'x' }],
      [{ operation: 'ticket.update', ref: `ticket:${TICKET_SHA}`, revision: 'r1' }],
      [{ operation: 'ticket.update', ref: `knowledge:${PAGE_SHA}`, revision: 'r1', title: 'x' }],
      [{ operation: 'page.update', ref: `knowledge:${PAGE_SHA}`, revision: 'r1', status: 'done' }],
      [{ operation: 'ticket.create', title: '   ' }],
      [{ operation: 'ticket.create', title: 'x', status: 'archived' }],
      [{ operation: 'page.create', title: 'x', nodeType: 'folder', content: 'no' }],
      [{ operation: 'ticket.comment', ref: `ticket:${TICKET_SHA}`, body: '' }],
      [{ operation: 'ticket.create', title: 'x'.repeat(501) }],
      [{ operation: 'plan.update', ref: `knowledge:${PAGE_SHA}`, revision: 'r1', content: '# x' }],
      [{ operation: 'plan.update', ref: `plan:${PLAN_SHA}`, revision: 'r1', status: 'done' }],
      [{ operation: 'plan.update', ref: `plan:${PLAN_SHA}`, revision: 'r1', content: '   ' }],
      [{ operation: 'plan.update', ref: `plan:${PLAN_SHA}`, content: '# x' }],
    ])('rejects %j', (body) => {
      expect(() => service.parse(body)).toThrow(BadRequestException);
    });
  });

  it('never changes content in hidden helper (deny) sessions or plans', async () => {
    for (const record of [
      mint({ accessMode: 'deny', sessionKey: 'suffix:-ticket-body' }),
      mint({ accessMode: 'auto', sessionKey: 'suffix:-plan-1' }),
    ]) {
      await expect(service.requestChange(record, service.parse(comment))).resolves.toMatchObject({
        decision: 'denied',
      });
    }

    expect(bridge.requestControllerContext).not.toHaveBeenCalled();
    expect(bridge.publishContextChangeQuestion).not.toHaveBeenCalled();
  });

  it('only changes elements the ticket may read', async () => {
    const record = mint({ items: [] });

    await expect(service.requestChange(record, service.parse(comment))).resolves.toMatchObject({
      decision: 'denied',
      message: expect.stringContaining('context_request_access'),
    });
    expect(changeCalls()).toHaveLength(0);
  });

  it('asks the user in chats and applies the change once approved', async () => {
    const record = mint();
    const pending = service.requestChange(record, service.parse(comment));

    await new Promise((resolve) => setImmediate(resolve));

    expect(bridge.publishContextChangeQuestion).toHaveBeenCalledWith(
      record,
      expect.stringMatching(/^ctx_chg_/),
      expect.stringContaining('Comment:\nDone.'),
    );
    expect(changeCalls()).toHaveLength(0);

    await service.decide('agent-1', questionId(), 'once');

    await expect(pending).resolves.toMatchObject({
      decision: 'applied',
      operation: 'ticket.comment',
      ref: `ticket:${TICKET_SHA}`,
      revision: 'r2',
    });
    // Resolved to the full SHA; the source is the chat, never agent input.
    expect(changeCalls()).toEqual([
      {
        op: 'change',
        agentId: 'agent-1',
        change: { operation: 'ticket.comment', body: 'Done.', sha: TICKET_SHA },
        source: { kind: 'chat' },
      },
    ]);
    expect(bridge.publishInteractionAnswered).toHaveBeenCalledWith('agent-1', [questionId()], expect.any(String));
  });

  it('does not apply rejected changes and ignores later replies', async () => {
    const record = mint();
    const pending = service.requestChange(record, service.parse(comment));

    await new Promise((resolve) => setImmediate(resolve));
    await service.decide('agent-1', questionId(), 'reject');
    await service.decide('agent-1', questionId(), 'once');

    await expect(pending).resolves.toMatchObject({ decision: 'denied' });
    expect(changeCalls()).toHaveLength(0);
  });

  it('returns pending while nobody decided and applies a late approval', async () => {
    const record = mint();

    await expect(service.requestChange(record, service.parse(comment))).resolves.toMatchObject({
      decision: 'pending',
    });

    const requestId = questionId();

    await service.decide('agent-1', requestId, 'once');

    await expect(service.changeStatus(record, requestId)).resolves.toMatchObject({ decision: 'applied' });
    expect(changeCalls()).toHaveLength(1);
  });

  it('"allow for this chat" covers the same operation on the same element only', async () => {
    const record = mint();
    const first = service.requestChange(record, service.parse(comment));

    await new Promise((resolve) => setImmediate(resolve));
    await service.decide('agent-1', questionId(), 'always');
    await first;

    // Same chat, next turn: applied without asking.
    const nextTurn = mint();

    await expect(service.requestChange(nextTurn, service.parse({ ...comment, body: 'Again.' }))).resolves.toMatchObject(
      {
        decision: 'applied',
      },
    );
    expect(bridge.publishContextChangeQuestion).toHaveBeenCalledTimes(1);

    // Another operation on the same ticket asks again.
    await expect(
      service.requestChange(
        nextTurn,
        service.parse({ operation: 'ticket.delete', ref: `ticket:${TICKET_SHA}`, revision: 'r2' }),
      ),
    ).resolves.toMatchObject({ decision: 'pending' });
    expect(bridge.publishContextChangeQuestion).toHaveBeenCalledTimes(2);
  });

  it('makes created elements readable and changeable for the rest of the turn', async () => {
    const record = mint();

    changeResponse = { ok: true, changed: { kind: 'ticket', sha: CREATED_SHA, title: 'Follow-up', revision: 'r1' } };

    const create = service.requestChange(record, service.parse({ operation: 'ticket.create', title: 'Follow-up' }));

    await new Promise((resolve) => setImmediate(resolve));
    await service.decide('agent-1', questionId(), 'once');

    await expect(create).resolves.toMatchObject({ decision: 'applied', ref: `ticket:${CREATED_SHA}` });
    expect(tickets.isGranted(record, 'ticket', CREATED_SHA)).toBe(true);

    const update = service.requestChange(
      record,
      service.parse({ operation: 'ticket.update', ref: `ticket:${CREATED_SHA}`, revision: 'r1', status: 'todo' }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(bridge.publishContextChangeQuestion).toHaveBeenCalledTimes(2);
    await service.decide('agent-1', questionId(), 'once');
    await expect(update).resolves.toMatchObject({ decision: 'applied' });
  });

  it('forwards unattended task runs with their task and maps controller refusals', async () => {
    const record = mint({ accessMode: 'auto', sessionKey: `suffix:-task-${TASK_ID}`, chatSessionId: undefined });

    changeResponse = { ok: false, error: 'No content changes were approved for this task.', status: 403 };

    await expect(service.requestChange(record, service.parse(comment))).resolves.toMatchObject({
      decision: 'denied',
      message: 'No content changes were approved for this task.',
    });
    expect(changeCalls()[0].source).toEqual({ kind: 'task', taskId: TASK_ID });
    expect(bridge.publishContextChangeQuestion).not.toHaveBeenCalled();

    changeResponse = { ok: false, error: 'ticket changed since you read it', status: 409 };

    await expect(service.requestChange(record, service.parse(comment))).resolves.toMatchObject({ decision: 'failed' });
  });

  it('forwards ticket automation runs as automation source', async () => {
    const record = mint({ accessMode: 'auto', sessionKey: 'suffix:-ticket-auto-loop', chatSessionId: undefined });

    await expect(service.requestChange(record, service.parse(comment))).resolves.toMatchObject({
      decision: 'applied',
    });
    expect(changeCalls()[0].source).toEqual({ kind: 'automation' });
  });

  it('refuses automatic changes while other sessions of the agent work', async () => {
    const record = mint({ accessMode: 'auto', sessionKey: `suffix:-task-${TASK_ID}` });

    jest.spyOn(api, 'isExclusiveAutoSession').mockReturnValue(false);

    await expect(service.requestChange(record, service.parse(comment))).resolves.toMatchObject({
      decision: 'denied',
    });
    expect(changeCalls()).toHaveLength(0);
  });

  it('bounds the changes per ticket', async () => {
    const record = mint({ accessMode: 'auto', sessionKey: 'suffix:-ticket-auto-loop' });

    record.changeCount = 50;

    await expect(service.requestChange(record, service.parse(comment))).resolves.toMatchObject({
      decision: 'denied',
    });
  });

  describe('plan.update', () => {
    const planChange = {
      operation: 'plan.update',
      ref: `plan:${PLAN_SHA.slice(0, 8)}`,
      revision: 'r1',
      content: '# Plan v2',
      reason: 'clarify',
    };

    it('parses plan refs as plan targets', () => {
      expect(service.parse(planChange)).toEqual({
        request: { ...planChange, reason: 'clarify' },
        target: { kind: 'plan', sha: PLAN_SHA.slice(0, 8) },
      });
    });

    it('asks the user in interactive chats and applies the approved change with the full plan SHA', async () => {
      changeResponse = { ok: true, changed: { kind: 'plan', sha: PLAN_SHA, title: 'Login plan', revision: 'r2' } };

      const record = mint({ items: [{ kind: 'plan', title: 'Login plan', sha: PLAN_SHA, content: 'PLAN' }] });
      const pending = service.requestChange(record, service.parse(planChange));

      await new Promise((resolve) => setTimeout(resolve, 5));

      const prompt = bridge.publishContextChangeQuestion.mock.calls.at(-1)?.[2] as string;

      expect(prompt).toContain(`plan ${PLAN_SHA.slice(0, 8)}`);
      expect(prompt).toContain('not executed yet');
      await service.decide(record.agentId, questionId(), 'once');
      await expect(pending).resolves.toMatchObject({ decision: 'applied', ref: `plan:${PLAN_SHA}`, revision: 'r2' });
      expect(changeCalls().at(-1)?.change).toEqual({
        operation: 'plan.update',
        sha: PLAN_SHA,
        revision: 'r1',
        content: '# Plan v2',
      });
    });

    it('refuses plans that are not readable in the session', async () => {
      await expect(service.requestChange(mint(), service.parse(planChange))).resolves.toMatchObject({
        decision: 'denied',
      });
      expect(changeCalls()).toHaveLength(0);
    });

    it('reports a read-only (executed) plan as failed with the controller message', async () => {
      changeResponse = { ok: false, error: 'This plan has been executed and is read-only.', status: 409 };

      const record = mint({
        accessMode: 'ask',
        items: [{ kind: 'plan', title: 'Login plan', sha: PLAN_SHA, content: 'PLAN' }],
      });
      const pending = service.requestChange(record, service.parse(planChange));

      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.decide(record.agentId, questionId(), 'once');
      await expect(pending).resolves.toMatchObject({
        decision: 'failed',
        message: 'This plan has been executed and is read-only.',
      });
    });
  });

  describe('initiative changes', () => {
    const INITIATIVE_SHA = 'e'.repeat(40);
    const propose = {
      operation: 'initiative.propose',
      ref: `initiative:${INITIATIVE_SHA}`,
      title: 'Add SSO',
      workItems: [{ op: 'add', parentKey: 'E1', item: { key: 'N1', title: 'SSO' } }],
    };

    it('validates proposals and findings', () => {
      expect(service.parse(propose).target).toEqual({ kind: 'initiative', sha: INITIATIVE_SHA });
      expect(() => service.parse({ ...propose, workItems: undefined })).toThrow(BadRequestException);
      expect(() => service.parse({ ...propose, workItems: ['x'] })).toThrow(BadRequestException);
      expect(() => service.parse({ ...propose, ref: `ticket:${TICKET_SHA}` })).toThrow(BadRequestException);
      expect(() =>
        service.parse({
          operation: 'initiative.finding',
          ref: `initiative:${INITIATIVE_SHA}`,
          body: 'x',
          itemKey: '../x',
        }),
      ).toThrow(BadRequestException);
      expect(
        service.parse({
          operation: 'initiative.finding',
          ref: `initiative:${INITIATIVE_SHA}`,
          body: ' Deferred ',
          severity: 'major',
          itemKey: 'E1.S2',
          evidence: ['ticket:abcd'],
        }).request,
      ).toEqual({
        operation: 'initiative.finding',
        ref: `initiative:${INITIATIVE_SHA}`,
        body: 'Deferred',
        severity: 'major',
        itemKey: 'E1.S2',
        evidence: ['ticket:abcd'],
      });
    });

    it('denies changes of initiatives that are not readable', async () => {
      const result = await service.requestChange(mint(), service.parse(propose));

      expect(result.decision).toBe('denied');
      expect(changeCalls()).toHaveLength(0);
    });

    it('never lets initiative step sessions change content (they return their result in the status block)', async () => {
      const record = mint({
        accessMode: 'auto',
        sessionKey: 'suffix:-initiative-11111111-1111-4111-8111-111111111111',
        items: [{ kind: 'initiative', title: 'Checkout', sha: INITIATIVE_SHA, content: 'OVERVIEW' }],
      });
      const result = await service.requestChange(record, service.parse(propose));

      expect(result.decision).toBe('denied');
      expect(changeCalls()).toHaveLength(0);
    });

    it('asks the user in chats before forwarding a proposal of a readable initiative', async () => {
      const record = mint({
        items: [{ kind: 'initiative', title: 'Checkout', sha: INITIATIVE_SHA, content: 'OVERVIEW' }],
      });
      const pending = service.requestChange(record, service.parse(propose));

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bridge.publishContextChangeQuestion.mock.calls.at(-1)?.[2]).toContain(
        'Nothing changes until a user accepts',
      );

      await service.decide('agent-1', questionId(), 'once');
      await pending;

      expect(changeCalls().at(-1)?.change).toMatchObject({ operation: 'initiative.propose', sha: INITIATIVE_SHA });
    });
  });
});
