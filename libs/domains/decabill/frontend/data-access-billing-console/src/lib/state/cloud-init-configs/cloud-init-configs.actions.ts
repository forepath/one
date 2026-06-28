import { createAction, props } from '@ngrx/store';

import type {
  CloudInitConfigResponse,
  CreateCloudInitConfigDto,
  ListParams,
  UpdateCloudInitConfigDto,
} from '../../types/billing.types';

export const loadCloudInitConfigs = createAction(
  '[CloudInit Configs] Load CloudInit Configs',
  props<{ params?: ListParams }>(),
);

export const loadCloudInitConfigsSuccess = createAction(
  '[CloudInit Configs] Load CloudInit Configs Success',
  props<{ cloudInitConfigs: CloudInitConfigResponse[] }>(),
);

export const loadCloudInitConfigsFailure = createAction(
  '[CloudInit Configs] Load CloudInit Configs Failure',
  props<{ error: string }>(),
);

export const loadCloudInitConfigsBatch = createAction(
  '[CloudInit Configs] Load CloudInit Configs Batch',
  props<{ offset: number; accumulatedCloudInitConfigs: CloudInitConfigResponse[] }>(),
);

export const loadCloudInitConfig = createAction('[CloudInit Configs] Load CloudInit Config', props<{ id: string }>());

export const loadCloudInitConfigSuccess = createAction(
  '[CloudInit Configs] Load CloudInit Config Success',
  props<{ cloudInitConfig: CloudInitConfigResponse }>(),
);

export const loadCloudInitConfigFailure = createAction(
  '[CloudInit Configs] Load CloudInit Config Failure',
  props<{ error: string }>(),
);

export const createCloudInitConfig = createAction(
  '[CloudInit Configs] Create CloudInit Config',
  props<{ cloudInitConfig: CreateCloudInitConfigDto }>(),
);

export const createCloudInitConfigSuccess = createAction(
  '[CloudInit Configs] Create CloudInit Config Success',
  props<{ cloudInitConfig: CloudInitConfigResponse }>(),
);

export const createCloudInitConfigFailure = createAction(
  '[CloudInit Configs] Create CloudInit Config Failure',
  props<{ error: string }>(),
);

export const updateCloudInitConfig = createAction(
  '[CloudInit Configs] Update CloudInit Config',
  props<{ id: string; cloudInitConfig: UpdateCloudInitConfigDto }>(),
);

export const updateCloudInitConfigSuccess = createAction(
  '[CloudInit Configs] Update CloudInit Config Success',
  props<{ cloudInitConfig: CloudInitConfigResponse }>(),
);

export const updateCloudInitConfigFailure = createAction(
  '[CloudInit Configs] Update CloudInit Config Failure',
  props<{ error: string }>(),
);

export const deleteCloudInitConfig = createAction(
  '[CloudInit Configs] Delete CloudInit Config',
  props<{ id: string }>(),
);

export const deleteCloudInitConfigSuccess = createAction(
  '[CloudInit Configs] Delete CloudInit Config Success',
  props<{ id: string }>(),
);

export const deleteCloudInitConfigFailure = createAction(
  '[CloudInit Configs] Delete CloudInit Config Failure',
  props<{ error: string }>(),
);

export const clearSelectedCloudInitConfig = createAction('[CloudInit Configs] Clear Selected CloudInit Config');
