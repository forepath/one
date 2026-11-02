import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminBillingService,
  AdminDatevExportsFacade,
  BillingCapabilitiesFacade,
  isQueuedDatevExportEntry,
  resolveBillingTenantDisplayName,
  type AdminDatevExportListEntry,
  type AdminDatevExportListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import type { DatevExportScope } from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';
import { ENVIRONMENT, type Environment } from '@forepath/decabill/frontend/util-configuration';
import { combineLatest, firstValueFrom, map } from 'rxjs';

import {
  getDatevExportScopeLabel,
  getDatevExportStatusBadgeTone,
  getDatevExportStatusLabel,
} from '../billing-status-labels';
import { resolveBillingAdminUserLabel } from '../billing-user-select';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { formatBillingDateTime } from '../billing-format';

@Component({
  selector: 'framework-admin-datev-exports-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
  ],
  providers: [DatePipe],
  templateUrl: './admin-datev-exports-page.component.html',
  styleUrl: './admin-datev-exports-page.component.scss',
})
export class AdminDatevExportsPageComponent implements OnInit {
  private readonly facade = inject(AdminDatevExportsFacade);
  private readonly billingService = inject(AdminBillingService);
  private readonly capabilitiesFacade = inject(BillingCapabilitiesFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly homeTenantId = this.environment.billing?.tenantId?.trim() || 'default';
  readonly homeTenantTabLabel = resolveBillingTenantDisplayName(this.environment);
  readonly pageTitle = $localize`:@@featureAdminDatevExports-title:DATEV exports`;
  readonly unifiedTabLabel = $localize`:@@featureAdminDatevExports-tabUnified:Unified`;
  readonly searchPlaceholder = $localize`:@@featureAdminDatevExports-searchPlaceholder:Search exports`;
  readonly exportMonthAriaLabel = $localize`:@@featureAdminDatevExports-trigger:Export month`;

  readonly exportModalOpen = signal(false);
  /** Scope tab (home / viewed tenant or unified): a change reloads from page 1. */
  private readonly viewScope = signal<DatevExportScope>('tenant');
  private readonly viewTenant = signal(this.homeTenantId);
  /**
   * Scope + search + page + size → `GET /admin/billing/datev-exports?scope&viewTenantId&search&limit&offset`
   * (replace-page; URL q / p / n).
   */
  readonly paging = dbServerPaging(
    (query) => {
      const scope = untracked(this.viewScope);

      this.facade.loadPage({
        scope,
        viewTenantId: scope === 'tenant' ? untracked(this.viewTenant) : undefined,
        search: query.search,
        page: query.page,
        pageSize: query.pageSize,
      });
    },
    { url: '', filters: () => [this.viewScope(), this.viewTenant()] },
  );
  readonly total = toSignal(this.facade.total$, { initialValue: 0 });
  readonly items$ = this.facade.items$;

  readonly loading$ = this.facade.loading$;
  readonly error$ = this.facade.error$;
  readonly scope$ = this.facade.scope$;
  readonly viewTenantId$ = this.facade.viewTenantId$;
  readonly triggerLoading$ = this.facade.triggerLoading$;
  readonly triggerError$ = this.facade.triggerError$;
  readonly unifiedExportAllowed$ = this.capabilitiesFacade.unifiedExportAllowed$;
  readonly globalViewsAllowed$ = this.capabilitiesFacade.globalViewsAllowed$;
  readonly viewableTenants$ = this.capabilitiesFacade.viewableTenants$;

  readonly showViewTabs$ = combineLatest([this.globalViewsAllowed$, this.unifiedExportAllowed$]).pipe(
    map(([globalViewsAllowed, unifiedExportAllowed]) => globalViewsAllowed || unifiedExportAllowed),
  );

  readonly activeTabId$ = combineLatest([this.scope$, this.viewTenantId$]).pipe(
    map(([scope, viewTenantId]) => (scope === 'unified' ? 'unified' : (viewTenantId ?? this.homeTenantId))),
  );

  readonly items = toSignal(this.facade.items$, { initialValue: [] as AdminDatevExportListEntry[] });
  readonly scope = toSignal(this.scope$, { initialValue: 'tenant' as DatevExportScope });
  readonly viewTenantId = toSignal(this.viewTenantId$, { initialValue: null as string | null });
  readonly viewableTenants = toSignal(this.viewableTenants$, { initialValue: [] as string[] });
  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });

  readonly columns: FpcTableColumn<AdminDatevExportListEntry>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAdminDatevExports-colStatus:Status`,
      type: 'state',
      state: (item) => this.exportState(item),
    },
    {
      id: 'name',
      label: $localize`:@@featureAdminDatevExports-colPeriod:Period`,
      value: (item) => this.exportPrimaryTitle(item),
      required: true,
      priority: 1,
    },
    {
      id: 'file',
      label: $localize`:@@featureAdminDatevExports-colFile:File`,
      value: (item) =>
        this.isQueuedExport(item) ? this.queuedExportMessage() : (this.exportSecondaryLine(item) ?? ''),
      priority: 2,
    },
    {
      id: 'scope',
      label: $localize`:@@featureAdminDatevExports-colScope:Scope`,
      value: (item) => this.exportScopeLabel(item.scope),
      priority: 3,
    },
    {
      id: 'bookings',
      label: $localize`:@@featureAdminDatevExports-metaBookings:Bookings`,
      value: (item) => this.exportItem(item)?.bookingCount ?? null,
      align: 'end',
      priority: 2,
    },
    {
      id: 'invoices',
      label: $localize`:@@featureAdminDatevExports-metaInvoices:Invoices`,
      value: (item) => this.exportItem(item)?.invoiceCount ?? null,
      align: 'end',
      priority: 3,
    },
    {
      id: 'debtors',
      label: $localize`:@@featureAdminDatevExports-metaDebtors:Debtors`,
      value: (item) => this.exportItem(item)?.debtorCount ?? null,
      align: 'end',
      priority: 3,
    },
    {
      id: 'completed',
      label: $localize`:@@featureAdminDatevExports-colCompleted:Completed`,
      value: (item) => this.completedAt(item) ?? '',
      priority: 1,
    },
    {
      id: 'triggeredBy',
      label: $localize`:@@featureAdminDatevExports-colTriggeredBy:Triggered by`,
      value: (item) => {
        const exportItem = this.exportItem(item);

        return exportItem ? this.triggeredByLabel(exportItem.triggeredBy) : '';
      },
      priority: 3,
    },
  ];

  readonly downloadLabel = $localize`:@@featureAdminDatevExports-downloadButtonTitle:Download export`;
  readonly selected = signal<readonly string[]>([]);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  /** Selected exports that can be downloaded (completed ones). */
  readonly selectedCompleted = computed(() => {
    const ids = new Set(this.selected());

    return this.items()
      .filter((item) => ids.has(item.id))
      .map((item) => this.exportItem(item))
      .filter((item): item is AdminDatevExportListItem => item?.status === 'completed');
  });
  readonly rowInlineActions = (item: AdminDatevExportListEntry): FpcMenuItem[] =>
    this.exportItem(item)?.status === 'completed'
      ? [{ id: 'download', label: this.downloadLabel, icon: 'download' }]
      : [];
  readonly rowMenu = (item: AdminDatevExportListEntry): FpcMenuItem[] => [
    {
      id: 'download',
      label: this.downloadLabel,
      icon: 'download',
      disabled: this.exportItem(item)?.status !== 'completed',
    },
    dbCopyIdItem(),
  ];

  triggerYear = new Date().getFullYear();
  triggerMonth = new Date().getMonth() === 0 ? 12 : new Date().getMonth();
  triggerScope: DatevExportScope = 'tenant';
  triggerViewTenantId = this.homeTenantId;

  ngOnInit(): void {
    this.capabilitiesFacade.loadCapabilities();
    this.authFacade.loadUsers();
    this.registerModalCloseWatcher();
  }

  onRowAction(item: AdminDatevExportListEntry, action: string): void {
    if (action === 'download' && this.exportItem(item)?.status === 'completed') this.downloadExport(item.id);
    else if (action === 'copy-id') fpcCopyText(item.id);
  }

  /** Bulk Download: one `GET /admin/billing/datev-exports/:id/download` per completed export, saved one by one. */
  async downloadSelected(): Promise<void> {
    const exports = this.selectedCompleted();

    if (exports.length === 0) return;

    const viewTenantId = this.scope() === 'tenant' ? (this.viewTenantId() ?? this.homeTenantId) : undefined;
    const result = await fpcRunBulk(
      exports,
      async (item) => {
        const blob = await firstValueFrom(this.billingService.downloadDatevExport(item.id, viewTenantId));

        this.saveBlob(blob, item.fileName?.trim() || `datev-export-${this.exportPrimaryTitle(item)}.zip`);
      },
      1,
    );

    this.bulkResult.set(dbBulkSummary(result, (item) => this.exportPrimaryTitle(item)));
    this.selected.set([]);
  }

  exportState(item: AdminDatevExportListEntry): FpcTableState {
    const exportItem = this.exportItem(item);

    if (!exportItem) {
      return {
        label: $localize`:@@featureAdminDatevExports-statusQueued:Queued`,
        tone: 'info',
        icon: 'hourglass-split',
      };
    }

    const icons: Record<string, string> = {
      pending: 'clock',
      running: 'arrow-repeat',
      completed: 'check-circle-fill',
      failed: 'x-circle-fill',
    };

    return {
      label: getDatevExportStatusLabel(exportItem.status),
      tone: getDatevExportStatusBadgeTone(exportItem.status),
      icon: icons[exportItem.status],
    };
  }

  completedAt(item: AdminDatevExportListEntry): string | undefined {
    return this.exportItem(item)?.completedAt ?? undefined;
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  tenantTabLabel(tenantId: string): string {
    if (tenantId === this.homeTenantId) {
      return this.homeTenantTabLabel;
    }

    if (!tenantId) {
      return tenantId;
    }

    return tenantId.charAt(0).toUpperCase() + tenantId.slice(1);
  }

  openExportModal(): void {
    this.resetTriggerForm();
    showBillingModal(this.exportModalOpen);
  }

  onScopeTabChange(tabId: string | null): void {
    if (!tabId) {
      return;
    }

    // The paging effect loads page 1 of the new scope (one request).
    if (tabId === 'unified') {
      this.viewScope.set('unified');

      return;
    }

    this.viewTenant.set(tabId);
    this.viewScope.set('tenant');
  }

  submitTriggerExport(): void {
    this.facade.triggerExport({
      year: this.triggerYear,
      month: this.triggerMonth,
      scope: this.triggerScope,
      viewTenantId: this.triggerScope === 'tenant' ? this.triggerViewTenantId : undefined,
    });
  }

  downloadExport(exportId: string): void {
    this.facade.downloadExport(
      exportId,
      this.scope() === 'tenant' ? (this.viewTenantId() ?? this.homeTenantId) : undefined,
    );
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

  exportScopeLabel(scope: AdminDatevExportListEntry['scope']): string {
    if (scope === 'tenant') {
      return this.tenantTabLabel(this.viewTenantId() ?? this.homeTenantId);
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
    return $localize`:@@featureAdminDatevExports-queuedMessage:Queued. Waiting for export to start...`;
  }

  formatDate(value?: string): string {
    if (!value) {
      return '-';
    }

    return formatBillingDateTime(value, '-');
  }

  triggeredByLabel(triggeredBy?: string): string {
    return resolveBillingAdminUserLabel(triggeredBy, this.users());
  }

  formatPeriod(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  private resetTriggerForm(): void {
    this.triggerYear = new Date().getFullYear();
    this.triggerMonth = new Date().getMonth() === 0 ? 12 : new Date().getMonth();
    this.triggerScope = this.scope();
    this.triggerViewTenantId = this.viewTenantId() ?? this.homeTenantId;
  }

  private registerModalCloseWatcher(): void {
    watchBillingMutationModalClose({
      loading$: this.triggerLoading$,
      error$: this.triggerError$,
      open: this.exportModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetTriggerForm(),
    });
  }
}
