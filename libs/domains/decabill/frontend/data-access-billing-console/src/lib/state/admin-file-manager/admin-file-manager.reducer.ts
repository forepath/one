import { createReducer, on } from '@ngrx/store';

import type { AdminFileManagerEntry, AdminFileManagerView, AdminFileVerifyResponse } from '../../types/billing.types';

import {
  clearAdminFileManagerDocumentIdLookup,
  clearAdminFileManagerVerifyResult,
  collapseAdminFileManagerPath,
  downloadAdminFileManagerArchive,
  downloadAdminFileManagerArchiveFailure,
  downloadAdminFileManagerArchiveSuccess,
  downloadAdminFileManagerByDocumentId,
  downloadAdminFileManagerByDocumentIdFailure,
  downloadAdminFileManagerByDocumentIdSuccess,
  downloadAdminFileManagerFile,
  downloadAdminFileManagerFileFailure,
  downloadAdminFileManagerFileSuccess,
  expandAdminFileManagerPath,
  listAdminFileManagerDirectory,
  listAdminFileManagerDirectoryFailure,
  listAdminFileManagerDirectorySuccess,
  refreshAdminFileManager,
  setAdminFileManagerView,
  verifyAdminFileManagerFile,
  verifyAdminFileManagerFileFailure,
  verifyAdminFileManagerFileSuccess,
} from './admin-file-manager.actions';

function isPathOrDescendant(candidate: string, parent: string): boolean {
  if (parent === '') {
    return candidate !== '';
  }

  return candidate === parent || candidate.startsWith(`${parent}/`);
}

export interface AdminFileManagerState {
  view: AdminFileManagerView;
  viewTenantId: string | null;
  directoriesByPath: Record<string, AdminFileManagerEntry[]>;
  expandedPaths: string[];
  loadingPath: string | null;
  error: string | null;
  downloadLoading: boolean;
  verifyLoading: boolean;
  verifyResult: AdminFileVerifyResponse | null;
  verifyError: string | null;
  documentIdLookupLoading: boolean;
  documentIdLookupError: string | null;
  documentIdLookupSuccess: boolean;
}

export const initialAdminFileManagerState: AdminFileManagerState = {
  view: 'tenant',
  viewTenantId: null,
  directoriesByPath: {},
  expandedPaths: [''],
  loadingPath: null,
  error: null,
  downloadLoading: false,
  verifyLoading: false,
  verifyResult: null,
  verifyError: null,
  documentIdLookupLoading: false,
  documentIdLookupError: null,
  documentIdLookupSuccess: false,
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
  on(expandAdminFileManagerPath, (state, { path }) => ({
    ...state,
    expandedPaths: state.expandedPaths.includes(path) ? state.expandedPaths : [...state.expandedPaths, path],
  })),
  on(collapseAdminFileManagerPath, (state, { path }) => ({
    ...state,
    expandedPaths:
      path === '' ? [''] : state.expandedPaths.filter((expandedPath) => !isPathOrDescendant(expandedPath, path)),
  })),
  on(refreshAdminFileManager, (state) => ({
    ...state,
    directoriesByPath: {},
    loadingPath: '',
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
    loadingPath: state.loadingPath === path ? null : state.loadingPath,
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
  on(verifyAdminFileManagerFile, (state) => ({
    ...state,
    verifyLoading: true,
    verifyError: null,
    verifyResult: null,
  })),
  on(verifyAdminFileManagerFileSuccess, (state, { result }) => ({
    ...state,
    verifyLoading: false,
    verifyResult: result,
  })),
  on(verifyAdminFileManagerFileFailure, (state, { error }) => ({
    ...state,
    verifyLoading: false,
    verifyError: error,
  })),
  on(clearAdminFileManagerVerifyResult, (state) => ({
    ...state,
    verifyLoading: false,
    verifyResult: null,
    verifyError: null,
  })),
  on(downloadAdminFileManagerByDocumentId, (state) => ({
    ...state,
    documentIdLookupLoading: true,
    documentIdLookupError: null,
    documentIdLookupSuccess: false,
  })),
  on(downloadAdminFileManagerByDocumentIdSuccess, (state) => ({
    ...state,
    documentIdLookupLoading: false,
    documentIdLookupSuccess: true,
  })),
  on(downloadAdminFileManagerByDocumentIdFailure, (state, { error }) => ({
    ...state,
    documentIdLookupLoading: false,
    documentIdLookupError: error,
    documentIdLookupSuccess: false,
  })),
  on(clearAdminFileManagerDocumentIdLookup, (state) => ({
    ...state,
    documentIdLookupLoading: false,
    documentIdLookupError: null,
    documentIdLookupSuccess: false,
  })),
);
