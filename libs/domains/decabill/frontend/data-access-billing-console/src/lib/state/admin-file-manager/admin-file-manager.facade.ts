import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { AdminFileManagerListParams, AdminFileManagerView } from '../../types/billing.types';

import {
  clearAdminFileManagerDocumentIdLookup,
  clearAdminFileManagerVerifyResult,
  collapseAdminFileManagerPath,
  downloadAdminFileManagerArchive,
  downloadAdminFileManagerByDocumentId,
  downloadAdminFileManagerFile,
  expandAdminFileManagerPath,
  listAdminFileManagerDirectory,
  refreshAdminFileManager,
  setAdminFileManagerView,
  verifyAdminFileManagerFile,
} from './admin-file-manager.actions';
import {
  selectAdminFileManagerDocumentIdLookupError,
  selectAdminFileManagerDocumentIdLookupLoading,
  selectAdminFileManagerDocumentIdLookupSuccess,
  selectAdminFileManagerDownloadLoading,
  selectAdminFileManagerError,
  selectAdminFileManagerExpandedPaths,
  selectAdminFileManagerLoadingPath,
  selectAdminFileManagerRootEntries,
  selectAdminFileManagerState,
  selectAdminFileManagerVerifyError,
  selectAdminFileManagerVerifyLoading,
  selectAdminFileManagerVerifyResult,
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
  readonly verifyLoading$ = this.store.select(selectAdminFileManagerVerifyLoading);
  readonly verifyResult$ = this.store.select(selectAdminFileManagerVerifyResult);
  readonly verifyError$ = this.store.select(selectAdminFileManagerVerifyError);
  readonly documentIdLookupLoading$ = this.store.select(selectAdminFileManagerDocumentIdLookupLoading);
  readonly documentIdLookupError$ = this.store.select(selectAdminFileManagerDocumentIdLookupError);
  readonly documentIdLookupSuccess$ = this.store.select(selectAdminFileManagerDocumentIdLookupSuccess);
  readonly state$ = this.store.select(selectAdminFileManagerState);

  setView(view: AdminFileManagerView, viewTenantId?: string | null): void {
    this.store.dispatch(setAdminFileManagerView({ view, viewTenantId }));
  }

  listDirectory(params: AdminFileManagerListParams): void {
    this.store.dispatch(listAdminFileManagerDirectory({ params }));
  }

  expandPath(path: string): void {
    this.store.dispatch(expandAdminFileManagerPath({ path }));
  }

  collapsePath(path: string): void {
    this.store.dispatch(collapseAdminFileManagerPath({ path }));
  }

  ensureDirectoryLoaded(params: AdminFileManagerListParams, cached: boolean): void {
    if (cached) {
      return;
    }

    this.listDirectory(params);
  }

  refresh(): void {
    this.store.dispatch(refreshAdminFileManager());
  }

  verifyFile(file: File): void {
    this.store.dispatch(verifyAdminFileManagerFile({ file }));
  }

  clearVerifyResult(): void {
    this.store.dispatch(clearAdminFileManagerVerifyResult());
  }

  downloadByDocumentId(documentId: string): void {
    this.store.dispatch(downloadAdminFileManagerByDocumentId({ documentId }));
  }

  clearDocumentIdLookup(): void {
    this.store.dispatch(clearAdminFileManagerDocumentIdLookup());
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
