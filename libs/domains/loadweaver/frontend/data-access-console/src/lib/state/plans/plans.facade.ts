import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { PlanListQuery } from '../../types/plans.types';
import {
  applyPlan,
  approvePlan,
  cancelPlan,
  clearPlanActionError,
  connectPlansLive,
  discardPlan,
  disconnectPlansLive,
  loadPlan,
  loadPlans,
} from './plans.actions';
import {
  selectPlanActing,
  selectPlanActionError,
  selectPlanProjects,
  selectPlans,
  selectPlansError,
  selectPlansLive,
  selectPlansLoading,
  selectPlansQuery,
  selectSelectedPlan,
  selectSelectedPlanError,
  selectSelectedPlanLoading,
} from './plans.selectors';

@Injectable()
export class ConsolePlansFacade {
  private readonly store = inject(Store);

  readonly plans$ = this.store.select(selectPlans);
  readonly query$ = this.store.select(selectPlansQuery);
  readonly loading$ = this.store.select(selectPlansLoading);
  readonly error$ = this.store.select(selectPlansError);
  readonly projects$ = this.store.select(selectPlanProjects);
  readonly selected$ = this.store.select(selectSelectedPlan);
  readonly selectedLoading$ = this.store.select(selectSelectedPlanLoading);
  readonly selectedError$ = this.store.select(selectSelectedPlanError);
  readonly acting$ = this.store.select(selectPlanActing);
  readonly actionError$ = this.store.select(selectPlanActionError);
  readonly live$ = this.store.select(selectPlansLive);

  /** `silent`: refresh without the loading state (periodic refresh). */
  load(query: PlanListQuery = {}, silent = false): void {
    this.store.dispatch(loadPlans({ query, silent }));
  }

  open(id: string): void {
    this.store.dispatch(loadPlan({ id }));
  }

  /** Reads the open plan again without the loading state (e.g. until its pull requests are opened). */
  refresh(id: string): void {
    this.store.dispatch(loadPlan({ id, silent: true }));
  }

  approve(id: string): void {
    this.store.dispatch(approvePlan({ id }));
  }

  /** `confirm`: confirms the plan's unacknowledged pins. */
  apply(id: string, confirm: boolean): void {
    this.store.dispatch(applyPlan({ id, confirm }));
  }

  cancel(id: string): void {
    this.store.dispatch(cancelPlan({ id }));
  }

  discard(id: string): void {
    this.store.dispatch(discardPlan({ id }));
  }

  clearActionError(): void {
    this.store.dispatch(clearPlanActionError());
  }

  /** Live progress over `socket/plans` while a plans view is shown. */
  connectLive(): void {
    this.store.dispatch(connectPlansLive());
  }

  disconnectLive(): void {
    this.store.dispatch(disconnectPlansLive());
  }
}
