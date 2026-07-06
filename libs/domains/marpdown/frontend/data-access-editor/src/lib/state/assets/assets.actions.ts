import { createAction, props } from '@ngrx/store';

import type { AssetContentDto, CreateAssetDto, FileNodeDto, MoveAssetDto, WriteAssetDto } from '../../types/presentation.types';

export const listAssetDirectory = createAction(
  '[Assets] List Directory',
  props<{ presentationId: string; directoryPath?: string }>(),
);

export const listAssetDirectorySuccess = createAction(
  '[Assets] List Directory Success',
  props<{ presentationId: string; directoryPath: string; files: FileNodeDto[] }>(),
);

export const listAssetDirectoryFailure = createAction(
  '[Assets] List Directory Failure',
  props<{ presentationId: string; directoryPath: string; error: string }>(),
);

export const readAsset = createAction('[Assets] Read Asset', props<{ presentationId: string; assetPath: string }>());

export const readAssetSuccess = createAction(
  '[Assets] Read Asset Success',
  props<{ presentationId: string; assetPath: string; content: AssetContentDto }>(),
);

export const readAssetFailure = createAction(
  '[Assets] Read Asset Failure',
  props<{ presentationId: string; assetPath: string; error: string }>(),
);

export const writeAsset = createAction(
  '[Assets] Write Asset',
  props<{ presentationId: string; assetPath: string; dto: WriteAssetDto }>(),
);

export const writeAssetSuccess = createAction(
  '[Assets] Write Asset Success',
  props<{ presentationId: string; assetPath: string }>(),
);

export const writeAssetFailure = createAction(
  '[Assets] Write Asset Failure',
  props<{ presentationId: string; assetPath: string; error: string }>(),
);

export const createAsset = createAction(
  '[Assets] Create Asset',
  props<{ presentationId: string; assetPath: string; dto: CreateAssetDto }>(),
);

export const createAssetSuccess = createAction(
  '[Assets] Create Asset Success',
  props<{ presentationId: string; assetPath: string }>(),
);

export const createAssetFailure = createAction(
  '[Assets] Create Asset Failure',
  props<{ presentationId: string; assetPath: string; error: string }>(),
);

export const deleteAsset = createAction('[Assets] Delete Asset', props<{ presentationId: string; assetPath: string }>());

export const deleteAssetSuccess = createAction(
  '[Assets] Delete Asset Success',
  props<{ presentationId: string; assetPath: string }>(),
);

export const deleteAssetFailure = createAction(
  '[Assets] Delete Asset Failure',
  props<{ presentationId: string; assetPath: string; error: string }>(),
);

export const moveAsset = createAction(
  '[Assets] Move Asset',
  props<{ presentationId: string; assetPath: string; dto: MoveAssetDto }>(),
);

export const moveAssetSuccess = createAction(
  '[Assets] Move Asset Success',
  props<{ presentationId: string; sourcePath: string; destinationPath: string }>(),
);

export const moveAssetFailure = createAction(
  '[Assets] Move Asset Failure',
  props<{ presentationId: string; assetPath: string; error: string }>(),
);

export const clearAssetDirectoryListing = createAction(
  '[Assets] Clear Directory Listing',
  props<{ presentationId: string; directoryPath: string }>(),
);

export const clearAssetContent = createAction(
  '[Assets] Clear Asset Content',
  props<{ presentationId: string; assetPath: string }>(),
);
