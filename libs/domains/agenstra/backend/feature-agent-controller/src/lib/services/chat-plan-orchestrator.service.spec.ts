import { ChatPlanPhase, ChatPlanStatus } from '../entities/chat-plan.enums';
import { ChatPlanEntity } from '../entities/chat-plan.entity';

import { ChatPlanChatSyncService } from './chat-plan-chat-sync.service';
import { ChatPlanOrchestratorService } from './chat-plan-orchestrator.service';
import { ChatPlanService } from './chat-plan.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';

describe('ChatPlanOrchestratorService', () => {
  const plan = {
    id: 'plan-1',
    clientId: 'client-1',
    agentId: 'agent-1',
    chatId: 'chat-1',
    status: ChatPlanStatus.EXPLORING,
    phase: ChatPlanPhase.EXPLORE,
    sourcePrompt: 'Build the feature',
    planMarkdown: null,
    contextInjection: null,
    model: null,
    resumeSessionSuffix: '-plan-plan-1',
  } as ChatPlanEntity;
  let chatPlanService: jest.Mocked<Pick<ChatPlanService, 'getEntityOrThrow' | 'updateIfStatus'>>;
  let chatPlanChatSync: jest.Mocked<Pick<ChatPlanChatSyncService, 'addLiveEvent' | 'emitLiveUpdateByPlanId'>>;
  let remoteAgents: jest.Mocked<Pick<RemoteAgentsSessionService, 'sendChatStreaming'>>;
  let service: ChatPlanOrchestratorService;

  beforeEach(() => {
    chatPlanService = {
      getEntityOrThrow: jest.fn().mockResolvedValue(plan),
      updateIfStatus: jest.fn().mockResolvedValue(true),
    };
    chatPlanChatSync = {
      addLiveEvent: jest.fn(),
      emitLiveUpdateByPlanId: jest.fn().mockResolvedValue(undefined),
    };
    remoteAgents = {
      sendChatStreaming: jest.fn(),
    };
    service = new ChatPlanOrchestratorService(
      chatPlanService as unknown as ChatPlanService,
      chatPlanChatSync as unknown as ChatPlanChatSyncService,
      remoteAgents as unknown as RemoteAgentsSessionService,
    );
  });

  it('repairs invalid explore output before marking a plan ready', async () => {
    remoteAgents.sendChatStreaming.mockResolvedValueOnce({ text: 'No structured plan here' }).mockResolvedValueOnce({
      text: '',
      planTurnStatus: { status: 'ready', planMarkdown: '# Fixed plan', summary: 'fixed' },
    });

    await (service as unknown as { runExplore(planId: string): Promise<void> }).runExplore(plan.id);

    expect(remoteAgents.sendChatStreaming).toHaveBeenCalledTimes(2);
    expect(remoteAgents.sendChatStreaming.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        continue: true,
        message: expect.stringContaining('Repair the response now'),
      }),
    );
    expect(chatPlanService.updateIfStatus).toHaveBeenCalledWith(
      plan.id,
      expect.any(Array),
      expect.objectContaining({ status: ChatPlanStatus.READY, planMarkdown: '# Fixed plan' }),
    );
    expect(chatPlanService.updateIfStatus).not.toHaveBeenCalledWith(
      plan.id,
      expect.any(Array),
      expect.objectContaining({ status: ChatPlanStatus.FAILED }),
    );
  });

  it('fails only after exhausting invalid explore repair attempts', async () => {
    remoteAgents.sendChatStreaming.mockResolvedValue({ text: 'Still no usable plan' });

    await (service as unknown as { runExplore(planId: string): Promise<void> }).runExplore(plan.id);

    expect(remoteAgents.sendChatStreaming).toHaveBeenCalledTimes(3);
    expect(chatPlanService.updateIfStatus).toHaveBeenCalledWith(
      plan.id,
      expect.any(Array),
      expect.objectContaining({
        status: ChatPlanStatus.FAILED,
        failureMessage: 'Plan turn completed without usable plan content',
      }),
    );
  });
});
