import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { ProposeDriftPlan } from '../../types/drift.types';
import { clearDriftProposeError, loadDrift, proposeDriftPlan } from './drift.actions';
import {
  selectDriftCount,
  selectDriftError,
  selectDriftLoading,
  selectDriftProposeError,
  selectDriftProposing,
  selectDriftReport,
} from './drift.selectors';

@Injectable()
export class ConsoleDriftFacade {
  private readonly store = inject(Store);

  readonly report$ = this.store.select(selectDriftReport);
  readonly loading$ = this.store.select(selectDriftLoading);
  readonly error$ = this.store.select(selectDriftError);
  readonly count$ = this.store.select(selectDriftCount);
  readonly proposing$ = this.store.select(selectDriftProposing);
  readonly proposeError$ = this.store.select(selectDriftProposeError);

  /** `silent`: refresh without the loading state (periodic refresh). */
  load(silent = false): void {
    this.store.dispatch(loadDrift({ silent }));
  }

  propose(proposal: ProposeDriftPlan): void {
    this.store.dispatch(proposeDriftPlan({ proposal }));
  }

  clearProposeError(): void {
    this.store.dispatch(clearDriftProposeError());
  }
}
