import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, filter, from, groupBy, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';
import type { Observable } from 'rxjs';

import { AdminAccountingService } from '../../services/admin-accounting.service';

import {
  ACCOUNTING_TENANT_SCOPED_RESOURCES,
  type AccountingMutation,
  type AccountingRequest,
  loadAccountingResource,
  loadAccountingResourceFailure,
  loadAccountingResourceSuccess,
  reloadAccountingResources,
  runAccountingMutation,
  runAccountingMutationFailure,
  runAccountingMutationSuccess,
  setAccountingViewTenant,
} from './accounting.actions';
import { ACCOUNTING_MUTATION_RELOADS } from './accounting.reducer';
import { selectAccountingState, selectAccountingViewTenantId } from './accounting.selectors';

export function normalizeAccountingError(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const body = (error as { error?: { message?: unknown } }).error;
    const message = body?.message;

    if (Array.isArray(message)) return message.join(', ');

    if (typeof message === 'string') return message;
  }

  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  return 'An unexpected error occurred';
}

/** The API call of one read request (`viewTenantId` added for tenant-scoped resources). */
export function accountingRequest$(
  service: AdminAccountingService,
  request: AccountingRequest,
  viewTenantId: string | null,
): Observable<unknown> {
  const tenant = viewTenantId ?? undefined;

  switch (request.key) {
    case 'overview':
      return service.getOverview(tenant);
    case 'templates':
      return service.listChartTemplates();
    case 'charts':
      return service.listCharts();
    case 'accounts':
      return service.listAccounts(request.chartId);
    case 'accountDirectory':
      return service.listAllAccounts();
    case 'taxCodes':
      return service.listTaxCodes(request.chartId);
    case 'fiscalYears':
      return service.listFiscalYears();
    case 'closePreview':
      return service.previewCloseFiscalYear(request.fiscalYearId, request.dto);
    case 'fxRates':
      return service.listFxRates(request.params);
    case 'postingIssues':
      return service.listPostingIssues({
        includeResolved: request.includeResolved,
        limit: request.limit,
        offset: request.offset,
      });
    case 'journal':
      return service.listJournal(request.params, tenant);
    case 'journalStatistics':
      return service.getJournalStatistics(request.range, tenant);
    case 'entry':
      return service.getEntry(request.entryId, tenant);
    case 'byLink':
      return service.listEntriesByLink(request.linkType, request.targetId, tenant);
    case 'trialBalance':
      return service.getTrialBalance(request.range, tenant);
    case 'ledger':
      return service.getAccountLedger(request.params, tenant);
    case 'openItems':
      return service.getOpenItems({ type: request.type, asOf: request.asOf }, tenant);
    case 'statement':
      return service.getStatement(request.params, tenant);
    case 'vatDefinitions':
      return service.listVatDefinitions();
    case 'vatReturns':
      return service.listVatReturns(request.params);
    case 'vatStatistics':
      return service.getVatStatistics();
    case 'vatReturn':
      return service.getVatReturn(request.id);
    case 'financialAccounts':
      return service.listFinancialAccounts(tenant);
    case 'imports':
      return service.listImports({ limit: request.limit, offset: request.offset }, tenant);
    case 'importDetail':
      return service.getImport(request.id);
    case 'transactions':
      return service.listTransactions(request.params, tenant);
    case 'bankStatistics':
      return service.getBankStatistics(request.range, tenant);
    case 'suggestions':
      return service.getSuggestions(request.transactionId);
    case 'csvPresets':
      return service.listCsvPresets();
    case 'csvMappings':
      return service.listCsvMappings();
    case 'matchRules':
      return service.listMatchRules();
    case 'assets':
      return service.listAssets(request.params);
    case 'asset':
      return service.getAsset(request.id);
    case 'assetSchedule':
      return service.getAssetSchedule(request.range);
  }
}

