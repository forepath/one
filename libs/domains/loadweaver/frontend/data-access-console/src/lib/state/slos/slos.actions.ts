import { createAction, props } from '@ngrx/store';

import type { Slo } from '../../types/slos.types';

/** `silent`: refresh without the loading state (periodic refresh). */
export const loadSlos = createAction('[ConsoleSlos] Load', props<{ project: string | null; silent?: boolean }>());
export const loadSlosSuccess = createAction('[ConsoleSlos] Load Success', props<{ slos: Slo[] }>());
export const loadSlosFailure = createAction('[ConsoleSlos] Load Failure', props<{ error: string }>());
