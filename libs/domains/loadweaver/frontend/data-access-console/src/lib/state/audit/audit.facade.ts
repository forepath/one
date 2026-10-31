import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { AuditFilter } from '../../types/audit.types';
import { nextAuditPage, previousAuditPage, searchAudit, verifyAudit } from './audit.actions';
import {
  selectAuditEntries,
  selectAuditError,
  selectAuditFilter,
  selectAuditHasNext,
  selectAuditHasPrevious,
  selectAuditLoading,
  selectAuditPage,
  selectAuditVerification,
  selectAuditVerifiedAt,
  selectAuditVerifyError,
  selectAuditVerifying,
} from './audit.selectors';

@Injectable()
export class ConsoleAuditFacade {
  private readonly store = inject(Store);

  readonly filter$ = this.store.select(selectAuditFilter);
  readonly entries$ = this.store.select(selectAuditEntries);
  readonly page$ = this.store.select(selectAuditPage);
  readonly hasNext$ = this.store.select(selectAuditHasNext);
  readonly hasPrevious$ = this.store.select(selectAuditHasPrevious);
  readonly loading$ = this.store.select(selectAuditLoading);
  readonly error$ = this.store.select(selectAuditError);
  readonly verification$ = this.store.select(selectAuditVerification);
  readonly verifiedAt$ = this.store.select(selectAuditVerifiedAt);
  readonly verifying$ = this.store.select(selectAuditVerifying);
  readonly verifyError$ = this.store.select(selectAuditVerifyError);

  search(filter: AuditFilter, limit = 50): void {
    this.store.dispatch(searchAudit({ filter, limit }));
  }

  /** Older entries. */
  next(): void {
    this.store.dispatch(nextAuditPage());
  }

  previous(): void {
    this.store.dispatch(previousAuditPage());
  }

  verify(): void {
    this.store.dispatch(verifyAudit());
  }
}
