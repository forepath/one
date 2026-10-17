import { createAction, props } from '@ngrx/store';

import type { Overview } from '../../types/console.types';

export const loadOverview = createAction('[ConsoleOverview] Load', props<{ project?: string; silent?: boolean }>());
export const loadOverviewSuccess = createAction('[ConsoleOverview] Load Success', props<{ overview: Overview }>());
export const loadOverviewFailure = createAction('[ConsoleOverview] Load Failure', props<{ error: string }>());
