import { createAction, props } from '@ngrx/store';

import type {
  AdminFileManagerEntry,
  AdminFileManagerListParams,
  AdminFileManagerView,
  AdminFileVerifyResponse,
} from '../../types/billing.types';

export const listAdminFileManagerDirectory = createAction(
  '[AdminFileManager] List Directory',
  props<{ params: AdminFileManagerListParams }>(),
);

export const listAdminFileManagerDirectorySuccess = createAction(
  '[AdminFileManager] List Directory Success',
  props<{
    cacheKey: string;
    path: string;
    view: AdminFileManagerView;
    viewTenantId: string | null;
    entries: AdminFileManagerEntry[];
  }>(),
);

export const listAdminFileManagerDirectoryFailure = createAction(
  '[AdminFileManager] List Directory Failure',
  props<{ error: string }>(),
);

export const setAdminFileManagerView = createAction(
  '[AdminFileManager] Set View',
  props<{ view: AdminFileManagerView; viewTenantId?: string | null }>(),
);

export const expandAdminFileManagerPath = createAction('[AdminFileManager] Expand Path', props<{ path: string }>());

export const collapseAdminFileManagerPath = createAction('[AdminFileManager] Collapse Path', props<{ path: string }>());

export const refreshAdminFileManager = createAction('[AdminFileManager] Refresh');

export const downloadAdminFileManagerFile = createAction(
  '[AdminFileManager] Download File',
  props<{ params: AdminFileManagerListParams; fileName?: string }>(),
);

export const downloadAdminFileManagerFileSuccess = createAction('[AdminFileManager] Download File Success');

export const downloadAdminFileManagerFileFailure = createAction(
  '[AdminFileManager] Download File Failure',
  props<{ error: string }>(),
);

export const downloadAdminFileManagerArchive = createAction(
  '[AdminFileManager] Download Archive',
  props<{ params: AdminFileManagerListParams; fileName?: string }>(),
);

export const downloadAdminFileManagerArchiveSuccess = createAction('[AdminFileManager] Download Archive Success');

export const downloadAdminFileManagerArchiveFailure = createAction(
  '[AdminFileManager] Download Archive Failure',
  props<{ error: string }>(),
);

export const verifyAdminFileManagerFile = createAction('[AdminFileManager] Verify File', props<{ file: File }>());

export const verifyAdminFileManagerFileSuccess = createAction(
  '[AdminFileManager] Verify File Success',
  props<{ result: AdminFileVerifyResponse }>(),
);

export const verifyAdminFileManagerFileFailure = createAction(
  '[AdminFileManager] Verify File Failure',
  props<{ error: string }>(),
);

export const clearAdminFileManagerVerifyResult = createAction('[AdminFileManager] Clear Verify Result');
