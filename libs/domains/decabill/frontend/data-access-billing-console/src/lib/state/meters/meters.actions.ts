import { createAction, props } from '@ngrx/store';

import type { CreateMeterDto, ListParams, MeterResponse, UpdateMeterDto } from '../../types/billing.types';

export const loadMeters = createAction('[Meters] Load Meters', props<{ params?: ListParams }>());
export const loadMetersSuccess = createAction('[Meters] Load Meters Success', props<{ meters: MeterResponse[] }>());
export const loadMetersFailure = createAction('[Meters] Load Meters Failure', props<{ error: string }>());
export const loadMetersBatch = createAction(
  '[Meters] Load Meters Batch',
  props<{ offset: number; accumulatedMeters: MeterResponse[] }>(),
);
export const loadMeter = createAction('[Meters] Load Meter', props<{ id: string }>());
export const loadMeterSuccess = createAction('[Meters] Load Meter Success', props<{ meter: MeterResponse }>());
export const loadMeterFailure = createAction('[Meters] Load Meter Failure', props<{ error: string }>());
export const createMeter = createAction('[Meters] Create Meter', props<{ meter: CreateMeterDto }>());
export const createMeterSuccess = createAction('[Meters] Create Meter Success', props<{ meter: MeterResponse }>());
export const createMeterFailure = createAction('[Meters] Create Meter Failure', props<{ error: string }>());
export const updateMeter = createAction('[Meters] Update Meter', props<{ id: string; meter: UpdateMeterDto }>());
export const updateMeterSuccess = createAction('[Meters] Update Meter Success', props<{ meter: MeterResponse }>());
export const updateMeterFailure = createAction('[Meters] Update Meter Failure', props<{ error: string }>());
export const deleteMeter = createAction('[Meters] Delete Meter', props<{ id: string }>());
export const deleteMeterSuccess = createAction('[Meters] Delete Meter Success', props<{ id: string }>());
export const deleteMeterFailure = createAction('[Meters] Delete Meter Failure', props<{ error: string }>());
export const clearSelectedMeter = createAction('[Meters] Clear Selected Meter');
