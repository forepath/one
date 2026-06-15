import { createAction, props } from '@ngrx/store';

import type { CreateFilterRuleDto, FilterRuleResponseDto, UpdateFilterRuleDto } from './filter-rules.types';

export const loadFilterRules = createAction('[Filter Rules] Load');

export const loadFilterRulesBatch = createAction(
  '[Filter Rules] Load Batch',
  props<{ offset: number; accumulatedRules: FilterRuleResponseDto[] }>(),
);

export const loadFilterRulesSuccess = createAction(
  '[Filter Rules] Load Success',
  props<{ rules: FilterRuleResponseDto[] }>(),
);

export const loadFilterRulesFailure = createAction('[Filter Rules] Load Failure', props<{ error: string }>());

export const createFilterRule = createAction('[Filter Rules] Create', props<{ dto: CreateFilterRuleDto }>());

export const createFilterRuleSuccess = createAction(
  '[Filter Rules] Create Success',
  props<{ rule: FilterRuleResponseDto }>(),
);

export const createFilterRuleFailure = createAction('[Filter Rules] Create Failure', props<{ error: string }>());

export const updateFilterRule = createAction(
  '[Filter Rules] Update',
  props<{ id: string; dto: UpdateFilterRuleDto }>(),
);

export const updateFilterRuleSuccess = createAction(
  '[Filter Rules] Update Success',
  props<{ rule: FilterRuleResponseDto }>(),
);

export const updateFilterRuleFailure = createAction('[Filter Rules] Update Failure', props<{ error: string }>());

export const deleteFilterRule = createAction('[Filter Rules] Delete', props<{ id: string }>());

export const deleteFilterRuleSuccess = createAction('[Filter Rules] Delete Success', props<{ id: string }>());

export const deleteFilterRuleFailure = createAction('[Filter Rules] Delete Failure', props<{ error: string }>());

export const clearFilterRulesError = createAction('[Filter Rules] Clear Error');
