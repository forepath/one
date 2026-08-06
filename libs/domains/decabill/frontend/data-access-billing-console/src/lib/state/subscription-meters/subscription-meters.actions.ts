import { createAction, props } from '@ngrx/store';

import type {
  CreateUsageMeterEntryDto,
  SubscriptionMeterSummary,
  UpdateUsageMeterEntryDto,
  UsageMeterEntryResponse,
} from '../../types/billing.types';

export const loadSubscriptionMeters = createAction(
  '[SubscriptionMeters] Load Summaries',
  props<{ subscriptionId: string }>(),
);
export const loadSubscriptionMetersSuccess = createAction(
  '[SubscriptionMeters] Load Summaries Success',
  props<{ subscriptionId: string; summaries: SubscriptionMeterSummary[] }>(),
);
export const loadSubscriptionMetersFailure = createAction(
  '[SubscriptionMeters] Load Summaries Failure',
  props<{ error: string }>(),
);

export const loadMeterEntries = createAction('[SubscriptionMeters] Load Entries', props<{ subscriptionId: string }>());
export const loadMeterEntriesSuccess = createAction(
  '[SubscriptionMeters] Load Entries Success',
  props<{ subscriptionId: string; entries: UsageMeterEntryResponse[] }>(),
);
export const loadMeterEntriesFailure = createAction(
  '[SubscriptionMeters] Load Entries Failure',
  props<{ error: string }>(),
);

export const createMeterEntry = createAction(
  '[SubscriptionMeters] Create Entry',
  props<{ subscriptionId: string; entry: CreateUsageMeterEntryDto }>(),
);
export const createMeterEntrySuccess = createAction(
  '[SubscriptionMeters] Create Entry Success',
  props<{ subscriptionId: string; entry: UsageMeterEntryResponse }>(),
);
export const createMeterEntryFailure = createAction(
  '[SubscriptionMeters] Create Entry Failure',
  props<{ error: string }>(),
);

export const updateMeterEntry = createAction(
  '[SubscriptionMeters] Update Entry',
  props<{ subscriptionId: string; entryId: string; entry: UpdateUsageMeterEntryDto }>(),
);
export const updateMeterEntrySuccess = createAction(
  '[SubscriptionMeters] Update Entry Success',
  props<{ subscriptionId: string; entry: UsageMeterEntryResponse }>(),
);
export const updateMeterEntryFailure = createAction(
  '[SubscriptionMeters] Update Entry Failure',
  props<{ error: string }>(),
);

export const deleteMeterEntry = createAction(
  '[SubscriptionMeters] Delete Entry',
  props<{ subscriptionId: string; entryId: string }>(),
);
export const deleteMeterEntrySuccess = createAction(
  '[SubscriptionMeters] Delete Entry Success',
  props<{ subscriptionId: string; entryId: string }>(),
);
export const deleteMeterEntryFailure = createAction(
  '[SubscriptionMeters] Delete Entry Failure',
  props<{ error: string }>(),
);

export const clearSubscriptionMeters = createAction('[SubscriptionMeters] Clear');
