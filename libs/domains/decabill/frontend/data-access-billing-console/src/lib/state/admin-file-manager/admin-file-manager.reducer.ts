import { createReducer, on } from '@ngrx/store';

import type { AdminFileManagerEntry, AdminFileManagerView } from '../../types/billing.types';

import {
  downloadAdminFileManagerArchive,
  downloadAdminFileManagerArchiveFailure,
  downloadAdminFileManagerArchiveSuccess,
  downloadAdminFileManagerFile,
  downloadAdminFileManagerFileFailure,
  downloadAdminFileManagerFileSuccess,
  listAdminFileManagerDirectory,
  listAdminFileManagerDirectoryFailure,
  listAdminFileManagerDirectorySuccess,
  setAdminFileManagerView,
} from './admin-file-manager.actions';

export interface AdminFileManagerState {
  view: AdminFileManagerView;
  viewTenantId: string | null;
  directoriesByPath: Record<string, AdminFileManagerEntry[]>;
  expandedPaths: string[];
  loadingPath: string | null;
  error: string | null;
  downloadLoading: boolean;
}

export const initialAdminFileManagerState: AdminFileManagerState = {
  view: 'tenant',
  viewTenantId: null,
  directoriesByPath: {},
  expandedPaths: [''],
  loadingPath: null,
  error: null,
  downloadLoading: false,
};

export function buildAdminFileManagerCacheKey(
  view: AdminFileManagerView,
  viewTenantId: string | null | undefined,
  path: string,
): string {
  return `${view}|${viewTenantId ?? ''}|${path}`;
}

export const adminFileManagerReducer = createReducer(
  initialAdminFileManagerState,
  on(setAdminFileManagerView, (state, { view, viewTenantId }) => ({
    ...state,
    view,
    viewTenantId: view === 'unified' ? null : (viewTenantId ?? state.viewTenantId),
    directoriesByPath: {},
    expandedPaths: [''],
    error: null,
  })),
  on(listAdminFileManagerDirectory, (state, { params }) => ({
    ...state,
    loadingPath: params.path ?? '',
    error: null,
    view: params.view ?? state.view,
    viewTenantId: (params.view ?? state.view) === 'unified' ? null : (params.viewTenantId ?? state.viewTenantId),
  })),
  on(listAdminFileManagerDirectorySuccess, (state, { cacheKey, path, view, viewTenantId, entries }) => ({
    ...state,
    loadingPath: null,
    view,
    viewTenantId,
    directoriesByPath: {
      ...state.directoriesByPath,
      [cacheKey]: entries,
    },
    expandedPaths: state.expandedPaths.includes(path) ? state.expandedPaths : [...state.expandedPaths, path],
  })),
  on(listAdminFileManagerDirectoryFailure, (state, { error }) => ({
    ...state,
    loadingPath: null,
    error,
  })),
  on(downloadAdminFileManagerFile, (state) => ({ ...state, downloadLoading: true, error: null })),
  on(downloadAdminFileManagerFileSuccess, (state) => ({ ...state, downloadLoading: false })),
  on(downloadAdminFileManagerFileFailure, (state, { error }) => ({
    ...state,
    downloadLoading: false,
    error,
  })),
  on(downloadAdminFileManagerArchive, (state) => ({ ...state, downloadLoading: true, error: null })),
  on(downloadAdminFileManagerArchiveSuccess, (state) => ({ ...state, downloadLoading: false })),
  on(downloadAdminFileManagerArchiveFailure, (state, { error }) => ({
    ...state,
    downloadLoading: false,
    error,
  })),
);
