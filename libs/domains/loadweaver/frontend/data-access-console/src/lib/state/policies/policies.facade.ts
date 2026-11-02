import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { loadPolicies } from './policies.actions';
import {
  selectGroupMembers,
  selectGroupMembersError,
  selectPolicies,
  selectPoliciesError,
  selectPoliciesLoading,
  selectPolicyProjects,
  selectWorkloadGroups,
} from './policies.selectors';

@Injectable()
export class ConsolePoliciesFacade {
  private readonly store = inject(Store);

  readonly groups$ = this.store.select(selectWorkloadGroups);
  readonly policies$ = this.store.select(selectPolicies);
  readonly loading$ = this.store.select(selectPoliciesLoading);
  readonly error$ = this.store.select(selectPoliciesError);
  readonly members$ = this.store.select(selectGroupMembers);
  readonly membersError$ = this.store.select(selectGroupMembersError);
  readonly projects$ = this.store.select(selectPolicyProjects);

  /** `silent`: refresh without the loading state. */
  load(silent = false): void {
    this.store.dispatch(loadPolicies({ silent }));
  }
}
