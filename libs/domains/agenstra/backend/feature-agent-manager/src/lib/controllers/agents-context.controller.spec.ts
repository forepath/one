import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { AgentContextApiService } from '../services/agent-context-api.service';
import { AgentContextChangesService } from '../services/agent-context-changes.service';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import { AgentToolCallsService } from '../services/agent-tool-calls.service';
import { AgentWorkspaceMountsService } from '../services/agent-workspace-mounts.service';

import { AgentsContextController } from './agents-context.controller';

describe('AgentsContextController', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const auth = 'Bearer good-token';
  let contextMcp: { verifyAgentToken: jest.Mock };
  let tickets: AgentContextTicketsService;
  let api: { list: jest.Mock; search: jest.Mock; get: jest.Mock; requestAccess: jest.Mock; accessStatus: jest.Mock };
  let changes: { parse: jest.Mock; requestChange: jest.Mock; changeStatus: jest.Mock };
  let controller: AgentsContextController;
  let ticket: string;

  beforeEach(() => {
    contextMcp = {
      verifyAgentToken: jest.fn(async (id: string, token: string) => id === agentId && token === 'good-token'),
    };
    tickets = new AgentContextTicketsService();
    api = {
      list: jest.fn().mockReturnValue({ items: [] }),
      search: jest.fn().mockResolvedValue({ items: [] }),
      get: jest.fn().mockResolvedValue({ content: 'x' }),
      requestAccess: jest.fn().mockResolvedValue({ decision: 'granted' }),
      accessStatus: jest.fn().mockResolvedValue({ decision: 'pending' }),
    };
    // Parsing is the real one: the controller derives the tool to match from the parsed operation.
    changes = {
      parse: jest.fn((body: unknown) => AgentContextChangesService.prototype.parse.call({}, body)),
      requestChange: jest.fn().mockResolvedValue({ decision: 'applied' }),
      changeStatus: jest.fn().mockResolvedValue({ decision: 'pending' }),
    };
    controller = new AgentsContextController(
      contextMcp as unknown as AgentContextMcpService,
      tickets,
      api as unknown as AgentContextApiService,
      changes as unknown as AgentContextChangesService,
    );
    ticket = tickets.mint({
      agentId,
      sessionKey: 'chat-1',
      ephemeral: false,
      correlationId: 'corr',
      accessMode: 'ask',
      items: [],
    }).ticket;
  });

  it('bypasses user authentication guards (agent token auth instead)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AgentsContextController)).toBe(true);
    // The removed nest-keycloak-connect `public` metadata is not needed: every guard honours IS_PUBLIC_KEY.
    expect(Reflect.getMetadata('public', AgentsContextController)).toBeUndefined();
  });

  it('accepts the health probe with valid agent credentials only', async () => {
    await expect(controller.health(agentId, auth)).resolves.toBeUndefined();
    await expect(controller.health(agentId, 'Bearer wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.health('not-a-uuid', auth)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.health(agentId, 'Basic good-token')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.health(undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resolves the ticket for the authenticated agent before delegating', async () => {
    await controller.list(ticket, agentId, auth);

    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ ticket, agentId }));
  });

  it('does not serve unknown tickets', async () => {
    await expect(controller.list('ctx-unknown', agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('normalizes search queries', async () => {
    await controller.search(ticket, { query: ' login ', kinds: 'ticket,knowledge', limit: '5' }, agentId, auth);

    expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ ticket }), 'login', ['ticket', 'knowledge'], 5);
    await expect(controller.search(ticket, { kinds: 'secrets' }, agentId, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('passes item refs and access requests through', async () => {
    await controller.get(ticket, 'item:1', agentId, auth);
    await controller.requestAccess(ticket, { refs: ['ticket:abcd'], reason: 'why' }, agentId, auth);
    await controller.accessStatus(ticket, 'ctx_1', agentId, auth);

    expect(api.get).toHaveBeenCalledWith(expect.objectContaining({ ticket }), 'item:1');
    expect(api.requestAccess).toHaveBeenCalledWith(expect.objectContaining({ ticket }), ['ticket:abcd'], 'why');
    expect(api.accessStatus).toHaveBeenCalledWith(expect.objectContaining({ ticket }), 'ctx_1');
  });

  it('passes content changes and change status requests through', async () => {
    const body = { operation: 'ticket.comment', ref: 'ticket:abcd1234', body: 'Done.' };

    await controller.requestChange(ticket, body, agentId, auth);
    await controller.changeStatus(ticket, 'ctx_chg_1', agentId, auth);

    expect(changes.requestChange).toHaveBeenCalledWith(
      expect.objectContaining({ ticket }),
      expect.objectContaining({ request: expect.objectContaining({ operation: 'ticket.comment', body: 'Done.' }) }),
    );
    expect(changes.changeStatus).toHaveBeenCalledWith(expect.objectContaining({ ticket }), 'ctx_chg_1');
  });

  it('rejects content changes of unknown tickets and malformed changes', async () => {
    const body = { operation: 'ticket.comment', ref: 'ticket:abcd1234', body: 'Done.' };

    await expect(controller.requestChange('ctx-unknown', body, agentId, auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      controller.requestChange(ticket, { operation: 'ticket.drop', ref: 'ticket:abcd1234' }, agentId, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.requestChange(ticket, body, agentId, 'Bearer wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(changes.requestChange).not.toHaveBeenCalled();
  });

  describe('workspace mounts', () => {
    let mounts: { mounts: jest.Mock; withEnvironmentMounts: jest.Mock };
    let withMounts: AgentsContextController;

    beforeEach(() => {
      mounts = {
        mounts: jest.fn().mockResolvedValue({ root: '/opt/workspace', readOnly: true, mounts: [] }),
        withEnvironmentMounts: jest.fn(async (_record: unknown, response: unknown) => ({
          ...(response as object),
          enriched: true,
        })),
      };
      withMounts = new AgentsContextController(
        contextMcp as unknown as AgentContextMcpService,
        tickets,
        api as unknown as AgentContextApiService,
        changes as unknown as AgentContextChangesService,
        undefined,
        mounts as unknown as AgentWorkspaceMountsService,
      );
    });

    it('serves mounts for the resolved ticket and normalizes the lookup', async () => {
      await withMounts.mountsOf(ticket, {}, agentId, auth);
      await withMounts.mountsOf(ticket, { resolve: '  /opt/workspace/abc/src ' }, agentId, auth);

      expect(mounts.mounts).toHaveBeenNthCalledWith(1, expect.objectContaining({ ticket, agentId }), undefined);
      expect(mounts.mounts).toHaveBeenNthCalledWith(2, expect.objectContaining({ ticket }), '/opt/workspace/abc/src');
    });

    it('rejects unknown tickets, wrong tokens and malformed lookups', async () => {
      await expect(withMounts.mountsOf('ctx-unknown', {}, agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
      await expect(withMounts.mountsOf(ticket, {}, agentId, 'Bearer wrong')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(withMounts.mountsOf(ticket, { resolve: ['a', 'b'] }, agentId, auth)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(withMounts.mountsOf(ticket, { resolve: 'x'.repeat(1025) }, agentId, auth)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mounts.mounts).not.toHaveBeenCalled();
    });

    it('adds environment mounts to the context list', async () => {
      await expect(withMounts.list(ticket, agentId, auth)).resolves.toEqual({ items: [], enriched: true });
      expect(mounts.withEnvironmentMounts).toHaveBeenCalledWith(expect.objectContaining({ ticket }), { items: [] });
    });

    it('reports mounts as unavailable without the mounts service', async () => {
      await expect(controller.mountsOf(ticket, {}, agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('rejects malformed access request bodies', async () => {
    await expect(controller.requestAccess(ticket, { refs: 'ticket:abcd' }, agentId, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.requestAccess(ticket, null, agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('auto-approval tickets', () => {
    let toolCalls: AgentToolCallsService;
    let guarded: AgentsContextController;
    let autoTicket: string;

    const event = (type: string, payload: Record<string, unknown>) => ({ type, properties: payload });
    const platformTurn = () => {
      toolCalls.observe(agentId, event('message.updated', { info: { id: 'm-root', sessionID: 's', role: 'user' } }));
      toolCalls.observe(
        agentId,
        event('message.part.updated', {
          part: { id: 't', messageID: 'm-root', sessionID: 's', type: 'text', text: `Context ticket: ${autoTicket}` },
        }),
      );
      toolCalls.observe(
        agentId,
        event('message.updated', { info: { id: 'm-answer', sessionID: 's', role: 'assistant', parentID: 'm-root' } }),
      );
    };
    const toolCall = (callID: string, tool: string, input: Record<string, unknown>) =>
      event('message.part.updated', {
        part: {
          id: callID,
          messageID: 'm-answer',
          callID,
          sessionID: 's',
          type: 'tool',
          tool,
          state: { status: 'running', input },
        },
      });

    beforeEach(() => {
      toolCalls = new AgentToolCallsService();
      jest
        .spyOn(toolCalls, 'claim')
        .mockImplementation((agent, ticketId, tool, matches) =>
          AgentToolCallsService.prototype.claim.call(toolCalls, agent, ticketId, tool, matches, 0),
        );
      guarded = new AgentsContextController(
        contextMcp as unknown as AgentContextMcpService,
        tickets,
        api as unknown as AgentContextApiService,
        changes as unknown as AgentContextChangesService,
        toolCalls,
      );
      autoTicket = tickets.mint({
        agentId,
        sessionKey: 'suffix:-task-1',
        ephemeral: true,
        correlationId: 'corr',
        accessMode: 'auto',
        items: [],
      }).ticket;
    });

    it('only serves requests issued as tool calls answering the platform prompt', async () => {
      // A copied ticket used outside such a tool call is unknown.
      await expect(guarded.get(autoTicket, 'ticket:abcd1234', agentId, auth)).rejects.toBeInstanceOf(NotFoundException);

      platformTurn();
      toolCalls.observe(
        agentId,
        toolCall('c1', 'agenstra_context_request_access', { ticket: autoTicket, refs: ['ticket:abcd1234'] }),
      );

      // Different refs than the session asked for: refused; the matching request: served once.
      await expect(
        guarded.requestAccess(autoTicket, { refs: ['ticket:ffff0000'] }, agentId, auth),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(guarded.requestAccess(autoTicket, { refs: ['ticket:abcd1234'] }, agentId, auth)).resolves.toEqual({
        decision: 'granted',
      });
      await expect(
        guarded.requestAccess(autoTicket, { refs: ['ticket:abcd1234'] }, agentId, auth),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(api.requestAccess).toHaveBeenCalledTimes(1);
    });

    it('only applies content changes issued as matching tool calls answering the platform prompt', async () => {
      const body = { operation: 'ticket.comment', ref: 'ticket:abcd1234', body: 'Done.' };

      await expect(guarded.requestChange(autoTicket, body, agentId, auth)).rejects.toBeInstanceOf(NotFoundException);

      platformTurn();
      toolCalls.observe(
        agentId,
        toolCall('c2', 'agenstra_content_ticket_comment', {
          ticket: autoTicket,
          ref: 'ticket:abcd1234',
          body: 'Done.',
        }),
      );

      // Another comment than the tool call carries: refused; the matching one: served once.
      await expect(
        guarded.requestChange(autoTicket, { ...body, body: 'Something else.' }, agentId, auth),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(guarded.requestChange(autoTicket, body, agentId, auth)).resolves.toEqual({ decision: 'applied' });
      await expect(guarded.requestChange(autoTicket, body, agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
      expect(changes.requestChange).toHaveBeenCalledTimes(1);
    });

    it('only serves mount lookups issued as matching tool calls answering the platform prompt', async () => {
      const mounts = { mounts: jest.fn().mockResolvedValue({ mounts: [] }), withEnvironmentMounts: jest.fn() };
      const withMounts = new AgentsContextController(
        contextMcp as unknown as AgentContextMcpService,
        tickets,
        api as unknown as AgentContextApiService,
        changes as unknown as AgentContextChangesService,
        toolCalls,
        mounts as unknown as AgentWorkspaceMountsService,
      );

      await expect(withMounts.mountsOf(autoTicket, {}, agentId, auth)).rejects.toBeInstanceOf(NotFoundException);

      platformTurn();
      toolCalls.observe(agentId, toolCall('c3', 'agenstra_context_mounts', { ticket: autoTicket, resolve: 'docs' }));

      await expect(withMounts.mountsOf(autoTicket, { resolve: 'other' }, agentId, auth)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(withMounts.mountsOf(autoTicket, { resolve: 'docs' }, agentId, auth)).resolves.toEqual({
        mounts: [],
      });
      expect(mounts.mounts).toHaveBeenCalledTimes(1);
    });

    it('keeps ask tickets unaffected', async () => {
      await expect(guarded.get(ticket, 'item:1', agentId, auth)).resolves.toEqual({ content: 'x' });
    });
  });
});
