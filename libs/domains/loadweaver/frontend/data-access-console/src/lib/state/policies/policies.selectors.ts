import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsolePoliciesState } from './policies.reducer';

export const selectConsolePoliciesState = createFeatureSelector<ConsolePoliciesState>('consolePolicies');

export const selectWorkloadGroups = createSelector(selectConsolePoliciesState, (state) => state.groups);
export const selectPolicies = createSelector(selectConsolePoliciesState, (state) => state.policies);
export const selectPoliciesLoading = createSelector(selectConsolePoliciesState, (state) => state.loading);
export const selectPoliciesError = createSelector(selectConsolePoliciesState, (state) => state.error);
export const selectGroupMembers = createSelector(selectConsolePoliciesState, (state) => state.members);
export const selectGroupMembersError = createSelector(selectConsolePoliciesState, (state) => state.membersError);
/** Projects with groups or policies; cluster-wide policies have none. */
export const selectPolicyProjects = createSelector(selectWorkloadGroups, selectPolicies, (groups, policies) =>
  [...new Set([...groups, ...policies].flatMap((r) => (r.metadata.project ? [r.metadata.project] : [])))].sort(),
);
