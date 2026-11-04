import {
  chatPlanActivityActor,
  chatPlanActivityDetail,
  chatPlanActivityLabel,
  chatPlanTableState,
  chatPlanTitle,
  isChatPlanDrafting,
  isChatPlanExecutionLocked,
  isChatPlanRefinable,
} from './chat-plan-board-labels';

describe('chat plan board labels', () => {
  it('titles a plan with its summary, else the original request', () => {
    expect(chatPlanTitle({ summary: ' Login ', sourcePrompt: 'Build login' })).toBe('Login');
    expect(chatPlanTitle({ summary: null, sourcePrompt: 'Build login' })).toBe('Build login');
  });

  it('derives drafting / execution lock / refine availability', () => {
    expect(isChatPlanDrafting('exploring')).toBe(true);
    expect(isChatPlanDrafting('ready')).toBe(false);
    expect(isChatPlanExecutionLocked({ status: 'failed', executionStartedAt: '2026-11-01T00:00:00Z' })).toBe(true);
    expect(isChatPlanExecutionLocked({ status: 'executing', executionStartedAt: null })).toBe(true);
    expect(isChatPlanExecutionLocked({ status: 'cancelled', executionStartedAt: null })).toBe(false);
    expect(isChatPlanRefinable({ status: 'ready', executionStartedAt: null })).toBe(true);
    expect(isChatPlanRefinable({ status: 'cancelled', executionStartedAt: null })).toBe(false);
  });

  it('maps plan states to table tones', () => {
    expect(chatPlanTableState({ status: 'ready', phase: 'ready' }).tone).toBe('success');
    expect(chatPlanTableState({ status: 'ready', phase: 'draft' }).tone).toBe('info');
    expect(chatPlanTableState({ status: 'executed', phase: 'ready' }).icon).toBe('lock-fill');
    expect(chatPlanTableState({ status: 'exploring', phase: 'explore' }).tone).toBe('primary');
  });

  it('labels every activity type and its details', () => {
    for (const type of [
      'CREATED',
      'DRAFT_UPDATED',
      'REFINE_REQUESTED',
      'CONTENT_UPDATED',
      'EXECUTION_STARTED',
      'EXECUTED',
      'FAILED',
      'CANCELLED',
      'RETRY_REQUESTED',
    ]) {
      expect(chatPlanActivityLabel(type)).not.toBe('Unknown activity');
    }

    expect(chatPlanActivityLabel('LATER')).toBe('Unknown activity');
    expect(
      chatPlanActivityDetail({ actionType: 'CONTENT_UPDATED', payload: { fields: ['planMarkdown', 'summary'] } }),
    ).toBe('Plan, Title');
    expect(chatPlanActivityDetail({ actionType: 'REFINE_REQUESTED', payload: { instructions: 'Add tests' } })).toBe(
      'Add tests',
    );
    expect(chatPlanActivityDetail({ actionType: 'EXECUTION_STARTED', payload: { editedByUser: true } })).toBe(
      'Edited version',
    );
    expect(chatPlanActivityActor({ actorEmail: null, actorType: 'ai' })).toBe('Agent');
    expect(chatPlanActivityActor({ actorEmail: 'u@example.com', actorType: 'human' })).toBe('u@example.com');
  });
});
