import { createReducer, on } from '@ngrx/store';

import type { IdentityAppGrantResponseDto, IdentityAppResponseDto } from '../../types/identity-app.types';

import {
  clearIdentityAppSecret,
  clearIdentityAppsError,
  createIdentityApp,
  createIdentityAppFailure,
  createIdentityAppSuccess,
  deleteIdentityApp,
  deleteIdentityAppFailure,
  deleteIdentityAppSuccess,
  loadIdentityAppGrants,
  loadIdentityAppGrantsFailure,
  loadIdentityAppGrantsSuccess,
  loadIdentityApps,
  loadIdentityAppsFailure,
  loadIdentityAppsSuccess,
  loadOwnAppGrants,
  loadOwnAppGrantsFailure,
  loadOwnAppGrantsSuccess,
  revokeAllIdentityAppGrants,
  revokeAllIdentityAppGrantsFailure,
  revokeAllIdentityAppGrantsSuccess,
  revokeIdentityAppGrant,
  revokeIdentityAppGrantFailure,
  revokeIdentityAppGrantSuccess,
  revokeOwnAppGrant,
  revokeOwnAppGrantFailure,
  revokeOwnAppGrantSuccess,
  rotateIdentityAppSecret,
  rotateIdentityAppSecretFailure,
  rotateIdentityAppSecretSuccess,
  updateIdentityApp,
  updateIdentityAppFailure,
  updateIdentityAppSuccess,
} from './identity-apps.actions';

function sortApps(apps: IdentityAppResponseDto[]): IdentityAppResponseDto[] {
  return [...apps].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

/** Drop the one-time plaintext secret before an app goes into the list. */
function withoutSecret(app: IdentityAppResponseDto): IdentityAppResponseDto {
  const { secret: _secret, ...rest } = app;

  return rest;
}

function upsert(apps: IdentityAppResponseDto[], app: IdentityAppResponseDto): IdentityAppResponseDto[] {
  return sortApps([...apps.filter((item) => item.id !== app.id), withoutSecret(app)]);
}

export interface IdentityAppsState {
  apps: IdentityAppResponseDto[];
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  /** Plaintext secret after create/rotate; shown once. */
  lastSecret: string | null;
  grantsAppId: string | null;
  grants: IdentityAppGrantResponseDto[];
  grantsLoading: boolean;
  grantsRevoking: boolean;
  grantsError: string | null;
  ownGrants: IdentityAppGrantResponseDto[];
  ownGrantsLoading: boolean;
  ownGrantsRevoking: boolean;
  ownGrantsError: string | null;
}

export const initialIdentityAppsState: IdentityAppsState = {
  apps: [],
  loading: false,
  saving: false,
  deleting: false,
  error: null,
  lastSecret: null,
  grantsAppId: null,
  grants: [],
  grantsLoading: false,
  grantsRevoking: false,
  grantsError: null,
  ownGrants: [],
  ownGrantsLoading: false,
  ownGrantsRevoking: false,
  ownGrantsError: null,
};

export const identityAppsReducer = createReducer(
  initialIdentityAppsState,
  on(loadIdentityApps, (state) => ({ ...state, loading: true, error: null })),
  on(loadIdentityAppsSuccess, (state, { apps }) => ({ ...state, loading: false, apps: sortApps(apps), error: null })),
  on(loadIdentityAppsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(createIdentityApp, updateIdentityApp, rotateIdentityAppSecret, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(createIdentityAppSuccess, rotateIdentityAppSecretSuccess, (state, { app }) => ({
    ...state,
    saving: false,
    apps: upsert(state.apps, app),
    lastSecret: app.secret ?? null,
    error: null,
  })),
  on(updateIdentityAppSuccess, (state, { app }) => ({
    ...state,
    saving: false,
    apps: upsert(state.apps, app),
    error: null,
  })),
  on(createIdentityAppFailure, updateIdentityAppFailure, rotateIdentityAppSecretFailure, (state, { error }) => ({
    ...state,
    saving: false,
    error,
  })),
  on(deleteIdentityApp, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteIdentityAppSuccess, (state, { id }) => ({
    ...state,
    deleting: false,
    apps: state.apps.filter((app) => app.id !== id),
    error: null,
  })),
  on(deleteIdentityAppFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(clearIdentityAppSecret, (state) => ({ ...state, lastSecret: null })),
  on(clearIdentityAppsError, (state) => ({ ...state, error: null })),
  on(loadIdentityAppGrants, (state, { appId }) => ({
    ...state,
    grantsAppId: appId,
    grants: state.grantsAppId === appId ? state.grants : [],
    grantsLoading: true,
    grantsError: null,
  })),
  on(loadIdentityAppGrantsSuccess, (state, { appId, grants }) =>
    state.grantsAppId === appId ? { ...state, grants, grantsLoading: false, grantsError: null } : state,
  ),
  on(loadIdentityAppGrantsFailure, (state, { error }) => ({ ...state, grantsLoading: false, grantsError: error })),
  on(revokeIdentityAppGrant, revokeAllIdentityAppGrants, (state) => ({
    ...state,
    grantsRevoking: true,
    grantsError: null,
  })),
  on(revokeIdentityAppGrantSuccess, (state, { appId, grantId }) => ({
    ...state,
    grantsRevoking: false,
    grants: state.grants.filter((grant) => grant.id !== grantId),
    apps: state.apps.map((app) => (app.id === appId ? { ...app, grantCount: Math.max(0, app.grantCount - 1) } : app)),
  })),
  on(revokeAllIdentityAppGrantsSuccess, (state, { appId }) => ({
    ...state,
    grantsRevoking: false,
    grants: state.grantsAppId === appId ? [] : state.grants,
    apps: state.apps.map((app) => (app.id === appId ? { ...app, grantCount: 0 } : app)),
  })),
  on(revokeIdentityAppGrantFailure, revokeAllIdentityAppGrantsFailure, (state, { error }) => ({
    ...state,
    grantsRevoking: false,
    grantsError: error,
  })),
  on(loadOwnAppGrants, (state) => ({ ...state, ownGrantsLoading: true, ownGrantsError: null })),
  on(loadOwnAppGrantsSuccess, (state, { grants }) => ({
    ...state,
    ownGrants: grants,
    ownGrantsLoading: false,
    ownGrantsError: null,
  })),
  on(loadOwnAppGrantsFailure, (state, { error }) => ({ ...state, ownGrantsLoading: false, ownGrantsError: error })),
  on(revokeOwnAppGrant, (state) => ({ ...state, ownGrantsRevoking: true, ownGrantsError: null })),
  on(revokeOwnAppGrantSuccess, (state, { grantId }) => ({
    ...state,
    ownGrantsRevoking: false,
    ownGrants: state.ownGrants.filter((grant) => grant.id !== grantId),
  })),
  on(revokeOwnAppGrantFailure, (state, { error }) => ({ ...state, ownGrantsRevoking: false, ownGrantsError: error })),
);
