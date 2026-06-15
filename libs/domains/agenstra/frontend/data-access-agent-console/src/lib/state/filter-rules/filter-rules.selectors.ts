import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { FilterRulesState } from './filter-rules.reducer';

export const selectFilterRulesState = createFeatureSelector<FilterRulesState>('filterRules');

export const selectFilterRules = createSelector(selectFilterRulesState, (s) => s.rules);

export const selectFilterRulesLoading = createSelector(selectFilterRulesState, (s) => s.loading);

export const selectFilterRulesError = createSelector(selectFilterRulesState, (s) => s.error);

export const selectFilterRulesSaving = createSelector(selectFilterRulesState, (s) => s.saving);

export const selectFilterRulesDeleting = createSelector(selectFilterRulesState, (s) => s.deleting);
