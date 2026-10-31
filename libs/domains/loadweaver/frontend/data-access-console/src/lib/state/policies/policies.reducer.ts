import { createReducer, on } from '@ngrx/store';

import type { GroupMembers, PolicyResource, WorkloadGroupResource } from '../../types/policies.types';
import {
  loadGroupMembersFailure,
  loadGroupMembersSuccess,
  loadPolicies,
  loadPoliciesFailure,
  loadPoliciesSuccess,
} from './policies.actions';

export interface ConsolePoliciesState {
  groups: WorkloadGroupResource[];
  policies: PolicyResource[];
  loading: boolean;
  error: string | null;
  /** Null until read (or when the map isn't available). */
  members: GroupMembers | null;
  membersError: string | null;
}

export const initialConsolePoliciesState: ConsolePoliciesState = {
  groups: [],
  policies: [],
  loading: false,
  error: null,
  members: null,
  membersError: null,
};

export const consolePoliciesReducer = createReducer(
  initialConsolePoliciesState,
  on(loadPolicies, (state, { silent }) => ({ ...state, loading: !silent, error: null })),
  on(loadPoliciesSuccess, (state, { groups, policies }) => ({ ...state, groups, policies, loading: false })),
  on(loadPoliciesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadGroupMembersSuccess, (state, { members }) => ({ ...state, members, membersError: null })),
  on(loadGroupMembersFailure, (state, { error }) => ({ ...state, membersError: error })),
);
