import { createAction, props } from '@ngrx/store';

import type { DatevExportScope } from '../../types/billing.types';

import type {
  AdminDatevExportListItem,
  AdminDatevExportListParams,
  TriggerDatevExportDto,
  TriggerDatevExportResponse,
} from '../../types/billing.types';

export const loadAdminDatevExports = createAction(
  '[AdminDatevExports] Load',
  props<{ params: AdminDatevExportListParams; preserveScope?: boolean }>(),
);
export const loadAdminDatevExportsBatch = createAction(
  '[AdminDatevExports] Load Batch',
  props<{ params: AdminDatevExportListParams; offset: number; accumulatedItems: AdminDatevExportListItem[] }>(),
);
export const loadAdminDatevExportsSuccess = createAction(
  '[AdminDatevExports] Load Success',
  props<{
    items: AdminDatevExportListItem[];
    total: number;
    limit: number;
    offset: number;
    loadedScope: DatevExportScope;
  }>(),
);
export const loadAdminDatevExportsFailure = createAction(
  '[AdminDatevExports] Load Failure',
  props<{ error: string }>(),
);

export const triggerDatevExport = createAction('[AdminDatevExports] Trigger', props<{ dto: TriggerDatevExportDto }>());
export const triggerDatevExportSuccess = createAction(
  '[AdminDatevExports] Trigger Success',
  props<{ result: TriggerDatevExportResponse; queuedAt: string }>(),
);
export const triggerDatevExportFailure = createAction(
  '[AdminDatevExports] Trigger Failure',
  props<{ error: string }>(),
);

export const downloadDatevExport = createAction('[AdminDatevExports] Download', props<{ exportId: string }>());
export const downloadDatevExportSuccess = createAction('[AdminDatevExports] Download Success');
export const downloadDatevExportFailure = createAction(
  '[AdminDatevExports] Download Failure',
  props<{ error: string }>(),
);

export const expireQueuedDatevExports = createAction('[AdminDatevExports] Expire Queued');
