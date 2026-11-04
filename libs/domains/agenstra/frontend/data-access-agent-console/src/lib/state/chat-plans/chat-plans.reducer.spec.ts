import type { ChatPlanResponse } from '../container-socket/container-socket.types';

import {
  chatPlanUpsertReceived,
  clearChatPlansError,
  clearSelectedChatPlan,
  loadChatPlan,
  loadChatPlanActivitySuccess,
  loadChatPlans,
  loadChatPlansSuccess,
  loadChatPlanSuccess,
  updateChatPlan,
  updateChatPlanFailure,
  updateChatPlanSuccess,
} from './chat-plans.actions';
import { chatPlansReducer, initialChatPlansState, type ChatPlansState } from './chat-plans.reducer';

function chatPlanFixture(overrides: Partial<ChatPlanResponse> = {}): ChatPlanResponse {
  return {
    id: 'p1',
    clientId: 'c1',
    agentId: 'a1',
    chatId: 'chat-1',
    status: 'ready',
    phase: 'ready',
    sourcePrompt: 'Build login',
    planMarkdown: '# Plan',
    summary: 'Login plan',
    contextInjection: null,
    model: null,
    resumeSessionSuffix: '-plan-p1',
    completionSignalSeen: true,
    failureCode: null,
    failureMessage: null,
    createdByUserId: 'u1',
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: null,
    executionStartedAt: null,
    lastEditedAt: null,
    lastEditedByUserId: null,
    editable: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

const query = { limit: 25, offset: 0 };

function loaded(plans: ChatPlanResponse[] = [chatPlanFixture()]): ChatPlansState {
  let state = chatPlansReducer(initialChatPlansState, loadChatPlans({ clientId: 'c1', agentId: 'a1', query }));

  state = chatPlansReducer(state, loadChatPlansSuccess({ clientId: 'c1', agentId: 'a1', plans, total: plans.length }));

  return state;
}

describe('chatPlansReducer', () => {
  it('loads a page of plans', () => {
    const state = loaded();

    expect(state.plans).toHaveLength(1);
    expect(state.total).toBe(1);
    expect(state.loading).toBe(false);
  });

  it('clears the list when switching to another agent and ignores stale responses', () => {
    let state = loaded();

    state = chatPlansReducer(state, loadChatPlans({ clientId: 'c1', agentId: 'a2', query }));
    expect(state.plans).toEqual([]);

    // Late response of the previous agent.
    state = chatPlansReducer(
      state,
      loadChatPlansSuccess({ clientId: 'c1', agentId: 'a1', plans: [chatPlanFixture()], total: 1 }),
    );
    expect(state.plans).toEqual([]);
    expect(state.loading).toBe(true);
  });

  it('keeps the list while reloading the same agent (search / paging)', () => {
    const state = chatPlansReducer(loaded(), loadChatPlans({ clientId: 'c1', agentId: 'a1', query }));

    expect(state.plans).toHaveLength(1);
  });

  it('opens a plan and merges live upserts into list and opened plan (newer wins)', () => {
    let state = chatPlansReducer(loaded(), loadChatPlan({ clientId: 'c1', agentId: 'a1', planId: 'p1' }));

    state = chatPlansReducer(state, loadChatPlanSuccess({ plan: chatPlanFixture() }));
    expect(state.selectedPlan?.id).toBe('p1');

    const executing = chatPlanFixture({
      status: 'executing',
      editable: false,
      executionStartedAt: '2026-11-01T11:00:00.000Z',
      updatedAt: '2026-11-01T11:00:00.000Z',
    });

    state = chatPlansReducer(state, chatPlanUpsertReceived({ plan: executing }));
    expect(state.selectedPlan?.status).toBe('executing');
    expect(state.plans[0].editable).toBe(false);

    // An older snapshot (out of order) never overwrites the newer one.
    state = chatPlansReducer(state, chatPlanUpsertReceived({ plan: chatPlanFixture() }));
    expect(state.selectedPlan?.status).toBe('executing');
  });

  it('ignores upserts of plans that are neither listed nor opened', () => {
    const state = loaded();

    expect(chatPlansReducer(state, chatPlanUpsertReceived({ plan: chatPlanFixture({ id: 'other' }) }))).toBe(state);
  });

  it('tracks saving, conflicts and success', () => {
    let state = chatPlansReducer(
      loaded(),
      updateChatPlan({ clientId: 'c1', agentId: 'a1', planId: 'p1', dto: { expectedUpdatedAt: 'x' } }),
    );

    expect(state.saving).toBe(true);
    state = chatPlansReducer(state, updateChatPlanFailure({ error: 'changed', conflict: true }));
    expect(state).toMatchObject({ saving: false, error: 'changed', conflict: true });
    state = chatPlansReducer(state, clearChatPlansError());
    expect(state).toMatchObject({ error: null, conflict: false });

    const saved = chatPlanFixture({ planMarkdown: '# New', updatedAt: '2026-11-01T12:00:00.000Z' });

    state = chatPlansReducer(state, updateChatPlanSuccess({ plan: saved }));
    expect(state.saving).toBe(false);
    expect(state.plans[0].planMarkdown).toBe('# New');
  });

  it('stores activity per plan and clears the opened plan', () => {
    let state = chatPlansReducer(
      loaded(),
      loadChatPlanActivitySuccess({
        planId: 'p1',
        activity: [
          {
            id: 'e1',
            planId: 'p1',
            occurredAt: '2026-11-01T10:00:00.000Z',
            actorType: 'human',
            actorUserId: 'u1',
            actorEmail: 'u@example.com',
            actionType: 'CREATED',
            payload: {},
          },
        ],
      }),
    );

    expect(state.activityByPlanId['p1']).toHaveLength(1);
    state = chatPlansReducer(state, loadChatPlanSuccess({ plan: chatPlanFixture() }));
    state = chatPlansReducer(state, clearSelectedChatPlan());
    expect(state.selectedPlan).toBeNull();
  });
});
