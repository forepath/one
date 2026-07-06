import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type { AssetContentDto, CreateAssetDto, FileNodeDto, MoveAssetDto, WriteAssetDto } from '../../types/presentation.types';

import {
  clearAssetContent,
  clearAssetDirectoryListing,
  createAsset,
  deleteAsset,
  listAssetDirectory,
  moveAsset,
  readAsset,
  writeAsset,
} from './assets.actions';
import {
  selectAssetContent,
  selectAssetError,
  selectDirectoryListing,
  selectIsListingDirectory,
  selectIsReadingAsset,
  selectIsWritingAsset,
} from './assets.selectors';

@Injectable({
  providedIn: 'root',
})
export class AssetsFacade {
  private readonly store = inject(Store);

  listDirectory(presentationId: string, directoryPath = '.'): void {
    this.store.dispatch(listAssetDirectory({ presentationId, directoryPath }));
  }

  readAsset(presentationId: string, assetPath: string): void {
    this.store.dispatch(readAsset({ presentationId, assetPath }));
  }

  writeAsset(presentationId: string, assetPath: string, dto: WriteAssetDto): void {
    this.store.dispatch(writeAsset({ presentationId, assetPath, dto }));
  }

  createAsset(presentationId: string, assetPath: string, dto: CreateAssetDto): void {
    this.store.dispatch(createAsset({ presentationId, assetPath, dto }));
  }

  deleteAsset(presentationId: string, assetPath: string): void {
    this.store.dispatch(deleteAsset({ presentationId, assetPath }));
  }

  moveAsset(presentationId: string, assetPath: string, dto: MoveAssetDto): void {
    this.store.dispatch(moveAsset({ presentationId, assetPath, dto }));
  }

  clearDirectoryListing(presentationId: string, directoryPath: string): void {
    this.store.dispatch(clearAssetDirectoryListing({ presentationId, directoryPath }));
  }

  clearAssetContent(presentationId: string, assetPath: string): void {
    this.store.dispatch(clearAssetContent({ presentationId, assetPath }));
  }

  getDirectoryListing$(presentationId: string, directoryPath = '.'): Observable<FileNodeDto[] | null> {
    return this.store.select(selectDirectoryListing(presentationId, directoryPath));
  }

  getAssetContent$(presentationId: string, assetPath: string): Observable<AssetContentDto | null> {
    return this.store.select(selectAssetContent(presentationId, assetPath));
  }

  getIsListingDirectory$(presentationId: string, directoryPath = '.'): Observable<boolean> {
    return this.store.select(selectIsListingDirectory(presentationId, directoryPath));
  }

  getIsReadingAsset$(presentationId: string, assetPath: string): Observable<boolean> {
    return this.store.select(selectIsReadingAsset(presentationId, assetPath));
  }

  getIsWritingAsset$(presentationId: string, assetPath: string): Observable<boolean> {
    return this.store.select(selectIsWritingAsset(presentationId, assetPath));
  }

  getAssetError$(presentationId: string, path: string, kind: 'listing' | 'asset' = 'asset'): Observable<string | null> {
    return this.store.select(selectAssetError(presentationId, path, kind));
  }
}
