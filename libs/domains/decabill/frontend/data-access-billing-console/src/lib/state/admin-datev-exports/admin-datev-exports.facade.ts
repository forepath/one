import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { billingPageWindow } from '../../constants/list-paging.constants';
import type { AdminDatevExportListParams, DatevExportScope, TriggerDatevExportDto } from '../../types/billing.types';

import { downloadDatevExport, loadAdminDatevExports, triggerDatevExport } from './admin-datev-exports.actions';
import {
  selectAdminDatevExportDisplayItems,
  selectAdminDatevExportsError,
  selectAdminDatevExportsLoading,
  selectAdminDatevExportsPage,
  selectAdminDatevExportsPageSize,
  selectAdminDatevExportsTotal,
  selectAdminDatevExportsScope,
  selectAdminDatevExportsTriggerError,
  selectAdminDatevExportsTriggerLoading,
  selectAdminDatevExportsViewTenantId,
} from './admin-datev-exports.selectors';

@Injectable()
export class AdminDatevExportsFacade {
  private readonly store = inject(Store);

  readonly items$ = this.store.select(selectAdminDatevExportDisplayItems);
  readonly loading$ = this.store.select(selectAdminDatevExportsLoading);
  readonly error$ = this.store.select(selectAdminDatevExportsError);
  readonly scope$ = this.store.select(selectAdminDatevExportsScope);
  readonly viewTenantId$ = this.store.select(selectAdminDatevExportsViewTenantId);
  readonly triggerLoading$ = this.store.select(selectAdminDatevExportsTriggerLoading);
  readonly triggerError$ = this.store.select(selectAdminDatevExportsTriggerError);
  readonly total$ = this.store.select(selectAdminDatevExportsTotal);
  readonly page$ = this.store.select(selectAdminDatevExportsPage);
  readonly pageSize$ = this.store.select(selectAdminDatevExportsPageSize);

  loadExports(params: AdminDatevExportListParams): void {
    this.store.dispatch(loadAdminDatevExports({ params }));
  }

  /** One page (1-based) of the exports of a scope / tenant view and search; the page replaces the current rows. */
  loadPage(params: Omit<AdminDatevExportListParams, 'limit' | 'offset'> & { page?: number; pageSize?: number }): void {
    const { page, pageSize, ...rest } = params;
    const { limit, offset } = billingPageWindow(page, pageSize);

    this.store.dispatch(loadAdminDatevExports({ params: { ...rest, limit, offset } }));
  }

  setScope(scope: DatevExportScope, viewTenantId?: string): void {
    this.loadExports({
      scope,
      viewTenantId: scope === 'tenant' ? viewTenantId : undefined,
    });
  }

  triggerExport(dto: TriggerDatevExportDto): void {
    this.store.dispatch(triggerDatevExport({ dto }));
  }

  downloadExport(exportId: string, viewTenantId?: string): void {
    this.store.dispatch(downloadDatevExport({ exportId, viewTenantId }));
  }
}
