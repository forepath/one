import { createAction, props } from '@ngrx/store';

import type {
  AdminCustomerProfileListItem,
  CustomerTrustScoreDetail,
  CreateAdminCustomerProfileDto,
  CustomerProfileDto,
  CustomerProfileResponse,
} from '../../types/billing.types';

export const loadAdminCustomerProfiles = createAction('[AdminCustomerProfiles] Load Profiles');
export const loadAdminCustomerProfilesBatch = createAction(
  '[AdminCustomerProfiles] Load Profiles Batch',
  props<{ offset: number; accumulatedProfiles: AdminCustomerProfileListItem[] }>(),
);
export const loadAdminCustomerProfilesSuccess = createAction(
  '[AdminCustomerProfiles] Load Profiles Success',
  props<{ profiles: AdminCustomerProfileListItem[] }>(),
);
export const loadAdminCustomerProfilesFailure = createAction(
  '[AdminCustomerProfiles] Load Profiles Failure',
  props<{ error: string }>(),
);

export const createAdminCustomerProfile = createAction(
  '[AdminCustomerProfiles] Create Profile',
  props<{ dto: CreateAdminCustomerProfileDto }>(),
);
export const createAdminCustomerProfileSuccess = createAction(
  '[AdminCustomerProfiles] Create Profile Success',
  props<{ profile: CustomerProfileResponse }>(),
);
export const createAdminCustomerProfileFailure = createAction(
  '[AdminCustomerProfiles] Create Profile Failure',
  props<{ error: string }>(),
);

export const updateAdminCustomerProfile = createAction(
  '[AdminCustomerProfiles] Update Profile',
  props<{ id: string; dto: CustomerProfileDto }>(),
);
export const updateAdminCustomerProfileSuccess = createAction(
  '[AdminCustomerProfiles] Update Profile Success',
  props<{ profile: CustomerProfileResponse }>(),
);
export const updateAdminCustomerProfileFailure = createAction(
  '[AdminCustomerProfiles] Update Profile Failure',
  props<{ error: string }>(),
);

export const deleteAdminCustomerProfile = createAction(
  '[AdminCustomerProfiles] Delete Profile',
  props<{ id: string }>(),
);
export const deleteAdminCustomerProfileSuccess = createAction(
  '[AdminCustomerProfiles] Delete Profile Success',
  props<{ id: string }>(),
);
export const deleteAdminCustomerProfileFailure = createAction(
  '[AdminCustomerProfiles] Delete Profile Failure',
  props<{ error: string }>(),
);

export const loadAdminCustomerProfileTrustScore = createAction(
  '[AdminCustomerProfiles] Load Trust Score',
  props<{ id: string }>(),
);
export const loadAdminCustomerProfileTrustScoreSuccess = createAction(
  '[AdminCustomerProfiles] Load Trust Score Success',
  props<{ detail: CustomerTrustScoreDetail }>(),
);
export const loadAdminCustomerProfileTrustScoreFailure = createAction(
  '[AdminCustomerProfiles] Load Trust Score Failure',
  props<{ error: string }>(),
);

export const recomputeAdminCustomerProfileTrustScore = createAction(
  '[AdminCustomerProfiles] Recompute Trust Score',
  props<{ id: string }>(),
);
export const recomputeAdminCustomerProfileTrustScoreSuccess = createAction(
  '[AdminCustomerProfiles] Recompute Trust Score Success',
  props<{ detail: CustomerTrustScoreDetail }>(),
);
export const recomputeAdminCustomerProfileTrustScoreFailure = createAction(
  '[AdminCustomerProfiles] Recompute Trust Score Failure',
  props<{ error: string }>(),
);
