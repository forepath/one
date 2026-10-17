import { createAction, props } from '@ngrx/store';

import type {
  CreateRolloutRequest,
  MaintenanceWindowResource,
  Rollout,
  RolloutAction,
  UpdateRelease,
  UpdatesStatus,
} from '../../types/updates.types';

/** Status, releases and update plans together; maintenance windows and the Cluster resource's name may fail alone. */
export const loadUpdates = createAction('[ConsoleUpdates] Load', props<{ silent?: boolean }>());
export const loadUpdatesSuccess = createAction(
  '[ConsoleUpdates] Load Success',
  props<{
    status: UpdatesStatus;
    releases: UpdateRelease[];
    rollouts: Rollout[];
    windows: MaintenanceWindowResource[] | null;
    clusterResource: string | null;
  }>(),
);
export const loadUpdatesFailure = createAction('[ConsoleUpdates] Load Failure', props<{ error: string }>());

export const loadRollout = createAction('[ConsoleUpdates] Load Rollout', props<{ id: string; silent?: boolean }>());
export const loadRolloutSuccess = createAction('[ConsoleUpdates] Load Rollout Success', props<{ rollout: Rollout }>());
export const loadRolloutFailure = createAction(
  '[ConsoleUpdates] Load Rollout Failure',
  props<{ id: string; error: string }>(),
);

export const downloadRelease = createAction('[ConsoleUpdates] Download Release', props<{ version: string }>());
export const downloadReleaseSuccess = createAction(
  '[ConsoleUpdates] Download Release Success',
  props<{ version: string }>(),
);
export const downloadReleaseFailure = createAction(
  '[ConsoleUpdates] Download Release Failure',
  props<{ version: string; error: string }>(),
);

export const uploadBundle = createAction('[ConsoleUpdates] Upload Bundle', props<{ file: File }>());
export const uploadBundleProgress = createAction(
  '[ConsoleUpdates] Upload Bundle Progress',
  props<{ loaded: number; total: number }>(),
);
export const uploadBundleSuccess = createAction(
  '[ConsoleUpdates] Upload Bundle Success',
  props<{ release: UpdateRelease }>(),
);
export const uploadBundleFailure = createAction('[ConsoleUpdates] Upload Bundle Failure', props<{ error: string }>());
/** Aborts the upload in flight. */
export const cancelBundleUpload = createAction('[ConsoleUpdates] Cancel Bundle Upload');
export const clearBundleUpload = createAction('[ConsoleUpdates] Clear Bundle Upload');

export const createRollout = createAction(
  '[ConsoleUpdates] Create Rollout',
  props<{ request: CreateRolloutRequest }>(),
);
export const createRolloutSuccess = createAction(
  '[ConsoleUpdates] Create Rollout Success',
  props<{ rollout: Rollout }>(),
);
export const createRolloutFailure = createAction('[ConsoleUpdates] Create Rollout Failure', props<{ error: string }>());
export const clearCreateRolloutError = createAction('[ConsoleUpdates] Clear Create Rollout Error');

export const rolloutAction = createAction(
  '[ConsoleUpdates] Rollout Action',
  props<{ id: string; action: RolloutAction; emergency?: boolean }>(),
);
export const rolloutActionSuccess = createAction(
  '[ConsoleUpdates] Rollout Action Success',
  props<{ action: RolloutAction; rollout: Rollout }>(),
);
export const rolloutActionFailure = createAction(
  '[ConsoleUpdates] Rollout Action Failure',
  props<{ id: string; action: RolloutAction; error: string }>(),
);
export const clearRolloutActionError = createAction('[ConsoleUpdates] Clear Rollout Action Error');
