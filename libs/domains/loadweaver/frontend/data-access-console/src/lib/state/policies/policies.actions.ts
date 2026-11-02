import { createAction, props } from '@ngrx/store';

import type { GroupMembers, PolicyResource, WorkloadGroupResource } from '../../types/policies.types';

export const loadPolicies = createAction('[ConsolePolicies] Load', props<{ silent?: boolean }>());
export const loadPoliciesSuccess = createAction(
  '[ConsolePolicies] Load Success',
  props<{ groups: WorkloadGroupResource[]; policies: PolicyResource[] }>(),
);
export const loadPoliciesFailure = createAction('[ConsolePolicies] Load Failure', props<{ error: string }>());

/** Members come from the map; without it (or on failure) groups show their selectors only. */
export const loadGroupMembersSuccess = createAction(
  '[ConsolePolicies] Load Members Success',
  props<{ members: GroupMembers }>(),
);
export const loadGroupMembersFailure = createAction(
  '[ConsolePolicies] Load Members Failure',
  props<{ error: string }>(),
);
