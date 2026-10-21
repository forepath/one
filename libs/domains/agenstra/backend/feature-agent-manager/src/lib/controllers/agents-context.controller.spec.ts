import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { AgentContextApiService } from '../services/agent-context-api.service';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import { AgentToolCallsService } from '../services/agent-tool-calls.service';

import { AgentsContextController } from './agents-context.controller';

describe('AgentsContextController', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const auth = 'Bearer good-token';
  let contextMcp: { verifyAgentToken: jest.Mock };
  let tickets: AgentContextTicketsService;
  let api: { list: jest.Mock; search: jest.Mock; get: jest.Mock; requestAccess: jest.Mock; accessStatus: jest.Mock };
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
    controller = new AgentsContextController(
      contextMcp as unknown as AgentContextMcpService,
      tickets,
      api as unknown as AgentContextApiService,
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
    expect(Reflect.getMetadata('public', AgentsContextController)).toBe(true);
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

    it('keeps ask tickets unaffected', async () => {
      await expect(guarded.get(ticket, 'item:1', agentId, auth)).resolves.toEqual({ content: 'x' });
    });
  });
});
