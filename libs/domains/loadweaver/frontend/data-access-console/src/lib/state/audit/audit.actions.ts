import { createAction, props } from '@ngrx/store';

import type { AuditFilter, AuditPage, AuditVerification } from '../../types/audit.types';

/** A new search: the newest page of the filter. */
export const searchAudit = createAction('[ConsoleAudit] Search', props<{ filter: AuditFilter; limit: number }>());
/** Page `page` of the current search, entries before `before` (`null` for the newest). */
export const loadAuditPage = createAction('[ConsoleAudit] Load Page', props<{ page: number; before: string | null }>());
export const loadAuditPageSuccess = createAction(
  '[ConsoleAudit] Load Page Success',
  props<{ page: number; result: AuditPage }>(),
);
export const loadAuditPageFailure = createAction(
  '[ConsoleAudit] Load Page Failure',
  props<{ page: number; error: string }>(),
);
export const nextAuditPage = createAction('[ConsoleAudit] Next Page');
export const previousAuditPage = createAction('[ConsoleAudit] Previous Page');

/** Verifies the hash chain and its anchors (auditors and cluster admins). */
export const verifyAudit = createAction('[ConsoleAudit] Verify');
export const verifyAuditSuccess = createAction(
  '[ConsoleAudit] Verify Success',
  props<{ verification: AuditVerification; at: string }>(),
);
export const verifyAuditFailure = createAction('[ConsoleAudit] Verify Failure', props<{ error: string }>());
