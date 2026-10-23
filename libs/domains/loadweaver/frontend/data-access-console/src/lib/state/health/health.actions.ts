import { createAction, props } from '@ngrx/store';

import type { HealthEntity, HealthHistory, HealthHistoryQuery } from '../../types/health.types';

export const loadHealthTree = createAction(
  '[ConsoleHealth] Load Tree',
  props<{ project?: string; silent?: boolean }>(),
);
export const loadHealthTreeSuccess = createAction(
  '[ConsoleHealth] Load Tree Success',
  props<{ entities: HealthEntity[] }>(),
);
export const loadHealthTreeFailure = createAction('[ConsoleHealth] Load Tree Failure', props<{ error: string }>());

/** One entity and its descendants (`root`). */
export const loadHealthEntity = createAction('[ConsoleHealth] Load Entity', props<{ key: string; silent?: boolean }>());
export const loadHealthEntitySuccess = createAction(
  '[ConsoleHealth] Load Entity Success',
  props<{ key: string; entities: HealthEntity[] }>(),
);
export const loadHealthEntityFailure = createAction(
  '[ConsoleHealth] Load Entity Failure',
  props<{ key: string; error: string }>(),
);

export const loadHealthHistory = createAction('[ConsoleHealth] Load History', props<HealthHistoryQuery>());
export const loadHealthHistorySuccess = createAction(
  '[ConsoleHealth] Load History Success',
  props<{ history: HealthHistory }>(),
);
export const loadHealthHistoryFailure = createAction(
  '[ConsoleHealth] Load History Failure',
  props<{ key: string; error: string }>(),
);
