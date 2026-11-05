import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { IdentityAppsState } from './identity-apps.reducer';

export const selectIdentityAppsState = createFeatureSelector<IdentityAppsState>('identityApps');

export const selectIdentityApps = createSelector(selectIdentityAppsState, (state) => state.apps);
export const selectIdentityAppsLoading = createSelector(selectIdentityAppsState, (state) => state.loading);
export const selectIdentityAppsSaving = createSelector(selectIdentityAppsState, (state) => state.saving);
export const selectIdentityAppsDeleting = createSelector(selectIdentityAppsState, (state) => state.deleting);
export const selectIdentityAppsError = createSelector(selectIdentityAppsState, (state) => state.error);
export const selectIdentityAppLastSecret = createSelector(selectIdentityAppsState, (state) => state.lastSecret);

export const selectIdentityAppGrants = createSelector(selectIdentityAppsState, (state) => state.grants);
export const selectIdentityAppGrantsLoading = createSelector(selectIdentityAppsState, (state) => state.grantsLoading);
export const selectIdentityAppGrantsRevoking = createSelector(selectIdentityAppsState, (state) => state.grantsRevoking);
export const selectIdentityAppGrantsError = createSelector(selectIdentityAppsState, (state) => state.grantsError);

export const selectOwnAppGrants = createSelector(selectIdentityAppsState, (state) => state.ownGrants);
export const selectOwnAppGrantsLoading = createSelector(selectIdentityAppsState, (state) => state.ownGrantsLoading);
export const selectOwnAppGrantsRevoking = createSelector(selectIdentityAppsState, (state) => state.ownGrantsRevoking);
export const selectOwnAppGrantsError = createSelector(selectIdentityAppsState, (state) => state.ownGrantsError);
