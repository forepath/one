import { createReducer, on } from '@ngrx/store';

import type { AssetContentDto, FileNodeDto } from '../../types/presentation.types';

import {
  clearAssetContent,
  clearAssetDirectoryListing,
  createAsset,
  createAssetFailure,
  createAssetSuccess,
  deleteAsset,
  deleteAssetFailure,
  deleteAssetSuccess,
  listAssetDirectory,
  listAssetDirectoryFailure,
  listAssetDirectorySuccess,
  moveAsset,
  moveAssetFailure,
  moveAssetSuccess,
  readAsset,
  readAssetFailure,
  readAssetSuccess,
  writeAsset,
  writeAssetFailure,
  writeAssetSuccess,
} from './assets.actions';

export interface AssetsState {
  directoryListings: Record<string, FileNodeDto[]>;
  assetContents: Record<string, AssetContentDto>;
  listing: Record<string, boolean>;
  reading: Record<string, boolean>;
  writing: Record<string, boolean>;
  creating: Record<string, boolean>;
  deleting: Record<string, boolean>;
  moving: Record<string, boolean>;
  errors: Record<string, string | null>;
}

export const initialAssetsState: AssetsState = {
  directoryListings: {},
  assetContents: {},
  listing: {},
  reading: {},
  writing: {},
  creating: {},
  deleting: {},
  moving: {},
  errors: {},
};

function listingKey(presentationId: string, directoryPath: string): string {
  return `${presentationId}:${directoryPath}`;
}

function assetKey(presentationId: string, assetPath: string): string {
  return `${presentationId}:${assetPath}`;
}

function parentDirectoryPath(assetPath: string): string {
  const parts = assetPath.split('/').filter(Boolean);

  if (parts.length <= 1) {
    return '.';
  }

  return parts.slice(0, -1).join('/');
}

export const assetsReducer = createReducer(
  initialAssetsState,
  on(listAssetDirectory, (state, { presentationId, directoryPath = '.' }) => {
    const key = listingKey(presentationId, directoryPath);

    return {
      ...state,
      listing: { ...state.listing, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(listAssetDirectorySuccess, (state, { presentationId, directoryPath, files }) => {
    const key = listingKey(presentationId, directoryPath);

    return {
      ...state,
      directoryListings: { ...state.directoryListings, [key]: files },
      listing: { ...state.listing, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(listAssetDirectoryFailure, (state, { presentationId, directoryPath, error }) => {
    const key = listingKey(presentationId, directoryPath);

    return {
      ...state,
      listing: { ...state.listing, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  on(readAsset, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      reading: { ...state.reading, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(readAssetSuccess, (state, { presentationId, assetPath, content }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      assetContents: { ...state.assetContents, [key]: content },
      reading: { ...state.reading, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(readAssetFailure, (state, { presentationId, assetPath, error }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      reading: { ...state.reading, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  on(writeAsset, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      writing: { ...state.writing, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(writeAssetSuccess, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);
    const parentKey = listingKey(presentationId, parentDirectoryPath(assetPath));
    const { [key]: _, ...assetContents } = state.assetContents;
    const { [parentKey]: __, ...directoryListings } = state.directoryListings;

    return {
      ...state,
      assetContents,
      directoryListings,
      writing: { ...state.writing, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(writeAssetFailure, (state, { presentationId, assetPath, error }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      writing: { ...state.writing, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  on(createAsset, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      creating: { ...state.creating, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(createAssetSuccess, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);
    const parentKey = listingKey(presentationId, parentDirectoryPath(assetPath));
    const { [parentKey]: _, ...directoryListings } = state.directoryListings;

    return {
      ...state,
      directoryListings,
      creating: { ...state.creating, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(createAssetFailure, (state, { presentationId, assetPath, error }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      creating: { ...state.creating, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  on(deleteAsset, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      deleting: { ...state.deleting, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(deleteAssetSuccess, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);
    const parentKey = listingKey(presentationId, parentDirectoryPath(assetPath));
    const { [key]: _, ...assetContents } = state.assetContents;
    const { [parentKey]: __, ...directoryListings } = state.directoryListings;

    return {
      ...state,
      assetContents,
      directoryListings,
      deleting: { ...state.deleting, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(deleteAssetFailure, (state, { presentationId, assetPath, error }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      deleting: { ...state.deleting, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  on(moveAsset, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      moving: { ...state.moving, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(moveAssetSuccess, (state, { presentationId, sourcePath, destinationPath }) => {
    const sourceKey = assetKey(presentationId, sourcePath);
    const destinationKey = assetKey(presentationId, destinationPath);
    const sourceParentKey = listingKey(presentationId, parentDirectoryPath(sourcePath));
    const destinationParentKey = listingKey(presentationId, parentDirectoryPath(destinationPath));
    const { [sourceKey]: movedContent, ...assetContents } = state.assetContents;
    const updatedContents = movedContent ? { ...assetContents, [destinationKey]: movedContent } : assetContents;
    const { [sourceParentKey]: _, [destinationParentKey]: __, ...directoryListings } = state.directoryListings;

    return {
      ...state,
      assetContents: updatedContents,
      directoryListings,
      moving: { ...state.moving, [sourceKey]: false },
      errors: { ...state.errors, [sourceKey]: null },
    };
  }),
  on(moveAssetFailure, (state, { presentationId, assetPath, error }) => {
    const key = assetKey(presentationId, assetPath);

    return {
      ...state,
      moving: { ...state.moving, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  on(clearAssetDirectoryListing, (state, { presentationId, directoryPath }) => {
    const key = listingKey(presentationId, directoryPath);
    const { [key]: _, ...directoryListings } = state.directoryListings;

    return {
      ...state,
      directoryListings,
    };
  }),
  on(clearAssetContent, (state, { presentationId, assetPath }) => {
    const key = assetKey(presentationId, assetPath);
    const { [key]: _, ...assetContents } = state.assetContents;

    return {
      ...state,
      assetContents,
    };
  }),
);

export { listingKey, assetKey };
