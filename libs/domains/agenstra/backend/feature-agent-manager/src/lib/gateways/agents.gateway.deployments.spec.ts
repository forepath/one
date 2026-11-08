import { AGENT_DEPLOYMENT_REQUEST_EVENT } from '@forepath/agenstra/shared/util-opencode-config';
import type { Socket } from 'socket.io';

import type { AgentProviderFactory } from '../providers/agent-provider.factory';
import type { ChatFilterFactory } from '../providers/chat-filter.factory';
import type { OpenCodePtyService } from '../providers/opencode/opencode-pty.service';
import type { AgentsRepository } from '../repositories/agents.repository';
import type { AgentChatSessionsService } from '../services/agent-chat-sessions.service';
import { AgentDeploymentsApiService } from '../services/agent-deployments-api.service';
import type { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import type { AgentMessageEventsService } from '../services/agent-message-events.service';
import type { AgentMessagesService } from '../services/agent-messages.service';
import type { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import type { AgentsService } from '../services/agents.service';
import type { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import type { WorkspaceChangeNotifierService } from '../services/workspace-change-notifier.service';

import { AgentsGateway } from './agents.gateway';

/* eslint-disable @typescript-eslint/no-explicit-any -- private gateway helpers are exercised directly */

describe('AgentsGateway agent deployments bridge', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const otherAgentId = '22222222-2222-4222-8222-222222222222';
  const agent = {
    id: agentId,
    name: 'Agent',
    containerId: 'container-1',
    agentType: 'opencode',
  };
  let gateway: AgentsGateway;
  const runId = '33333333-3333-4333-8333-333333333333';
  const workflowId = '44444444-4444-4444-8444-444444444444';
  let deploymentsApi: AgentDeploymentsApiService;
  let provider: { sendMessage: jest.Mock; getCapabilities: jest.Mock; toParseableStrings: jest.Mock };

  const socket = (id: string, ack: jest.Mock = jest.fn()): Socket & { emitWithAckMock: jest.Mock } => {
    const timeout = jest.fn().mockReturnValue({ emitWithAck: ack });

    return { id, connected: true, emit: jest.fn(), timeout, emitWithAckMock: ack } as unknown as Socket & {
      emitWithAckMock: jest.Mock;
    };
  };

  const login = (s: Socket, id = agentId) => {
    (gateway as any).socketById.set(s.id, s);
    (gateway as any).authenticatedClients.set(s.id, id);
  };

  beforeEach(() => {
    deploymentsApi = new AgentDeploymentsApiService();
    provider = {
      sendMessage: jest.fn().mockResolvedValue(''),
      getCapabilities: jest.fn().mockReturnValue({ supportsStreaming: false }),
      toParseableStrings: jest.fn().mockReturnValue([]),
    };
    gateway = new AgentsGateway(
      { findOne: jest.fn().mockResolvedValue(agent) } as unknown as AgentsService,
      { findById: jest.fn().mockResolvedValue(agent) } as unknown as AgentsRepository,
      {} as DockerService,
      { closeAll: jest.fn() } as unknown as OpenCodePtyService,
      {
        getChatHistory: jest.fn().mockResolvedValue([{ id: 'existing' }]),
        createUserMessage: jest.fn().mockResolvedValue({ id: 'u1' }),
        createAgentMessage: jest.fn().mockResolvedValue({ id: 'a1' }),
      } as unknown as AgentMessagesService,
      { persistEvent: jest.fn() } as unknown as AgentMessageEventsService,
      {
        resolveSessionForChat: jest.fn().mockResolvedValue({ id: 'chat-1', resumeSessionSuffix: '' }),
      } as unknown as AgentChatSessionsService,
      { getProvider: jest.fn().mockReturnValue(provider) } as unknown as AgentProviderFactory,
      { getFiltersByDirection: jest.fn().mockReturnValue([]) } as unknown as ChatFilterFactory,
      new PromptContextComposerService(),
      { consumePendingSummary: jest.fn() } as unknown as AgentSessionHydrationService,
      {
        registerBroadcaster: jest.fn(),
        notifyGitStateMayHaveChanged: jest.fn(),
      } as unknown as AgentGitStateBroadcastService,
      {
        registerIndexBroadcaster: jest.fn(),
        registerFileUpdateBroadcaster: jest.fn(),
        notifyRebuildRequired: jest.fn(),
      } as unknown as WorkspaceChangeNotifierService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      deploymentsApi,
    );
    gateway.onModuleInit();
  });

  it('forwards deployment requests only to sockets logged into the calling agent', async () => {
    const foreign = socket('foreign', jest.fn().mockResolvedValue({ ok: true, workflows: [{ id: 'x' }] }));
    const own = socket('own', jest.fn().mockResolvedValue({ ok: true, workflows: [] }));

    login(foreign, otherAgentId);
    login(own);

    await expect(deploymentsApi.listWorkflows(agentId)).resolves.toEqual({ workflows: [] });
    expect(foreign.emitWithAckMock).not.toHaveBeenCalled();
    expect(own.emitWithAckMock).toHaveBeenCalledWith(AGENT_DEPLOYMENT_REQUEST_EVENT, { op: 'listWorkflows', agentId });
  });

  it('uses the longer deployment ack timeout (the controller calls the CI/CD provider)', async () => {
    const own = socket('own', jest.fn().mockResolvedValue({ ok: true, runs: [] }));

    login(own);
    await deploymentsApi.listRuns(agentId);

    expect((own.timeout as jest.Mock).mock.calls[0][0]).toBeGreaterThan(15_000);
  });

  it('falls through to the next socket for reads', async () => {
    const broken = socket('broken', jest.fn().mockRejectedValue(new Error('timeout')));
    const healthy = socket('healthy', jest.fn().mockResolvedValue({ ok: true, run: { id: runId }, jobs: [] }));

    login(broken);
    login(healthy);

    await expect(deploymentsApi.getRun(agentId, runId)).resolves.toEqual({ run: { id: runId }, jobs: [] });
    expect(healthy.emitWithAckMock).toHaveBeenCalled();
  });

  it('sends mutations to a single socket so a slow ack cannot apply them twice', async () => {
    const slow = socket('slow', jest.fn().mockRejectedValue(new Error('timeout')));
    const second = socket('second', jest.fn().mockResolvedValue({ ok: true, run: { id: runId } }));
    const source = { kind: 'chat' as const };

    login(slow);
    login(second);

    await expect(
      deploymentsApi.requestController({ op: 'trigger', agentId, workflowId, input: {}, source }),
    ).resolves.toMatchObject({ ok: false, status: 503 });
    await expect(deploymentsApi.requestController({ op: 'cancelRun', agentId, runId, source })).resolves.toMatchObject({
      ok: false,
      status: 503,
    });
    await expect(
      deploymentsApi.createWorkflow(agentId, { connectionId: workflowId, name: 'Deploy', repository: 'acme/app' }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(deploymentsApi.updateWorkflow(agentId, workflowId, { enabled: false })).rejects.toMatchObject({
      status: 503,
    });
    await expect(deploymentsApi.deleteWorkflow(agentId, workflowId)).rejects.toMatchObject({ status: 503 });
    // History syncs call the provider and are throttled: one socket only, too.
    await expect(deploymentsApi.syncWorkflow(agentId, workflowId)).rejects.toMatchObject({ status: 503 });
    expect(slow.emitWithAckMock).toHaveBeenCalledTimes(6);
    expect(second.emitWithAckMock).not.toHaveBeenCalled();
  });

  it('lets workflow lookups and connection options fall through like other reads', async () => {
    const broken = socket('broken', jest.fn().mockRejectedValue(new Error('timeout')));
    const healthy = socket(
      'healthy',
      jest.fn().mockResolvedValue({ ok: true, workflow: { id: workflowId }, connections: [] }),
    );

    login(broken);
    login(healthy);

    await expect(deploymentsApi.describeWorkflow(agentId, workflowId)).resolves.toEqual({ id: workflowId });
    await expect(deploymentsApi.listConnections(agentId)).resolves.toEqual({ connections: [] });
    expect(healthy.emitWithAckMock).toHaveBeenCalledTimes(2);
  });

  it('reports a missing controller connection as unavailable', async () => {
    await expect(deploymentsApi.listWorkflows(agentId)).rejects.toMatchObject({ status: 503 });
  });
});
