import { createReducer, on } from '@ngrx/store';
import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

import type {
  AdminCustomerProfileListItem,
  CustomerProfileResponse,
  CustomerTrustScoreDetail,
} from '../../types/billing.types';

import {
  createAdminCustomerProfile,
  createAdminCustomerProfileFailure,
  createAdminCustomerProfileSuccess,
  deleteAdminCustomerProfile,
  deleteAdminCustomerProfileFailure,
  deleteAdminCustomerProfileSuccess,
  loadAdminCustomerProfiles,
  loadAdminCustomerProfileTrustScore,
  loadAdminCustomerProfileTrustScoreFailure,
  loadAdminCustomerProfileTrustScoreSuccess,
  loadAdminCustomerProfilesFailure,
  loadAdminCustomerProfilesSuccess,
  recomputeAdminCustomerProfileTrustScore,
  recomputeAdminCustomerProfileTrustScoreFailure,
  recomputeAdminCustomerProfileTrustScoreSuccess,
  saveAdminCustomerProfileCustomData,
  saveAdminCustomerProfileCustomDataFailure,
  saveAdminCustomerProfileCustomDataSuccess,
  updateAdminCustomerProfile,
  updateAdminCustomerProfileFailure,
  updateAdminCustomerProfileSuccess,
} from './admin-customer-profiles.actions';

export interface AdminCustomerProfilesState {
  profiles: AdminCustomerProfileListItem[];
  /** Replace-page paging: server total, 1-based page and its size. */
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  customDataSaving: boolean;
  trustScoreDetail: CustomerTrustScoreDetail | null;
  trustScoreLoading: boolean;
  trustScoreRefreshing: boolean;
  error: string | null;
  search: string | null;
}

export const initialAdminCustomerProfilesState: AdminCustomerProfilesState = {
  profiles: [],
  total: 0,
  page: 1,
  pageSize: BILLING_LIST_PAGE_SIZE,
  loading: false,
  creating: false,
  updating: false,
  deleting: false,
  customDataSaving: false,
  trustScoreDetail: null,
  trustScoreLoading: false,
  trustScoreRefreshing: false,
  error: null,
  search: null,
};

function toOptionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function mapResponseToListItem(profile: CustomerProfileResponse): AdminCustomerProfileListItem {
  return {
    id: profile.id,
    userId: profile.userId,
    customerNumber: profile.customerNumber,
    firstName: toOptionalString(profile.firstName),
    lastName: toOptionalString(profile.lastName),
    company: toOptionalString(profile.company),
    customerType: profile.customerType ?? null,
    vatId: profile.vatId ?? null,
    vatIdValidationStatus: profile.vatIdValidationStatus,
    vatIdValidatedAt: profile.vatIdValidatedAt ?? null,
    vatIdValidationSource: profile.vatIdValidationSource ?? null,
    email: toOptionalString(profile.email),
    country: toOptionalString(profile.country),
    isComplete: false,
    stripeCustomerId: toOptionalString(profile.stripeCustomerId),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function applyTrustDetail(
  profile: AdminCustomerProfileListItem,
  detail: Pick<CustomerTrustScoreDetail, 'profileId' | 'score' | 'level' | 'computedAt'>,
): AdminCustomerProfileListItem {
  if (profile.id !== detail.profileId) {
    return profile;
  }

  return {
    ...profile,
    trustScore: detail.score,
    trustLevel: detail.level,
    trustScoreUpdatedAt: detail.computedAt,
  };
}

export const adminCustomerProfilesReducer = createReducer(
  initialAdminCustomerProfilesState,
  on(loadAdminCustomerProfiles, (state, { search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.pageSize);

    return {
      ...state,
      loading: true,
      trustScoreDetail: null,
      error: null,
      page: window.page,
      pageSize: window.pageSize,
      search: search?.trim() ? search.trim() : null,
    };
  }),
  on(loadAdminCustomerProfilesSuccess, (state, { profiles, total }) => ({
    ...state,
    profiles,
    total,
    loading: false,
    error: null,
  })),
  on(loadAdminCustomerProfilesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(createAdminCustomerProfile, (state) => ({ ...state, creating: true, error: null })),
  on(createAdminCustomerProfileSuccess, (state, { profile }) => ({
    ...state,
    creating: false,
    profiles: [mapResponseToListItem(profile), ...state.profiles],
  })),
  on(createAdminCustomerProfileFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateAdminCustomerProfile, (state) => ({ ...state, updating: true, error: null })),
  on(updateAdminCustomerProfileSuccess, (state, { profile }) => ({
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
            updatedAt: profile.updatedAt,
          }
        : item,
    ),
  })),
  on(updateAdminCustomerProfileFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(deleteAdminCustomerProfile, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteAdminCustomerProfileSuccess, (state, { id }) => ({
    ...state,
    deleting: false,
    profiles: state.profiles.filter((profile) => profile.id !== id),
    total: Math.max(0, state.total - (state.profiles.some((profile) => profile.id === id) ? 1 : 0)),
  })),
  on(deleteAdminCustomerProfileFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(loadAdminCustomerProfileTrustScore, (state) => ({
    ...state,
    trustScoreLoading: true,
    trustScoreDetail: null,
    error: null,
  })),
  on(loadAdminCustomerProfileTrustScoreSuccess, (state, { detail }) => ({
    ...state,
    trustScoreLoading: false,
    trustScoreDetail: detail,
    profiles: state.profiles.map((profile) => applyTrustDetail(profile, detail)),
    error: null,
  })),
  on(loadAdminCustomerProfileTrustScoreFailure, (state, { error }) => ({
    ...state,
    trustScoreLoading: false,
    error,
  })),
  on(recomputeAdminCustomerProfileTrustScore, (state) => ({
    ...state,
    trustScoreRefreshing: true,
    error: null,
  })),
  on(recomputeAdminCustomerProfileTrustScoreSuccess, (state, { detail }) => ({
    ...state,
    trustScoreRefreshing: false,
    trustScoreDetail: detail,
    profiles: state.profiles.map((profile) => applyTrustDetail(profile, detail)),
    error: null,
  })),
  on(recomputeAdminCustomerProfileTrustScoreFailure, (state, { error }) => ({
    ...state,
    trustScoreRefreshing: false,
    error,
  })),
  on(saveAdminCustomerProfileCustomData, (state) => ({
    ...state,
    customDataSaving: true,
    error: null,
  })),
  on(saveAdminCustomerProfileCustomDataSuccess, (state) => ({
    ...state,
    customDataSaving: false,
    error: null,
  })),
  on(saveAdminCustomerProfileCustomDataFailure, (state, { error }) => ({
    ...state,
    customDataSaving: false,
    error,
  })),
);
