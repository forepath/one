import { createAction, props } from '@ngrx/store';

import type { AdminOverviewParams, AdminOverviewResponse } from './admin-overview.types';

export const loadAdminOverview = createAction('[AdminOverview] Load', props<{ params: AdminOverviewParams }>());
export const loadAdminOverviewSuccess = createAction(
  '[AdminOverview] Load Success',
  props<{ overview: AdminOverviewResponse }>(),
);
export const loadAdminOverviewFailure = createAction('[AdminOverview] Load Failure', props<{ error: string }>());
