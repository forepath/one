import { createReducer, on } from '@ngrx/store';

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
  loadAdminCustomerProfilesBatch,
  loadAdminCustomerProfileTrustScore,
  loadAdminCustomerProfileTrustScoreFailure,
  loadAdminCustomerProfileTrustScoreSuccess,
  loadAdminCustomerProfilesFailure,
  loadAdminCustomerProfilesSuccess,
  recomputeAdminCustomerProfileTrustScore,
  recomputeAdminCustomerProfileTrustScoreFailure,
  recomputeAdminCustomerProfileTrustScoreSuccess,
  updateAdminCustomerProfile,
  updateAdminCustomerProfileFailure,
  updateAdminCustomerProfileSuccess,
} from './admin-customer-profiles.actions';

export interface AdminCustomerProfilesState {
  profiles: AdminCustomerProfileListItem[];
  loading: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  trustScoreDetail: CustomerTrustScoreDetail | null;
  trustScoreLoading: boolean;
  trustScoreRefreshing: boolean;
  error: string | null;
}

export const initialAdminCustomerProfilesState: AdminCustomerProfilesState = {
  profiles: [],
  loading: false,
  creating: false,
  updating: false,
  deleting: false,
  trustScoreDetail: null,
  trustScoreLoading: false,
  trustScoreRefreshing: false,
  error: null,
};

function toOptionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function mapResponseToListItem(profile: CustomerProfileResponse): AdminCustomerProfileListItem {
  return {
    id: profile.id,
    userId: profile.userId,
    firstName: toOptionalString(profile.firstName),
    lastName: toOptionalString(profile.lastName),
    company: toOptionalString(profile.company),
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
  on(loadAdminCustomerProfiles, (state) => ({
    ...state,
    profiles: [],
    loading: true,
    trustScoreDetail: null,
    error: null,
  })),
  on(loadAdminCustomerProfilesBatch, (state, { accumulatedProfiles }) => ({
    ...state,
    profiles: accumulatedProfiles,
    loading: true,
  })),
  on(loadAdminCustomerProfilesSuccess, (state, { profiles }) => ({
    ...state,
    profiles,
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
);
