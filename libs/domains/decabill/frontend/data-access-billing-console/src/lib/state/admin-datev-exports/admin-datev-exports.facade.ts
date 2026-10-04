import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { AdminDatevExportListParams, DatevExportScope, TriggerDatevExportDto } from '../../types/billing.types';

import { downloadDatevExport, loadAdminDatevExports, triggerDatevExport } from './admin-datev-exports.actions';
import {
  selectAdminDatevExportDisplayItems,
  selectAdminDatevExportsError,
  selectAdminDatevExportsLoading,
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

  loadExports(params: AdminDatevExportListParams): void {
    this.store.dispatch(loadAdminDatevExports({ params }));
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
