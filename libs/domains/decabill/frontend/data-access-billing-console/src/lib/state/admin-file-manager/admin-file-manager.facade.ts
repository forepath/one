import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { AdminFileManagerListParams, AdminFileManagerView } from '../../types/billing.types';

import {
  downloadAdminFileManagerArchive,
  downloadAdminFileManagerFile,
  listAdminFileManagerDirectory,
  setAdminFileManagerView,
} from './admin-file-manager.actions';
import {
  selectAdminFileManagerDownloadLoading,
  selectAdminFileManagerError,
  selectAdminFileManagerExpandedPaths,
  selectAdminFileManagerLoadingPath,
  selectAdminFileManagerRootEntries,
  selectAdminFileManagerState,
  selectAdminFileManagerView,
  selectAdminFileManagerViewTenantId,
} from './admin-file-manager.selectors';
import { buildAdminFileManagerCacheKey } from './admin-file-manager.reducer';

@Injectable()
export class AdminFileManagerFacade {
  private readonly store = inject(Store);

  readonly view$ = this.store.select(selectAdminFileManagerView);
  readonly viewTenantId$ = this.store.select(selectAdminFileManagerViewTenantId);
  readonly rootEntries$ = this.store.select(selectAdminFileManagerRootEntries);
  readonly expandedPaths$ = this.store.select(selectAdminFileManagerExpandedPaths);
  readonly loadingPath$ = this.store.select(selectAdminFileManagerLoadingPath);
  readonly error$ = this.store.select(selectAdminFileManagerError);
  readonly downloadLoading$ = this.store.select(selectAdminFileManagerDownloadLoading);
  readonly state$ = this.store.select(selectAdminFileManagerState);

  setView(view: AdminFileManagerView, viewTenantId?: string | null): void {
    this.store.dispatch(setAdminFileManagerView({ view, viewTenantId }));
  }

  listDirectory(params: AdminFileManagerListParams): void {
    this.store.dispatch(listAdminFileManagerDirectory({ params }));
  }

  ensureDirectoryLoaded(params: AdminFileManagerListParams, cached: boolean): void {
    if (cached) {
      return;
    }

    this.listDirectory(params);
  }

  downloadFile(params: AdminFileManagerListParams, fileName?: string): void {
    this.store.dispatch(downloadAdminFileManagerFile({ params, fileName }));
  }

  downloadArchive(params: AdminFileManagerListParams, fileName?: string): void {
    this.store.dispatch(downloadAdminFileManagerArchive({ params, fileName }));
  }

  cacheKey(view: AdminFileManagerView, viewTenantId: string | null, path: string): string {
    return buildAdminFileManagerCacheKey(view, viewTenantId, path);
  }
}
