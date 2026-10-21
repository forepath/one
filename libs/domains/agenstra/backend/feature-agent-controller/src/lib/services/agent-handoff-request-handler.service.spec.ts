import { AGENT_HANDOFF_REQUEST_EVENT } from '@forepath/agenstra/shared/util-opencode-config';
import { NotFoundException } from '@nestjs/common';
import type { Socket as ClientSocket } from 'socket.io-client';

import { AgentHandoffRequestHandlerService } from './agent-handoff-request-handler.service';
import type { AgentHandoffsService } from './agent-handoffs.service';

describe('AgentHandoffRequestHandlerService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  const handoffId = '00000000-0000-4000-8000-000000000040';
  const chatId = '00000000-0000-4000-8000-000000000050';
  let handoffs: {
    listAgentsForAgent: jest.Mock;
    createForAgent: jest.Mock;
    getForAgent: jest.Mock;
    respondForAgent: jest.Mock;
  };
  let handler: AgentHandoffRequestHandlerService;

  beforeEach(() => {
    handoffs = {
      listAgentsForAgent: jest.fn().mockResolvedValue([{ id: 'b', name: 'B' }]),
      createForAgent: jest.fn().mockResolvedValue({ id: handoffId }),
      getForAgent: jest.fn().mockResolvedValue({ id: handoffId }),
      respondForAgent: jest.fn().mockResolvedValue({ id: handoffId, status: 'completed' }),
    };
    handler = new AgentHandoffRequestHandlerService(handoffs as unknown as AgentHandoffsService);
  });

  it('answers on the manager socket with the workspace bound to the connection', async () => {
    const remote = { on: jest.fn() };
    const ack = jest.fn();

    handler.attach(remote as unknown as ClientSocket, clientId);

    const [event, listener] = remote.on.mock.calls[0];

    expect(event).toBe(AGENT_HANDOFF_REQUEST_EVENT);
    listener({ op: 'agents', agentId, clientId: 'spoofed' }, ack);
    await new Promise((resolve) => setImmediate(resolve));

    expect(handoffs.listAgentsForAgent).toHaveBeenCalledWith(clientId, agentId);
    expect(ack).toHaveBeenCalledWith({ ok: true, agents: [{ id: 'b', name: 'B' }] });
  });

  it('dispatches every operation with typed input only', async () => {
    await handler.handle(clientId, {
      op: 'create',
      agentId: agentId.toUpperCase(),
      sourceChatId: chatId,
      sourceModel: 'openai/gpt-5',
      input: { targetAgentId: ' b ', title: 'T', message: 'M', model: 7, sourceAgentId: 'x' },
    });
    await handler.handle(clientId, { op: 'get', agentId, handoffId });
    await handler.handle(clientId, {
      op: 'respond',
      agentId,
      handoffId,
      input: { status: 'failed', response: 'No access' },
    });

    expect(handoffs.createForAgent).toHaveBeenCalledWith(
      clientId,
      agentId,
      chatId,
      {
        targetAgentId: 'b',
        title: 'T',
        message: 'M',
      },
      'openai/gpt-5',
    );
    expect(handoffs.getForAgent).toHaveBeenCalledWith(clientId, agentId, handoffId);
    expect(handoffs.respondForAgent).toHaveBeenCalledWith(clientId, agentId, handoffId, {
      status: 'failed',
      response: 'No access',
    });
  });

  it('rejects malformed requests', async () => {
    await expect(handler.handle(clientId, { op: 'delete', agentId })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
    await expect(handler.handle(clientId, { op: 'agents', agentId: 'nope' })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
    await expect(handler.handle(clientId, { op: 'get', agentId, handoffId: '../x' })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 404 }),
    );
    await expect(
      handler.handle(clientId, { op: 'respond', agentId, handoffId, input: { status: 'done', response: 'x' } }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, status: 400 }));
    await expect(handler.handle(clientId, { op: 'bindSource', agentId, handoffId, chatId })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
    await expect(
      handler.handle(clientId, { op: 'create', agentId, input: { targetAgentId: 'b', title: 't', message: 'm' } }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, status: 400, error: 'The requesting chat is unknown' }));
    expect(handoffs.createForAgent).not.toHaveBeenCalled();
    await expect(handler.handle(clientId, null)).resolves.toEqual(expect.objectContaining({ ok: false }));
  });

  it('maps HTTP errors to their status and hides unexpected errors', async () => {
    handoffs.getForAgent.mockRejectedValueOnce(new NotFoundException('Handoff not found'));
    handoffs.getForAgent.mockRejectedValueOnce(new Error('db exploded'));

    await expect(handler.handle(clientId, { op: 'get', agentId, handoffId })).resolves.toEqual({
      ok: false,
      error: 'Handoff not found',
      status: 404,
    });
    await expect(handler.handle(clientId, { op: 'get', agentId, handoffId })).resolves.toEqual({
      ok: false,
      error: 'Handoff request failed',
      status: 500,
    });
  });
});
