import { createReducer, on } from '@ngrx/store';

import type { AuditEntry, AuditFilter, AuditVerification } from '../../types/audit.types';
import {
  loadAuditPage,
  loadAuditPageFailure,
  loadAuditPageSuccess,
  searchAudit,
  verifyAudit,
  verifyAuditFailure,
  verifyAuditSuccess,
} from './audit.actions';

export interface ConsoleAuditState {
  filter: AuditFilter | null;
  limit: number;
  entries: AuditEntry[];
  page: number;
  /** `cursors[i]`: the `before` page `i` was read with (`null` for the newest). */
  cursors: (string | null)[];
  /** The cursor of the next (older) page; `null` on the last. */
  nextBefore: string | null;
  loading: boolean;
  error: string | null;
  verification: AuditVerification | null;
  verifiedAt: string | null;
  verifying: boolean;
  verifyError: string | null;
}

export const initialConsoleAuditState: ConsoleAuditState = {
  filter: null,
  limit: 50,
  entries: [],
  page: 0,
  cursors: [null],
  nextBefore: null,
  loading: false,
  error: null,
  verification: null,
  verifiedAt: null,
  verifying: false,
  verifyError: null,
};

export const consoleAuditReducer = createReducer(
  initialConsoleAuditState,
  on(searchAudit, (state, { filter, limit }) => ({
    ...state,
    filter,
    limit,
    entries: [],
    page: 0,
    cursors: [null],
    nextBefore: null,
    error: null,
  })),
  on(loadAuditPage, (state, { page, before }) => {
    const cursors = state.cursors.slice(0, page);

    cursors[page] = before;

    return { ...state, page, cursors, loading: true, error: null };
  }),
  on(loadAuditPageSuccess, (state, { page, result }) =>
    page === state.page ? { ...state, entries: result.entries, nextBefore: result.before, loading: false } : state,
  ),
  on(loadAuditPageFailure, (state, { page, error }) =>
    page === state.page ? { ...state, entries: [], nextBefore: null, loading: false, error } : state,
  ),
  on(verifyAudit, (state) => ({ ...state, verifying: true, verifyError: null })),
  on(verifyAuditSuccess, (state, { verification, at }) => ({
    ...state,
    verification,
    verifiedAt: at,
    verifying: false,
  })),
  on(verifyAuditFailure, (state, { error }) => ({ ...state, verifying: false, verifyError: error })),
);
