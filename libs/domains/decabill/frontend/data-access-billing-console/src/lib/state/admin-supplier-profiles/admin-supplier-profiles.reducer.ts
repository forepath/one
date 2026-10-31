import { createReducer, on } from '@ngrx/store';
import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

import type { AdminSupplierProfileListItem } from '../../types/suppliers.types';

import {
  createAdminSupplierProfile,
  createAdminSupplierProfileFailure,
  createAdminSupplierProfileSuccess,
  deleteAdminSupplierProfile,
  deleteAdminSupplierProfileFailure,
  deleteAdminSupplierProfileSuccess,
  loadAdminSupplierProfiles,
  loadAdminSupplierProfilesFailure,
  loadAdminSupplierProfilesSuccess,
  saveAdminSupplierProfileCustomData,
  saveAdminSupplierProfileCustomDataFailure,
  saveAdminSupplierProfileCustomDataSuccess,
  updateAdminSupplierProfile,
  updateAdminSupplierProfileFailure,
  updateAdminSupplierProfileSuccess,
} from './admin-supplier-profiles.actions';

export interface AdminSupplierProfilesState {
  profiles: AdminSupplierProfileListItem[];
  /** Replace-page paging: server total, 1-based page and its size. */
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  customDataSaving: boolean;
  error: string | null;
  search: string | null;
}

export const initialAdminSupplierProfilesState: AdminSupplierProfilesState = {
  profiles: [],
  total: 0,
  page: 1,
  pageSize: BILLING_LIST_PAGE_SIZE,
  loading: false,
  creating: false,
  updating: false,
  deleting: false,
  customDataSaving: false,
  error: null,
  search: null,
};

function toOptionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function mapDetailToListItem(profile: {
  id: string;
  supplierNumber: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
  country?: string | null;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
}): AdminSupplierProfileListItem {
  return {
    id: profile.id,
    supplierNumber: profile.supplierNumber,
    firstName: toOptionalString(profile.firstName),
    lastName: toOptionalString(profile.lastName),
    company: toOptionalString(profile.company),
    email: toOptionalString(profile.email),
    country: toOptionalString(profile.country),
    isComplete: profile.isComplete,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export const adminSupplierProfilesReducer = createReducer(
  initialAdminSupplierProfilesState,
  on(loadAdminSupplierProfiles, (state, { search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.pageSize);

    return {
      ...state,
      loading: true,
      error: null,
      page: window.page,
      pageSize: window.pageSize,
      search: search?.trim() ? search.trim() : null,
    };
  }),
  on(loadAdminSupplierProfilesSuccess, (state, { profiles, total }) => ({
    ...state,
    profiles,
    total,
    loading: false,
    error: null,
  })),
  on(loadAdminSupplierProfilesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(createAdminSupplierProfile, (state) => ({ ...state, creating: true, error: null })),
  on(createAdminSupplierProfileSuccess, (state, { profile }) => ({
    ...state,
    creating: false,
    profiles: [mapDetailToListItem(profile), ...state.profiles],
  })),
  on(createAdminSupplierProfileFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateAdminSupplierProfile, (state) => ({ ...state, updating: true, error: null })),
  on(updateAdminSupplierProfileSuccess, (state, { profile }) => ({
    ...state,
    updating: false,
    profiles: state.profiles.map((item) =>
      item.id === profile.id
        ? {
            ...item,
            firstName: toOptionalString(profile.firstName),
            lastName: toOptionalString(profile.lastName),
            company: toOptionalString(profile.company),
            email: toOptionalString(profile.email),
            country: toOptionalString(profile.country),
            isComplete: profile.isComplete,
            updatedAt: profile.updatedAt,
          }
        : item,
    ),
  })),
  on(updateAdminSupplierProfileFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(deleteAdminSupplierProfile, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteAdminSupplierProfileSuccess, (state, { id }) => ({
    ...state,
    deleting: false,
    profiles: state.profiles.filter((profile) => profile.id !== id),
  })),
  on(deleteAdminSupplierProfileFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(saveAdminSupplierProfileCustomData, (state) => ({
    ...state,
    customDataSaving: true,
    error: null,
  })),
  on(saveAdminSupplierProfileCustomDataSuccess, (state) => ({
    ...state,
    customDataSaving: false,
    error: null,
  })),
  on(saveAdminSupplierProfileCustomDataFailure, (state, { error }) => ({
    ...state,
    customDataSaving: false,
    error,
  })),
);