/** The API call of one mutation. */
export function accountingMutation$(
  service: AdminAccountingService,
  mutation: AccountingMutation,
  viewTenantId: string | null,
): Observable<unknown> {
  const tenant = viewTenantId ?? undefined;

  switch (mutation.kind) {
    case 'createChart':
      return service.createChart(mutation.dto);
    case 'createAccount':
      return service.createAccount(mutation.chartId, mutation.dto);
    case 'updateAccount':
      return service.updateAccount(mutation.accountId, mutation.dto);
    case 'deleteAccount':
      return service.deleteAccount(mutation.accountId);
    case 'importAccounts':
      return service.importAccounts(mutation.chartId, mutation.file);
    case 'createTaxCode':
      return service.createTaxCode(mutation.chartId, mutation.dto);
    case 'updateTaxCode':
      return service.updateTaxCode(mutation.taxCodeId, mutation.dto);
    case 'openFiscalYear':
      return service.openFiscalYear(mutation.dto);
    case 'changeFiscalYearChart':
      return service.changeFiscalYearChart(mutation.fiscalYearId, mutation.chartId);
    case 'lockPeriod':
      return service.lockPeriod(mutation.periodId);
    case 'closeFiscalYear':
      return service.closeFiscalYear(mutation.fiscalYearId, mutation.dto);
    case 'setFxRate':
      return service.setFxRate(mutation.dto);
    case 'fetchEcbRates':
      return service.fetchEcbRates();
    case 'runCatchUp':
      return service.runCatchUp();
    case 'createManualEntry':
      return service.createManualEntry(mutation.dto, tenant);
    case 'reverseEntry':
      return service.reverseEntry(mutation.entryId, mutation.dto, tenant);
    case 'addLink':
      return service.addLink(mutation.entryId, mutation.dto, tenant);
    case 'removeLink':
      return service.removeLink(mutation.entryId, mutation.linkId, tenant);
    case 'attachReceipt':
      return service.attachReceipt(mutation.entryId, mutation.file, tenant);
    case 'computeVatReturn':
      return service.computeVatReturn(mutation.dto);
    case 'submitVatReturn':
      return service.submitVatReturn(mutation.id, mutation.dto);
    case 'payVatReturn':
      return service.payVatReturn(mutation.id, mutation.dto);
    case 'saveFinancialAccount':
      return mutation.id
        ? service.updateFinancialAccount(mutation.id, mutation.dto)
        : service.createFinancialAccount(mutation.dto);
    case 'uploadImport':
      return service.uploadImport(mutation.upload);
    case 'rollbackImport':
      return service.rollbackImport(mutation.id);
    case 'matchTransaction':
      return service.matchTransaction(mutation.transactionId, mutation.dto);
    case 'unmatchTransaction':
      return service.unmatchTransaction(mutation.transactionId);
    case 'ignoreTransaction':
      return service.ignoreTransaction(mutation.transactionId);
    case 'saveCsvMapping':
      return mutation.id ? service.updateCsvMapping(mutation.id, mutation.dto) : service.createCsvMapping(mutation.dto);
    case 'deleteCsvMapping':
      return service.deleteCsvMapping(mutation.id);
    case 'createMatchRule':
      return service.createMatchRule(mutation.dto);
    case 'deleteMatchRule':
      return service.deleteMatchRule(mutation.id);
    case 'runProcessorSync':
      return service.runProcessorSync();
    case 'createAsset':
      return service.createAsset(mutation.dto);
    case 'runDepreciation':
      return service.runDepreciation(mutation.through);
    case 'disposeAsset':
      return service.disposeAsset(mutation.id, mutation.dto);
  }
}

/** One stream per resource: a newer request of a resource cancels its older one, other resources are unaffected. */
export const loadAccountingResource$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(AdminAccountingService)) =>
    actions$.pipe(
      ofType(loadAccountingResource),
      withLatestFrom(store.select(selectAccountingViewTenantId)),
      groupBy(([{ request }]) => request.key),
      mergeMap((group$) =>
        group$.pipe(
          switchMap(([{ request }, viewTenantId]) =>
            accountingRequest$(service, request, viewTenantId).pipe(
              map((data) => loadAccountingResourceSuccess({ key: request.key, data })),
              catchError((error) =>
                of(loadAccountingResourceFailure({ key: request.key, error: normalizeAccountingError(error) })),
              ),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const runAccountingMutation$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(AdminAccountingService)) =>
    actions$.pipe(
      ofType(runAccountingMutation),
      withLatestFrom(store.select(selectAccountingViewTenantId)),
      concatMap(([{ mutation }, viewTenantId]) =>
        accountingMutation$(service, mutation, viewTenantId).pipe(
          mergeMap((result) =>
            from([
              runAccountingMutationSuccess({ kind: mutation.kind, result: result ?? null }),
              reloadAccountingResources({ keys: ACCOUNTING_MUTATION_RELOADS[mutation.kind] }),
            ]),
          ),
          catchError((error) =>
            of(runAccountingMutationFailure({ kind: mutation.kind, error: normalizeAccountingError(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Re-runs the last request of each given resource that was requested before (silently: data stays visible). */
export const reloadAccountingResources$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(reloadAccountingResources),
      withLatestFrom(store.select(selectAccountingState)),
      mergeMap(([{ keys }, state]) =>
        from(
          keys
            .map((key) => state.requests[key])
            .filter((request): request is AccountingRequest => Boolean(request))
            .map((request) => loadAccountingResource({ request, silent: true })),
        ),
      ),
    ),
  { functional: true },
);

/** A tenant tab switch reloads the tenant-scoped resources already on screen (with the loading state). */
export const reloadAccountingOnTenantChange$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(setAccountingViewTenant),
      withLatestFrom(store.select(selectAccountingState)),
      map(([, state]) =>
        ACCOUNTING_TENANT_SCOPED_RESOURCES.map((key) => state.requests[key]).filter(
          (request): request is AccountingRequest => Boolean(request),
        ),
      ),
      filter((requests) => requests.length > 0),
      mergeMap((requests) => from(requests.map((request) => loadAccountingResource({ request })))),
    ),
  { functional: true },
);
