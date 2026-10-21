import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentHandoffsApiService } from '../services/agent-handoffs-api.service';

import { AgentsHandoffsController } from './agents-handoffs.controller';

describe('AgentsHandoffsController', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const targetAgentId = '22222222-2222-4222-8222-222222222222';
  const handoffId = '33333333-3333-4333-8333-333333333333';
  const auth = 'Bearer good-token';
  let contextMcp: { verifyAgentToken: jest.Mock };
  let handoffs: {
    agents: jest.Mock;
    create: jest.Mock;
    get: jest.Mock;
    respond: jest.Mock;
    peerProfile: jest.Mock;
    updateProfile: jest.Mock;
  };
  let controller: AgentsHandoffsController;

  beforeEach(() => {
    contextMcp = {
      verifyAgentToken: jest.fn(async (id: string, token: string) => id === agentId && token === 'good-token'),
    };
    handoffs = {
      agents: jest.fn().mockResolvedValue({ agents: [] }),
      create: jest.fn().mockResolvedValue({ handoff: { id: handoffId } }),
      get: jest.fn().mockResolvedValue({ handoff: { id: handoffId } }),
      respond: jest.fn().mockResolvedValue({ handoff: { id: handoffId } }),
      peerProfile: jest.fn().mockResolvedValue({ id: targetAgentId, name: 'Reviewer' }),
      updateProfile: jest.fn().mockResolvedValue({ id: agentId, name: 'Backend' }),
    };
    controller = new AgentsHandoffsController(
      contextMcp as unknown as AgentContextMcpService,
      handoffs as unknown as AgentHandoffsApiService,
    );
  });

  it('bypasses user authentication guards (agent token auth instead)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AgentsHandoffsController)).toBe(true);
    expect(Reflect.getMetadata('public', AgentsHandoffsController)).toBe(true);
  });

  it('rejects invalid agent credentials before forwarding anything', async () => {
    await expect(controller.agents(agentId, 'Bearer wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.create({}, undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.respond(handoffId, {}, 'not-a-uuid', auth)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(handoffs.agents).not.toHaveBeenCalled();
    expect(handoffs.create).not.toHaveBeenCalled();
    expect(handoffs.respond).not.toHaveBeenCalled();
  });

  it('delegates with the authenticated agent id and parsed input', async () => {
    await controller.agents(agentId, auth);
    await controller.create({ targetAgentId, title: ' Review ', message: 'Check', agentId: 'spoofed' }, agentId, auth);
    await controller.get(handoffId.toUpperCase(), agentId, auth);
    await controller.respond(handoffId, { status: 'completed', response: 'Done' }, agentId, auth);

    expect(handoffs.agents).toHaveBeenCalledWith(agentId);
    expect(handoffs.create).toHaveBeenCalledWith(agentId, { targetAgentId, title: 'Review', message: 'Check' });
    expect(handoffs.get).toHaveBeenCalledWith(agentId, handoffId);
    expect(handoffs.respond).toHaveBeenCalledWith(agentId, handoffId, { status: 'completed', response: 'Done' });
  });

  it('serves peer profiles and updates only the authenticated agent profile', async () => {
    await controller.peerProfile(targetAgentId.toUpperCase(), agentId, auth);
    await controller.updateProfile({ profile: ' Owns the API ', agentId: targetAgentId }, agentId, auth);

    expect(handoffs.peerProfile).toHaveBeenCalledWith(agentId, targetAgentId);
    expect(handoffs.updateProfile).toHaveBeenCalledWith(agentId, { profile: 'Owns the API' });

    await expect(controller.peerProfile('../x', agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.updateProfile({ profile: 5 }, agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.updateProfile({ profile: 'x' }, agentId, 'Bearer wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('validates input and ids', async () => {
    await expect(controller.create({ targetAgentId, title: 'x' }, agentId, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.get('../other', agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
    expect(handoffs.create).not.toHaveBeenCalled();
    expect(handoffs.get).not.toHaveBeenCalled();
  });
});
