import { createAction, props } from '@ngrx/store';

import type {
  AtlassianConnectionTestResultDto,
  AtlassianSiteConnectionDto,
  CreateAtlassianSiteConnectionDto,
  CreateExternalImportConfigDto,
  ExternalImportConfigDto,
  UpdateAtlassianSiteConnectionDto,
  UpdateExternalImportConfigDto,
} from './context-import.types';

export const loadAtlassianContextImport = createAction('[Atlassian Context Import] Load');

export const loadAtlassianContextImportBatch = createAction(
  '[Atlassian Context Import] Load Batch',
  props<{
    accumulatedConnections: AtlassianSiteConnectionDto[];
    accumulatedConfigs: ExternalImportConfigDto[];
    nextConnectionOffset: number | null;
    nextConfigOffset: number | null;
  }>(),
);

export const loadAtlassianContextImportSuccess = createAction(
  '[Atlassian Context Import] Load Success',
  props<{ connections: AtlassianSiteConnectionDto[]; configs: ExternalImportConfigDto[] }>(),
);

export const loadAtlassianContextImportFailure = createAction(
  '[Atlassian Context Import] Load Failure',
  props<{ error: string }>(),
);

export const createAtlassianConnection = createAction(
  '[Atlassian Context Import] Create Connection',
  props<{ dto: CreateAtlassianSiteConnectionDto }>(),
);

export const createAtlassianConnectionSuccess = createAction(
  '[Atlassian Context Import] Create Connection Success',
  props<{ connection: AtlassianSiteConnectionDto }>(),
);

export const createAtlassianConnectionFailure = createAction(
  '[Atlassian Context Import] Create Connection Failure',
  props<{ error: string }>(),
);

export const updateAtlassianConnection = createAction(
  '[Atlassian Context Import] Update Connection',
  props<{ id: string; dto: UpdateAtlassianSiteConnectionDto }>(),
);

export const updateAtlassianConnectionSuccess = createAction(
  '[Atlassian Context Import] Update Connection Success',
  props<{ connection: AtlassianSiteConnectionDto }>(),
);

export const updateAtlassianConnectionFailure = createAction(
  '[Atlassian Context Import] Update Connection Failure',
  props<{ error: string }>(),
);

export const deleteAtlassianConnection = createAction(
  '[Atlassian Context Import] Delete Connection',
  props<{ id: string }>(),
);

export const deleteAtlassianConnectionSuccess = createAction(
  '[Atlassian Context Import] Delete Connection Success',
  props<{ id: string }>(),
);

export const deleteAtlassianConnectionFailure = createAction(
  '[Atlassian Context Import] Delete Connection Failure',
  props<{ error: string }>(),
);

export const testAtlassianConnection = createAction(
  '[Atlassian Context Import] Test Connection',
  props<{ id: string }>(),
);

export const testAtlassianConnectionSuccess = createAction(
  '[Atlassian Context Import] Test Connection Success',
  props<{ connectionId: string; result: AtlassianConnectionTestResultDto }>(),
);

export const testAtlassianConnectionFailure = createAction(
  '[Atlassian Context Import] Test Connection Failure',
  props<{ error: string }>(),
);

export const createExternalImportConfig = createAction(
  '[Atlassian Context Import] Create Config',
  props<{ dto: CreateExternalImportConfigDto }>(),
);

export const createExternalImportConfigSuccess = createAction(
  '[Atlassian Context Import] Create Config Success',
  props<{ config: ExternalImportConfigDto }>(),
);

export const createExternalImportConfigFailure = createAction(
  '[Atlassian Context Import] Create Config Failure',
  props<{ error: string }>(),
);

export const updateExternalImportConfig = createAction(
  '[Atlassian Context Import] Update Config',
  props<{ id: string; dto: UpdateExternalImportConfigDto }>(),
);

export const updateExternalImportConfigSuccess = createAction(
  '[Atlassian Context Import] Update Config Success',
  props<{ config: ExternalImportConfigDto }>(),
);

export const updateExternalImportConfigFailure = createAction(
  '[Atlassian Context Import] Update Config Failure',
  props<{ error: string }>(),
);

export const deleteExternalImportConfig = createAction(
  '[Atlassian Context Import] Delete Config',
  props<{ id: string }>(),
);

export const deleteExternalImportConfigSuccess = createAction(
  '[Atlassian Context Import] Delete Config Success',
  props<{ id: string }>(),
);

export const deleteExternalImportConfigFailure = createAction(
  '[Atlassian Context Import] Delete Config Failure',
  props<{ error: string }>(),
);

export const runExternalImportConfig = createAction('[Atlassian Context Import] Run Config', props<{ id: string }>());

export const runExternalImportConfigSuccess = createAction(
  '[Atlassian Context Import] Run Config Success',
  props<{ id: string }>(),
);

export const runExternalImportConfigFailure = createAction(
  '[Atlassian Context Import] Run Config Failure',
  props<{ error: string }>(),
);

export const clearExternalImportMarkers = createAction(
  '[Atlassian Context Import] Clear Markers',
  props<{ id: string }>(),
);

export const clearExternalImportMarkersSuccess = createAction(
  '[Atlassian Context Import] Clear Markers Success',
  props<{ id: string }>(),
);

export const clearExternalImportMarkersFailure = createAction(
  '[Atlassian Context Import] Clear Markers Failure',
  props<{ error: string }>(),
);

export const clearAtlassianContextImportError = createAction('[Atlassian Context Import] Clear Error');

export const clearAtlassianConnectionTestResult = createAction('[Atlassian Context Import] Clear Test Result');
