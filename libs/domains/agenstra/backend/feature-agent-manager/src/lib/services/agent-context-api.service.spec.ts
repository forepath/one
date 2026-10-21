import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { AgentContextTicketRecord } from '../types/agent-context.types';

import { AgentContextAccessService } from './agent-context-access.service';
import { AgentContextApiService, type AgentContextGatewayBridge } from './agent-context-api.service';
import { AgentContextTicketsService } from './agent-context-tickets.service';

jest.mock('../constants/agent-context.constants', () => ({
  ...jest.requireActual('../constants/agent-context.constants'),
  AGENT_CONTEXT_ACCESS_WAIT_MS: 50,
}));

describe('AgentContextApiService', () => {
  let tickets: AgentContextTicketsService;
  let access: AgentContextAccessService;
  let service: AgentContextApiService;
  let bridge: jest.Mocked<AgentContextGatewayBridge>;

  const mint = (overrides: Partial<Parameters<AgentContextTicketsService['mint']>[0]> = {}): AgentContextTicketRecord =>
    tickets.mint({
      agentId: 'agent-1',
      sessionKey: 'chat-1',
      socketId: 'socket-1',
      chatSessionId: 'chat-1',
      chatId: 'chat-1',
      ephemeral: false,
      correlationId: 'corr',
      accessMode: 'ask',
      items: [{ kind: 'ticket', title: 'Fix login', sha: 'aaaa111122223333', content: 'TICKET BODY' }],
      grants: { ticket: ['aaaa111122223333'] },
      ...overrides,
    });

  beforeEach(() => {
    tickets = new AgentContextTicketsService();
    access = new AgentContextAccessService();
    service = new AgentContextApiService(tickets, access);
    bridge = {
      requestControllerContext: jest.fn(),
      publishContextAccessQuestion: jest.fn(),
      publishInteractionAnswered: jest.fn(),
    };
    service.registerBridge(bridge);
  });

  describe('list', () => {
    it('returns metadata of granted items without content', () => {
      const record = mint({ workspace: { mountPath: '/opt/workspace' } });
      const result = service.list(record);

      expect(result).toEqual({
        ticket: record.ticket,
        items: [
          { ref: 'item:1', kind: 'ticket', title: 'Fix login', sha: 'aaaa111122223333', size: 11, granted: true },
        ],
        attachments: [],
        workspace: { mountPath: '/opt/workspace' },
        environments: [],
        canRequestAccess: true,
      });
    });

    it('reports deny-mode tickets as unable to request access', () => {
      expect(service.list(mint({ accessMode: 'deny' })).canRequestAccess).toBe(false);
    });
  });

  describe('get', () => {
    it('serves pre-granted items by index and by sha without a controller round trip', async () => {
      const record = mint();

      await expect(service.get(record, 'item:1')).resolves.toMatchObject({ content: 'TICKET BODY' });
      await expect(service.get(record, 'ticket:aaaa1111')).resolves.toMatchObject({ content: 'TICKET BODY' });
      expect(bridge.requestControllerContext).not.toHaveBeenCalled();
    });

    it('rejects malformed refs and unknown items', async () => {
      const record = mint();

      await expect(service.get(record, 'file:/etc/passwd')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.get(record, 'item:9')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses refs that were not granted', async () => {
      await expect(service.get(mint(), 'knowledge:bbbb2222')).rejects.toBeInstanceOf(ForbiddenException);
      expect(bridge.requestControllerContext).not.toHaveBeenCalled();
    });

    it('fetches granted refs from the controller once and caches them on the ticket', async () => {
      const record = mint();

      tickets.grant(record, [{ kind: 'knowledge', sha: 'bbbb2222' }], 'once');
      bridge.requestControllerContext.mockResolvedValue({
        ok: true,
        contents: [{ kind: 'knowledge', sha: 'BBBB2222CCCC', title: 'Auth design', content: 'PAGE' }],
      });

      await expect(service.get(record, 'knowledge:bbbb2222')).resolves.toEqual({
        ref: 'knowledge:bbbb2222cccc',
        kind: 'knowledge',
        title: 'Auth design',
        content: 'PAGE',
      });
      await service.get(record, 'knowledge:bbbb2222');

      expect(bridge.requestControllerContext).toHaveBeenCalledTimes(1);
      expect(bridge.requestControllerContext).toHaveBeenCalledWith(record, {
        op: 'content',
        agentId: 'agent-1',
        refs: [{ kind: 'knowledge', sha: 'bbbb2222' }],
      });
    });

    it('maps controller failures to not found', async () => {
      const record = mint();

      tickets.grant(record, [{ kind: 'ticket', sha: 'cccc3333' }], 'once');
      bridge.requestControllerContext.mockResolvedValue({ ok: false, error: 'No controller connection' });

      await expect(service.get(record, 'ticket:cccc3333')).rejects.toThrow('No controller connection');
    });
  });

  describe('search', () => {
    it('returns controller metadata flagged with grant state and bounded limit', async () => {
      const record = mint();

      bridge.requestControllerContext.mockResolvedValue({
        ok: true,
        items: [
          { kind: 'ticket', sha: 'AAAA111122223333', title: 'Fix login', status: 'todo' },
          { kind: 'knowledge', sha: 'dddd4444', title: 'Runbook', nodeType: 'page', parentSha: null },
        ],
      });

      const result = await service.search(record, ' login ', ['ticket'], 500);

      expect(bridge.requestControllerContext).toHaveBeenCalledWith(record, {
        op: 'search',
        agentId: 'agent-1',
        query: 'login',
        kinds: ['ticket'],
        limit: 50,
      });
      expect(result.items).toEqual([
        {
          ref: 'ticket:aaaa111122223333',
          kind: 'ticket',
          title: 'Fix login',
          sha: 'aaaa111122223333',
          status: 'todo',
          granted: true,
        },
        {
          ref: 'knowledge:dddd4444',
          kind: 'knowledge',
          title: 'Runbook',
          sha: 'dddd4444',
          nodeType: 'page',
          parentSha: null,
          granted: false,
        },
      ]);
    });
  });

  describe('requestAccess', () => {
    it('validates refs', async () => {
      const record = mint();

      await expect(service.requestAccess(record, [], undefined)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.requestAccess(record, ['item:1'], undefined)).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.requestAccess(
          record,
          Array.from({ length: 21 }, (_, i) => `ticket:${String(i).padStart(4, '0')}`),
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns granted immediately when everything is already granted', async () => {
      await expect(service.requestAccess(mint(), ['ticket:aaaa1111'], undefined)).resolves.toMatchObject({
        decision: 'granted',
      });
      expect(bridge.publishContextAccessQuestion).not.toHaveBeenCalled();
    });

    it('denies in deny-mode sessions without asking', async () => {
      const result = await service.requestAccess(mint({ accessMode: 'deny' }), ['ticket:bbbb2222'], undefined);

      expect(result.decision).toBe('denied');
      expect(bridge.publishContextAccessQuestion).not.toHaveBeenCalled();
    });

    it('auto-grants for the session in auto-approval sessions without asking', async () => {
      const record = mint({ accessMode: 'auto' });
      const result = await service.requestAccess(record, ['ticket:bbbb2222'], undefined);

      expect(result.decision).toBe('granted');
      expect(bridge.publishContextAccessQuestion).not.toHaveBeenCalled();
      expect(tickets.isGranted(mint({ accessMode: 'auto' }), 'ticket', 'bbbb2222')).toBe(true);
    });

    it('asks the user with titles and applies an "once" decision to this ticket only', async () => {
      const record = mint();

      bridge.requestControllerContext.mockResolvedValue({
        ok: true,
        items: [{ kind: 'ticket', sha: 'bbbb2222ffff', title: 'Billing export' }],
      });
      bridge.publishContextAccessQuestion.mockImplementation((_record, requestId) => {
        setImmediate(() => service.decideAccess('agent-1', requestId, 'once'));
      });

      const result = await service.requestAccess(record, ['ticket:bbbb2222'], 'Need billing rules');

      expect(bridge.publishContextAccessQuestion).toHaveBeenCalledWith(
        record,
        expect.stringMatching(/^ctx_/),
        expect.stringContaining('ticket bbbb2222 "Billing export"'),
        [{ kind: 'ticket', sha: 'bbbb2222' }],
      );
      expect(bridge.publishContextAccessQuestion.mock.calls[0][2]).toContain('Reason: Need billing rules');
      expect(result.decision).toBe('granted');
      expect(tickets.isGranted(record, 'ticket', 'bbbb2222')).toBe(true);
      expect(tickets.isGranted(mint(), 'ticket', 'bbbb2222')).toBe(false);
    });

    it('returns pending when nobody answers in time and applies a late decision', async () => {
      const record = mint();

      bridge.requestControllerContext.mockResolvedValue({ ok: true, items: [] });

      const pending = await service.requestAccess(record, ['knowledge:eeee5555'], undefined);

      expect(pending.decision).toBe('pending');
      service.decideAccess('agent-1', pending.requestId, 'always');

      await expect(service.accessStatus(record, pending.requestId)).resolves.toMatchObject({ decision: 'granted' });
      expect(tickets.isGranted(mint(), 'knowledge', 'eeee5555')).toBe(true);
    });

    it('reports denials', async () => {
      const record = mint();

      bridge.requestControllerContext.mockResolvedValue({ ok: true, items: [] });
      bridge.publishContextAccessQuestion.mockImplementation((_record, requestId) => {
        setImmediate(() => service.decideAccess('agent-1', requestId, 'reject'));
      });

      await expect(service.requestAccess(record, ['ticket:ffff6666'], undefined)).resolves.toMatchObject({
        decision: 'denied',
      });
      expect(tickets.isGranted(record, 'ticket', 'ffff6666')).toBe(false);
    });

    it('does not expose requests of other tickets', async () => {
      const record = mint();
      const other = mint();

      bridge.requestControllerContext.mockResolvedValue({ ok: true, items: [] });
      const pending = await service.requestAccess(record, ['ticket:abab1212'], undefined);

      await expect(service.accessStatus(other, pending.requestId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
