import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AgentsGateway } from '../gateways/agents.gateway';
import { OpenCodeRuntimeService } from '../providers/opencode/opencode-runtime.service';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentContextApiService } from '../services/agent-context-api.service';
import { AgentContextChangesService } from '../services/agent-context-changes.service';
import { AgentDeploymentActionsService } from '../services/agent-deployment-actions.service';

import { AgentsPermissionsController } from './agents-permissions.controller';

describe('AgentsPermissionsController', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  let agentsRepository: { findById: jest.Mock };
  let runtime: { replyPermission: jest.Mock; replyQuestion: jest.Mock };
  let gateway: { publishInteractionAnswered: jest.Mock };
  let contextApi: { decideAccess: jest.Mock };
  let contextChanges: { decide: jest.Mock };
  let deploymentActions: { decide: jest.Mock };
  let controller: AgentsPermissionsController;

  beforeEach(() => {
    agentsRepository = { findById: jest.fn().mockResolvedValue({ id: agentId, containerId: 'container-1' }) };
    runtime = {
      replyPermission: jest.fn().mockResolvedValue(['per_1']),
      replyQuestion: jest.fn().mockResolvedValue(['que_1']),
    };
    gateway = { publishInteractionAnswered: jest.fn() };
    contextApi = { decideAccess: jest.fn().mockReturnValue(['ctx_1']) };
    contextChanges = { decide: jest.fn().mockResolvedValue(['ctx_chg_1']) };
    deploymentActions = { decide: jest.fn().mockResolvedValue(['ctx_dep_1']) };
    controller = new AgentsPermissionsController(
      agentsRepository as unknown as AgentsRepository,
      runtime as unknown as OpenCodeRuntimeService,
      gateway as unknown as AgentsGateway,
      contextApi as unknown as AgentContextApiService,
      contextChanges as unknown as AgentContextChangesService,
      deploymentActions as unknown as AgentDeploymentActionsService,
    );
  });

  it('forwards OpenCode permission replies to the runtime (unchanged behaviour)', async () => {
    await controller.replyPermission(agentId, 'per_1', { reply: 'always', sessionId: 'ses_1' });

    expect(runtime.replyPermission).toHaveBeenCalledWith(agentId, 'container-1', 'per_1', 'always', 'ses_1');
    expect(contextApi.decideAccess).not.toHaveBeenCalled();
    expect(gateway.publishInteractionAnswered).toHaveBeenCalledWith(agentId, ['per_1'], 'Permission per_1: always');
  });

  it('decides context access prompts in the manager without touching OpenCode', async () => {
    await controller.replyPermission(agentId, 'ctx_1', { reply: 'once' });

    expect(contextApi.decideAccess).toHaveBeenCalledWith(agentId, 'ctx_1', 'once');
    expect(runtime.replyPermission).not.toHaveBeenCalled();
    expect(gateway.publishInteractionAnswered).toHaveBeenCalledWith(agentId, ['ctx_1'], 'Context access ctx_1: once');
  });

  it('decides content change prompts in the change service (which marks them answered)', async () => {
    await controller.replyPermission(agentId, 'ctx_chg_1', { reply: 'always' });
    await controller.replyQuestion(agentId, 'ctx_chg_2', { reply: 'reject' });

    expect(contextChanges.decide.mock.calls).toEqual([
      [agentId, 'ctx_chg_1', 'always'],
      [agentId, 'ctx_chg_2', 'reject'],
    ]);
    expect(contextApi.decideAccess).not.toHaveBeenCalled();
    expect(runtime.replyPermission).not.toHaveBeenCalled();
    expect(gateway.publishInteractionAnswered).not.toHaveBeenCalled();
  });

  it('decides deployment action prompts in the deployment actions service (which marks them answered)', async () => {
    await controller.replyPermission(agentId, 'ctx_dep_1', { reply: 'once' });
    await controller.replyQuestion(agentId, 'ctx_dep_2', { answers: ['always'] });

    expect(deploymentActions.decide.mock.calls).toEqual([
      [agentId, 'ctx_dep_1', 'once'],
      [agentId, 'ctx_dep_2', 'always'],
    ]);
    expect(contextChanges.decide).not.toHaveBeenCalled();
    expect(contextApi.decideAccess).not.toHaveBeenCalled();
    expect(runtime.replyPermission).not.toHaveBeenCalled();
    expect(gateway.publishInteractionAnswered).not.toHaveBeenCalled();
  });

  it('reports deployment action replies as unknown when the service is not available', async () => {
    const bare = new AgentsPermissionsController(
      agentsRepository as unknown as AgentsRepository,
      runtime as unknown as OpenCodeRuntimeService,
      gateway as unknown as AgentsGateway,
      contextApi as unknown as AgentContextApiService,
      contextChanges as unknown as AgentContextChangesService,
    );

    await expect(bare.replyPermission(agentId, 'ctx_dep_1', { reply: 'once' })).rejects.toThrow(
      'Unknown or expired deployment action request',
    );
    expect(contextApi.decideAccess).not.toHaveBeenCalled();
  });

  it('works for context prompts even when the worker container is stopped', async () => {
    agentsRepository.findById.mockResolvedValue({ id: agentId, containerId: null });

    await controller.replyPermission(agentId, 'ctx_1', { reply: 'reject' });

    expect(contextApi.decideAccess).toHaveBeenCalledWith(agentId, 'ctx_1', 'reject');
  });

  it('validates agent and reply for context prompts', async () => {
    await expect(
      controller.replyPermission(agentId, 'ctx_1', { reply: 'maybe' as unknown as 'once' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    agentsRepository.findById.mockResolvedValue(null);
    await expect(controller.replyPermission(agentId, 'ctx_1', { reply: 'once' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps unknown context requests to bad request', async () => {
    contextApi.decideAccess.mockImplementation(() => {
      throw new NotFoundException('Unknown or expired context access request');
    });

    await expect(controller.replyPermission(agentId, 'ctx_gone', { reply: 'once' })).rejects.toThrow(
      'Unknown or expired context access request',
    );
  });

  it('maps question-style answers for context prompts to permission replies', async () => {
    await controller.replyQuestion(agentId, 'ctx_1', { answers: ['always'] });
    await controller.replyQuestion(agentId, 'ctx_2', { reply: 'reject' });
    await controller.replyQuestion(agentId, 'ctx_3', { answers: ['something else'] });

    expect(contextApi.decideAccess.mock.calls).toEqual([
      [agentId, 'ctx_1', 'always'],
      [agentId, 'ctx_2', 'reject'],
      [agentId, 'ctx_3', 'reject'],
    ]);
    expect(runtime.replyQuestion).not.toHaveBeenCalled();
  });

  it('forwards regular question replies to the runtime', async () => {
    await controller.replyQuestion(agentId, 'que_1', { answers: ['A'] });

    expect(runtime.replyQuestion).toHaveBeenCalledWith(agentId, 'container-1', 'que_1', ['A'], false, undefined);
  });
});
