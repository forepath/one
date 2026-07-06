import { createFeatureSelector, createSelector } from '@ngrx/store';

import { assetKey, listingKey, type AssetsState } from './assets.reducer';

export const selectAssetsState = createFeatureSelector<AssetsState>('assets');

export const selectDirectoryListing = (presentationId: string, directoryPath = '.') =>
  createSelector(selectAssetsState, (state) => state.directoryListings[listingKey(presentationId, directoryPath)] ?? null);

export const selectAssetContent = (presentationId: string, assetPath: string) =>
  createSelector(selectAssetsState, (state) => state.assetContents[assetKey(presentationId, assetPath)] ?? null);

export const selectIsListingDirectory = (presentationId: string, directoryPath = '.') =>
  createSelector(selectAssetsState, (state) => state.listing[listingKey(presentationId, directoryPath)] ?? false);

export const selectIsReadingAsset = (presentationId: string, assetPath: string) =>
  createSelector(selectAssetsState, (state) => state.reading[assetKey(presentationId, assetPath)] ?? false);

export const selectIsWritingAsset = (presentationId: string, assetPath: string) =>
  createSelector(selectAssetsState, (state) => state.writing[assetKey(presentationId, assetPath)] ?? false);

export const selectAssetError = (presentationId: string, path: string, kind: 'listing' | 'asset' = 'asset') =>
  createSelector(selectAssetsState, (state) => {
    const key = kind === 'listing' ? listingKey(presentationId, path) : assetKey(presentationId, path);

    return state.errors[key] ?? null;
  });
