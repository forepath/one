import { createAction, props } from '@ngrx/store';

import type {
  AdminSupplierProfileDetail,
  AdminSupplierProfileListItem,
  CreateAdminSupplierProfileDto,
  SupplierProfileDto,
} from '../../types/suppliers.types';

export const loadAdminSupplierProfiles = createAction(
  '[AdminSupplierProfiles] Load Profiles',
  props<{ search?: string; page?: number; pageSize?: number }>(),
);
export const loadAdminSupplierProfilesSuccess = createAction(
  '[AdminSupplierProfiles] Load Profiles Success',
  props<{ profiles: AdminSupplierProfileListItem[]; total: number }>(),
);
export const loadAdminSupplierProfilesFailure = createAction(
  '[AdminSupplierProfiles] Load Profiles Failure',
  props<{ error: string }>(),
);

export const createAdminSupplierProfile = createAction(
  '[AdminSupplierProfiles] Create Profile',
  props<{ dto: CreateAdminSupplierProfileDto }>(),
);
export const createAdminSupplierProfileSuccess = createAction(
  '[AdminSupplierProfiles] Create Profile Success',
  props<{ profile: AdminSupplierProfileDetail }>(),
);
export const createAdminSupplierProfileFailure = createAction(
  '[AdminSupplierProfiles] Create Profile Failure',
  props<{ error: string }>(),
);

export const updateAdminSupplierProfile = createAction(
  '[AdminSupplierProfiles] Update Profile',
  props<{ id: string; dto: SupplierProfileDto }>(),
);
export const updateAdminSupplierProfileSuccess = createAction(
  '[AdminSupplierProfiles] Update Profile Success',
  props<{ profile: AdminSupplierProfileDetail }>(),
);
export const updateAdminSupplierProfileFailure = createAction(
  '[AdminSupplierProfiles] Update Profile Failure',
  props<{ error: string }>(),
);

export const deleteAdminSupplierProfile = createAction(
  '[AdminSupplierProfiles] Delete Profile',
  props<{ id: string }>(),
);
export const deleteAdminSupplierProfileSuccess = createAction(
  '[AdminSupplierProfiles] Delete Profile Success',
  props<{ id: string }>(),
);
export const deleteAdminSupplierProfileFailure = createAction(
  '[AdminSupplierProfiles] Delete Profile Failure',
  props<{ error: string }>(),
);

export const saveAdminSupplierProfileCustomData = createAction(
  '[AdminSupplierProfiles] Save Custom Data',
  props<{ id: string; original: Record<string, string>; next: Record<string, string> }>(),
);
export const saveAdminSupplierProfileCustomDataSuccess = createAction(
  '[AdminSupplierProfiles] Save Custom Data Success',
  props<{ detail: AdminSupplierProfileDetail }>(),
);
export const saveAdminSupplierProfileCustomDataFailure = createAction(
  '[AdminSupplierProfiles] Save Custom Data Failure',
  props<{ error: string }>(),
);
