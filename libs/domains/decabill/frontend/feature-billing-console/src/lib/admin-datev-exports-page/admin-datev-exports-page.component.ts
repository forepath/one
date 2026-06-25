import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminDatevExportsFacade,
  BillingCapabilitiesFacade,
  isQueuedDatevExportEntry,
  resolveBillingTenantDisplayName,
  type AdminDatevExportListEntry,
  type AdminDatevExportListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import type { DatevExportScope } from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { combineLatestWith, map } from 'rxjs';

import {
  getDatevExportScopeLabel,
  getDatevExportStatusIconClass,
  getDatevExportStatusLabel,
  getDatevExportStatusTextClass,
} from '../billing-status-labels';
import { resolveBillingAdminUserIconClass, resolveBillingAdminUserLabel } from '../billing-user-select';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

@Component({
  selector: 'framework-admin-datev-exports-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [DatePipe],
  templateUrl: './admin-datev-exports-page.component.html',
  styleUrl: './admin-datev-exports-page.component.scss',
})
export class AdminDatevExportsPageComponent implements OnInit {
  @ViewChild('exportModal', { static: false }) private exportModal!: ElementRef<HTMLDivElement>;

  private readonly facade = inject(AdminDatevExportsFacade);
  private readonly capabilitiesFacade = inject(BillingCapabilitiesFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly tenantTabLabel = resolveBillingTenantDisplayName(this.environment);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly items$ = this.facade.items$.pipe(
    combineLatestWith(this.searchQuery$),
    map(([items, searchQuery]) => {
      if (!searchQuery.trim()) {
        return items;
      }

      const term = searchQuery.trim().toLowerCase();

      return items.filter((item) => JSON.stringify(item).toLowerCase().includes(term));
    }),
  );

  readonly loading$ = this.facade.loading$;
  readonly error$ = this.facade.error$;
  readonly scope$ = this.facade.scope$;
  readonly triggerLoading$ = this.facade.triggerLoading$;
  readonly triggerError$ = this.facade.triggerError$;
  readonly unifiedExportAllowed$ = this.capabilitiesFacade.unifiedExportAllowed$;

  readonly items = toSignal(this.items$, { initialValue: [] as AdminDatevExportListEntry[] });
  readonly scope = toSignal(this.scope$, { initialValue: 'tenant' as DatevExportScope });
  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });

  triggerYear = new Date().getFullYear();
  triggerMonth = new Date().getMonth() === 0 ? 12 : new Date().getMonth();
  triggerScope: DatevExportScope = 'tenant';

  ngOnInit(): void {
    this.facade.loadExports({ scope: 'tenant' });
    this.authFacade.loadUsers();
    this.registerModalCloseWatcher();
  }

  openExportModal(): void {
    this.resetTriggerForm();
    showBillingModal(this.exportModal);
  }

  setScope(scope: DatevExportScope): void {
    this.facade.setScope(scope);
  }

  submitTriggerExport(): void {
    this.facade.triggerExport({
      year: this.triggerYear,
      month: this.triggerMonth,
      scope: this.triggerScope,
    });
  }

  downloadExport(exportId: string): void {
    this.facade.downloadExport(exportId);
  }

  exportPrimaryTitle(item: AdminDatevExportListEntry): string {
    return this.formatPeriod(item.periodYear, item.periodMonth);
  }

  exportSecondaryLine(item: AdminDatevExportListEntry): string | null {
    if (isQueuedDatevExportEntry(item)) {
      return null;
    }

    if (item.fileName?.trim()) {
      return item.fileName.trim();
    }

    if (item.status === 'failed' && item.errorMessage?.trim()) {
      return item.errorMessage.trim();
    }

    return null;
  }

  exportStatusLabel(status: AdminDatevExportListItem['status']): string {
    return getDatevExportStatusLabel(status);
  }

  exportStatusTextClass(status: AdminDatevExportListItem['status']): string {
    return getDatevExportStatusTextClass(status);
  }

  exportStatusIconClass(status: AdminDatevExportListItem['status']): string {
    return getDatevExportStatusIconClass(status);
  }

  exportScopeLabel(scope: AdminDatevExportListEntry['scope']): string {
    if (scope === 'tenant') {
      return this.tenantTabLabel;
    }

    return getDatevExportScopeLabel(scope);
  }

  isQueuedExport(item: AdminDatevExportListEntry): boolean {
    return isQueuedDatevExportEntry(item);
  }

  exportItem(item: AdminDatevExportListEntry): AdminDatevExportListItem | null {
    return isQueuedDatevExportEntry(item) ? null : item;
  }

  queuedExportMessage(): string {
    return $localize`:@@featureAdminDatevExports-queuedMessage:Queued — waiting for export to start…`;
  }

  formatDate(value?: string): string {
    if (!value) {
      return '—';
    }

    return this.datePipe.transform(value, 'medium') ?? '—';
  }

  formatCount(value: number): string {
    return String(value);
  }

  triggeredByLabel(triggeredBy?: string): string {
    return resolveBillingAdminUserLabel(triggeredBy, this.users());
  }

  triggeredByIconClass(triggeredBy?: string): string {
    return resolveBillingAdminUserIconClass(triggeredBy);
  }

  formatPeriod(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  private resetTriggerForm(): void {
    this.triggerYear = new Date().getFullYear();
    this.triggerMonth = new Date().getMonth() === 0 ? 12 : new Date().getMonth();
    this.triggerScope = this.scope();
  }

  private registerModalCloseWatcher(): void {
    watchBillingMutationModalClose({
      loading$: this.triggerLoading$,
      error$: this.triggerError$,
      modal: () => this.exportModal,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetTriggerForm(),
    });
  }
}
