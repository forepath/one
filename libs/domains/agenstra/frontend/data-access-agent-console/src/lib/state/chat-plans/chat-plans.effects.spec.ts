import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of, throwError } from 'rxjs';
import { take } from 'rxjs/operators';

import { ChatPlansService } from '../../services/chat-plans.service';

import {
  loadChatPlan,
  loadChatPlanActivity,
  loadChatPlanActivitySuccess,
  loadChatPlanFailure,
  loadChatPlans,
  loadChatPlansSuccess,
  loadChatPlanSuccess,
  updateChatPlan,
  updateChatPlanFailure,
  updateChatPlanSuccess,
} from './chat-plans.actions';
import {
  CHAT_PLAN_ACTIVITY_PAGE_SIZE,
  loadChatPlan$,
  loadChatPlanActivity$,
  loadChatPlans$,
  reloadChatPlanActivityAfterUpdate$,
  updateChatPlan$,
} from './chat-plans.effects';
import { initialChatPlansState } from './chat-plans.reducer';
import type { ChatPlanResponse } from '../container-socket/container-socket.types';

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

describe('chat plans effects', () => {
  let actions$: Observable<Action>;
  let service: jest.Mocked<Pick<ChatPlansService, 'listPlans' | 'getPlan' | 'updatePlan' | 'listActivity'>>;
  const query = { search: 'x', state: null, limit: 25, offset: 0 };
  const dto = { planMarkdown: '# New', expectedUpdatedAt: '2026-11-01T10:00:00.000Z' };

  beforeEach(() => {
    service = { listPlans: jest.fn(), getPlan: jest.fn(), updatePlan: jest.fn(), listActivity: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({ initialState: { chatPlans: initialChatPlansState } }),
        { provide: ChatPlansService, useValue: service },
      ],
    });
  });

  const first = (effect: () => Observable<Action>): Promise<Action> =>
    new Promise((resolve) => TestBed.runInInjectionContext(() => effect().pipe(take(1)).subscribe(resolve)));

  it('loads a page of plans', async () => {
    service.listPlans.mockReturnValue(of({ items: [chatPlanFixture()], total: 3 }));
    actions$ = of(loadChatPlans({ clientId: 'c1', agentId: 'a1', query }));

    await expect(first(loadChatPlans$)).resolves.toEqual(
      loadChatPlansSuccess({ clientId: 'c1', agentId: 'a1', plans: [chatPlanFixture()], total: 3 }),
    );
    expect(service.listPlans).toHaveBeenCalledWith('c1', 'a1', query);
  });

  it('loads an opened plan and reports a missing one', async () => {
    service.getPlan.mockReturnValueOnce(of(chatPlanFixture()));
    actions$ = of(loadChatPlan({ clientId: 'c1', agentId: 'a1', planId: 'p1' }));
    await expect(first(loadChatPlan$)).resolves.toEqual(loadChatPlanSuccess({ plan: chatPlanFixture() }));

    service.getPlan.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Plan not found' } })),
    );
    actions$ = of(loadChatPlan({ clientId: 'c1', agentId: 'a1', planId: 'p1' }));
    await expect(first(loadChatPlan$)).resolves.toEqual(loadChatPlanFailure({ planId: 'p1', error: 'Plan not found' }));
  });

  it('saves a plan and flags 409 responses as conflicts', async () => {
    service.updatePlan.mockReturnValueOnce(of(chatPlanFixture({ planMarkdown: '# New' })));
    actions$ = of(updateChatPlan({ clientId: 'c1', agentId: 'a1', planId: 'p1', dto }));
    await expect(first(updateChatPlan$)).resolves.toEqual(
      updateChatPlanSuccess({ plan: chatPlanFixture({ planMarkdown: '# New' }) }),
    );
    expect(service.updatePlan).toHaveBeenCalledWith('c1', 'a1', 'p1', dto);

    service.updatePlan.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { message: 'This plan has been executed and is read-only.' } }),
      ),
    );
    actions$ = of(updateChatPlan({ clientId: 'c1', agentId: 'a1', planId: 'p1', dto }));
    await expect(first(updateChatPlan$)).resolves.toEqual(
      updateChatPlanFailure({ error: 'This plan has been executed and is read-only.', conflict: true }),
    );

    service.updatePlan.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: ['planMarkdown must not be empty'] } })),
    );
    actions$ = of(updateChatPlan({ clientId: 'c1', agentId: 'a1', planId: 'p1', dto }));
    await expect(first(updateChatPlan$)).resolves.toEqual(
      updateChatPlanFailure({ error: 'planMarkdown must not be empty', conflict: false }),
    );
  });

  it('reloads the activity after a saved edit', async () => {
    actions$ = of(updateChatPlanSuccess({ plan: chatPlanFixture() }));

    await expect(first(reloadChatPlanActivityAfterUpdate$)).resolves.toEqual(
      loadChatPlanActivity({ clientId: 'c1', agentId: 'a1', planId: 'p1' }),
    );
  });

  it('loads the activity of a plan', async () => {
    service.listActivity.mockReturnValue(of([]));
    actions$ = of(loadChatPlanActivity({ clientId: 'c1', agentId: 'a1', planId: 'p1' }));

    await expect(first(loadChatPlanActivity$)).resolves.toEqual(
      loadChatPlanActivitySuccess({ planId: 'p1', activity: [] }),
    );
    expect(service.listActivity).toHaveBeenCalledWith('c1', 'a1', 'p1', { limit: CHAT_PLAN_ACTIVITY_PAGE_SIZE });
  });
});
