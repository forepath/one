import { NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { AgentClientToolsApiService } from '../services/agent-client-tools-api.service';
import type { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import type { AgentToolCallsService } from '../services/agent-tool-calls.service';

import { AgentsContextClientToolsController } from './agents-context-client-tools.controller';

describe('AgentsContextClientToolsController', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const otherAgentId = '22222222-2222-4222-8222-222222222222';
  const auth = 'Bearer good-token';
  let tickets: AgentContextTicketsService;
  let api: AgentClientToolsApiService;
  let toolCalls: { claim: jest.Mock };
  let controller: AgentsContextClientToolsController;
  let ticket: string;

  beforeEach(() => {
    tickets = new AgentContextTicketsService();
    api = new AgentClientToolsApiService();
    api.registerBridge({
      requestControllerClientTool: jest.fn(async () => ({
        ok: true as const,
        status: 'completed' as const,
        output: 'sunny',
      })),
    });
    toolCalls = { claim: jest.fn().mockResolvedValue(true) };
    controller = new AgentsContextClientToolsController(
      {
        verifyAgentToken: jest.fn(
          async (id: string, token: string) => token === 'good-token' && [agentId, otherAgentId].includes(id),
        ),
      } as unknown as AgentContextMcpService,
      tickets,
      api,
      toolCalls as unknown as AgentToolCallsService,
    );
    ticket = tickets.mint({
      agentId,
      sessionKey: 'chat-1',
      socketId: 's1',
      chatId: 'chat-1',
      ephemeral: false,
      correlationId: 'c1',
      accessMode: 'ask',
      items: [],
      clientTools: [{ name: 'get_weather' }],
    }).ticket;
  });

  it('runs a call proven by the agent tool call (also in visible chats)', async () => {
    await expect(
      controller.call(ticket, { name: 'get_weather', arguments: { city: 'Berlin' } }, agentId, auth),
    ).resolves.toEqual(expect.objectContaining({ status: 'completed', output: 'sunny' }));

    expect(toolCalls.claim).toHaveBeenCalledWith(agentId, ticket, 'agenstra_client_tools_call', expect.any(Function));
    const matches = toolCalls.claim.mock.calls[0][3] as (input: Record<string, unknown>) => boolean;

    expect(matches({ ticket, name: 'get_weather', arguments: { city: 'Berlin' } })).toBe(true);
    // Same arguments in another key order / as a JSON string still match; anything else does not.
    expect(matches({ ticket, name: 'get_weather', arguments: '{"city":"Berlin"}' })).toBe(true);
    expect(matches({ ticket, name: 'get_weather', arguments: { city: 'Paris' } })).toBe(false);
    expect(matches({ ticket, name: 'other', arguments: { city: 'Berlin' } })).toBe(false);
    expect(matches({ ticket: 'ctx-other', name: 'get_weather', arguments: { city: 'Berlin' } })).toBe(false);
  });

  it('rejects calls without a matching agent tool call (forged from inside the worker)', async () => {
    toolCalls.claim.mockResolvedValue(false);

    await expect(controller.call(ticket, { name: 'get_weather', arguments: {} }, agentId, auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.wait(ticket, 'call_x', agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails closed without the tool call tracker', async () => {
    const unguarded = new AgentsContextClientToolsController(
      { verifyAgentToken: jest.fn().mockResolvedValue(true) } as unknown as AgentContextMcpService,
      tickets,
      api,
    );

    await expect(unguarded.call(ticket, { name: 'get_weather', arguments: {} }, agentId, auth)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('requires the agent token and a ticket of the same agent with client tools', async () => {
    await expect(
      controller.call(ticket, { name: 'get_weather', arguments: {} }, agentId, 'Bearer bad'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.call(ticket, { name: 'get_weather', arguments: {} }, otherAgentId, auth),
    ).rejects.toBeInstanceOf(NotFoundException);

    const plainTicket = tickets.mint({
      agentId,
      sessionKey: 'chat-1',
      ephemeral: false,
      correlationId: 'c2',
      accessMode: 'ask',
      items: [],
    }).ticket;

    await expect(
      controller.call(plainTicket, { name: 'get_weather', arguments: {} }, agentId, auth),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(toolCalls.claim).not.toHaveBeenCalled();
  });

  it('validates the request body', async () => {
    await expect(controller.call(ticket, { arguments: {} }, agentId, auth)).rejects.toMatchObject({ status: 400 });
    await expect(controller.call(ticket, { name: 'get_weather', arguments: [1] }, agentId, auth)).rejects.toMatchObject(
      {
        status: 400,
      },
    );
  });
});
