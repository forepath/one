import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ChatPlansState } from './chat-plans.reducer';
import type { ChatPlanActivityDto } from './chat-plans.types';

const NO_ACTIVITY: ChatPlanActivityDto[] = [];

export const selectChatPlansState = createFeatureSelector<ChatPlansState>('chatPlans');

export const selectChatPlans = createSelector(selectChatPlansState, (s) => s.plans);

export const selectChatPlansTotal = createSelector(selectChatPlansState, (s) => s.total);

export const selectChatPlansLoading = createSelector(selectChatPlansState, (s) => s.loading);

export const selectSelectedChatPlan = createSelector(selectChatPlansState, (s) => s.selectedPlan);

export const selectSelectedChatPlanLoading = createSelector(selectChatPlansState, (s) => s.selectedPlanLoading);

export const selectChatPlansSaving = createSelector(selectChatPlansState, (s) => s.saving);

export const selectChatPlansError = createSelector(selectChatPlansState, (s) => s.error);

export const selectChatPlansConflict = createSelector(selectChatPlansState, (s) => s.conflict);

export const selectChatPlanActivityLoadingPlanId = createSelector(selectChatPlansState, (s) => s.activityLoadingPlanId);

export const selectChatPlanActivity = (planId: string) =>
  createSelector(selectChatPlansState, (s) => s.activityByPlanId[planId] ?? NO_ACTIVITY);
