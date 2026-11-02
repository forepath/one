import { createAction, props } from '@ngrx/store';

import type { UsageQuery, UsageReport } from '../../types/usage.types';

export const loadUsage = createAction('[ConsoleUsage] Load', props<{ query: UsageQuery }>());
export const loadUsageSuccess = createAction(
  '[ConsoleUsage] Load Success',
  props<{ query: UsageQuery; report: UsageReport }>(),
);
export const loadUsageFailure = createAction(
  '[ConsoleUsage] Load Failure',
  props<{ query: UsageQuery; error: string }>(),
);
