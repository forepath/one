import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminSupplierProfilesState } from './admin-supplier-profiles.reducer';

export const selectAdminSupplierProfilesState =
  createFeatureSelector<AdminSupplierProfilesState>('adminSupplierProfiles');

export const selectAdminSupplierProfiles = createSelector(selectAdminSupplierProfilesState, (state) => state.profiles);

export const selectAdminSupplierProfilesLoading = createSelector(
  selectAdminSupplierProfilesState,
  (state) => state.loading,
);

export const selectAdminSupplierProfilesCreating = createSelector(
  selectAdminSupplierProfilesState,
  (state) => state.creating,
);

export const selectAdminSupplierProfilesUpdating = createSelector(
  selectAdminSupplierProfilesState,
  (state) => state.updating,
);

export const selectAdminSupplierProfilesDeleting = createSelector(
  selectAdminSupplierProfilesState,
  (state) => state.deleting,
);

export const selectAdminSupplierProfilesCustomDataSaving = createSelector(
  selectAdminSupplierProfilesState,
  (state) => state.customDataSaving,
);

export const selectAdminSupplierProfilesError = createSelector(
  selectAdminSupplierProfilesState,
  (state) => state.error,
);

export const selectAdminSupplierProfilesTotal = createSelector(
  selectAdminSupplierProfilesState,
  (state) => state.total,
);
export const selectAdminSupplierProfilesPage = createSelector(selectAdminSupplierProfilesState, (state) => state.page);
export const selectAdminSupplierProfilesPageSize = createSelector(
  selectAdminSupplierProfilesState,
  (state) => state.pageSize,
);
