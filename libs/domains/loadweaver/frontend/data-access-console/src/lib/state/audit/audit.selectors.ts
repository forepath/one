import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleAuditState } from './audit.reducer';

export const selectConsoleAuditState = createFeatureSelector<ConsoleAuditState>('consoleAudit');

export const selectAuditFilter = createSelector(selectConsoleAuditState, (state) => state.filter);
export const selectAuditEntries = createSelector(selectConsoleAuditState, (state) => state.entries);
export const selectAuditPage = createSelector(selectConsoleAuditState, (state) => state.page);
export const selectAuditHasNext = createSelector(selectConsoleAuditState, (state) => state.nextBefore !== null);
export const selectAuditHasPrevious = createSelector(selectConsoleAuditState, (state) => state.page > 0);
export const selectAuditLoading = createSelector(selectConsoleAuditState, (state) => state.loading);
export const selectAuditError = createSelector(selectConsoleAuditState, (state) => state.error);
export const selectAuditVerification = createSelector(selectConsoleAuditState, (state) => state.verification);
export const selectAuditVerifiedAt = createSelector(selectConsoleAuditState, (state) => state.verifiedAt);
export const selectAuditVerifying = createSelector(selectConsoleAuditState, (state) => state.verifying);
export const selectAuditVerifyError = createSelector(selectConsoleAuditState, (state) => state.verifyError);
