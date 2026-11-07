import { ChatPlanActionType, ChatPlanPhase, ChatPlanStatus } from '../entities/chat-plan.enums';
import { ChatPlanEntity } from '../entities/chat-plan.entity';

import { ChatPlanActivityService } from './chat-plan-activity.service';
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
  let chatPlanActivity: jest.Mocked<Pick<ChatPlanActivityService, 'append'>>;
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
    chatPlanActivity = { append: jest.fn().mockResolvedValue(undefined) };
    service = new ChatPlanOrchestratorService(
      chatPlanService as unknown as ChatPlanService,
      chatPlanChatSync as unknown as ChatPlanChatSyncService,
      remoteAgents as unknown as RemoteAgentsSessionService,
      chatPlanActivity as unknown as ChatPlanActivityService,
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

  it('logs the agent draft once a planning turn produced plan content', async () => {
    remoteAgents.sendChatStreaming.mockResolvedValueOnce({
      text: '',
      planTurnStatus: { status: 'ready', planMarkdown: '# Plan', summary: 'title' },
    });

    await (service as unknown as { runExplore(planId: string): Promise<void> }).runExplore(plan.id);

    expect(chatPlanActivity.append).toHaveBeenCalledWith(
      plan.id,
      ChatPlanActionType.DRAFT_UPDATED,
      expect.objectContaining({ type: 'ai' }),
      { phase: ChatPlanPhase.READY, ready: true },
    );
  });

  describe('execute', () => {
    const readyPlan = {
      ...plan,
      status: ChatPlanStatus.READY,
      phase: ChatPlanPhase.READY,
      planMarkdown: '# Old plan\n- old step',
      executionStartedAt: null,
      lastEditedAt: null,
    } as ChatPlanEntity;
    const runExecute = (actorUserId?: string) =>
      (
        service as unknown as {
          runExecute(planId: string, correlationId?: string, actorUserId?: string | null): Promise<void>;
        }
      ).runExecute(plan.id, 'corr-1', actorUserId);

    it('executes the version saved at the moment execution started, marked as authoritative user edit', async () => {
      const editedPlan = {
        ...readyPlan,
        planMarkdown: '# Edited plan\n- new step',
        lastEditedAt: new Date(),
        status: ChatPlanStatus.EXECUTING,
      } as ChatPlanEntity;

      // Loaded before the transition (old version), re-read after it (user edit saved in between).
      chatPlanService.getEntityOrThrow.mockResolvedValueOnce(readyPlan).mockResolvedValueOnce(editedPlan);
      remoteAgents.sendChatStreaming.mockResolvedValue({ text: 'done' });

      await runExecute('user-1');

      expect(chatPlanService.updateIfStatus).toHaveBeenNthCalledWith(
        1,
        plan.id,
        [ChatPlanStatus.READY, ChatPlanStatus.CANCELLED, ChatPlanStatus.FAILED],
        expect.objectContaining({ status: ChatPlanStatus.EXECUTING, executionStartedAt: expect.any(Date) }),
      );

      const sent = remoteAgents.sendChatStreaming.mock.calls[0]?.[0];
      const message = sent?.message as string;

      // Visible chat (writable, interactive permissions) — never the explore-only hidden plan session.
      expect(sent).toEqual(
        expect.objectContaining({ chatId: plan.chatId, ephemeral: false, suppressUserMessage: true, continue: true }),
      );
      expect(sent?.resumeSessionSuffix).toBeUndefined();
      expect(message).toContain('# Edited plan');
      expect(message).not.toContain('old step');
      expect(message).toContain('supersedes every earlier draft of this plan');
      expect(message).toContain('The user edited this plan directly');
      expect(chatPlanActivity.append).toHaveBeenCalledWith(
        plan.id,
        ChatPlanActionType.EXECUTION_STARTED,
        { type: 'human', userId: 'user-1' },
        expect.objectContaining({ editedByUser: true }),
      );
      expect(chatPlanActivity.append).toHaveBeenCalledWith(
        plan.id,
        ChatPlanActionType.EXECUTED,
        expect.objectContaining({ type: 'ai' }),
        {},
      );
    });

    it('does not run when the conditional transition lost (already executing)', async () => {
      chatPlanService.getEntityOrThrow.mockResolvedValueOnce(readyPlan);
      chatPlanService.updateIfStatus.mockResolvedValueOnce(false);

      await runExecute();

      expect(remoteAgents.sendChatStreaming).not.toHaveBeenCalled();
      expect(chatPlanActivity.append).not.toHaveBeenCalled();
    });

    it('keeps the first execution time on a retry of a failed execution', async () => {
      const firstRun = new Date('2026-10-01T00:00:00Z');
      const failed = { ...readyPlan, status: ChatPlanStatus.FAILED, executionStartedAt: firstRun } as ChatPlanEntity;

      chatPlanService.getEntityOrThrow.mockResolvedValue(failed);
      remoteAgents.sendChatStreaming.mockResolvedValue({ text: 'done' });

      await runExecute();

      expect(chatPlanService.updateIfStatus).toHaveBeenNthCalledWith(
        1,
        plan.id,
        expect.any(Array),
        expect.objectContaining({ executionStartedAt: firstRun }),
      );
    });
  });

  it('refines the draft as stored after the transition, noting a user edit', async () => {
    const before = { ...plan, status: ChatPlanStatus.READY, phase: ChatPlanPhase.READY, planMarkdown: '# v1' };
    const after = {
      ...before,
      status: ChatPlanStatus.REFINING,
      planMarkdown: '# v2 by user',
      lastEditedAt: new Date(),
    };

    chatPlanService.getEntityOrThrow
      .mockResolvedValueOnce(before as ChatPlanEntity)
      .mockResolvedValueOnce(after as ChatPlanEntity)
      .mockResolvedValue(after as ChatPlanEntity);
    remoteAgents.sendChatStreaming.mockResolvedValue({
      text: '',
      planTurnStatus: { status: 'ready', planMarkdown: '# v3', summary: 's' },
    });

    await (
      service as unknown as {
        runRefine(planId: string, message: string, ctx?: unknown, actorUserId?: string | null): Promise<void>;
      }
    ).runRefine(plan.id, 'Add tests', undefined, 'user-1');

    const message = remoteAgents.sendChatStreaming.mock.calls[0]?.[0].message as string;

    expect(message).toContain('# v2 by user');
    expect(message).toContain('The user edited this plan directly');
    expect(chatPlanActivity.append).toHaveBeenCalledWith(
      plan.id,
      ChatPlanActionType.REFINE_REQUESTED,
      { type: 'human', userId: 'user-1' },
      { instructions: 'Add tests' },
    );
  });

  it('keeps the platform-resolved initiative context of a story plan when the chat refines it', async () => {
    const initiativeContext = {
      initiativeContexts: ['## Initiative'],
      initiativeContextRefs: [{ kind: 'initiative' as const, sha: 'a'.repeat(40) }],
    };
    const before = {
      ...plan,
      status: ChatPlanStatus.READY,
      phase: ChatPlanPhase.READY,
      planMarkdown: '# v1',
      contextInjection: { ticketShas: ['t'], ...initiativeContext },
    };

    chatPlanService.getEntityOrThrow.mockResolvedValue(before as unknown as ChatPlanEntity);
    remoteAgents.sendChatStreaming.mockResolvedValue({
      text: '',
      planTurnStatus: { status: 'ready', planMarkdown: '# v2', summary: 's' },
    });

    await (
      service as unknown as {
        runRefine(planId: string, message: string, ctx?: unknown, actorUserId?: string | null): Promise<void>;
      }
    ).runRefine(plan.id, 'Shorter', { includeWorkspace: true }, 'user-1');

    expect(chatPlanService.updateIfStatus).toHaveBeenCalledWith(
      plan.id,
      [ChatPlanStatus.READY],
      expect.objectContaining({ contextInjection: { includeWorkspace: true, ...initiativeContext } }),
    );
  });
});
