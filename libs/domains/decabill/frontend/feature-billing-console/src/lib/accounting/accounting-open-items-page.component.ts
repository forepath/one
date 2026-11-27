import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  type AccountingCounterpartyType,
  AccountingFacade,
  type AccountingOpenItemRow,
  type AccountingOpenItems,
  BillingCapabilitiesFacade,
  billingTenantDisplayName,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBoardLaneComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLaneHeaderComponent,
  FpcListToolbarComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';
import { NgApexchartsModule } from 'ng-apexcharts';

import { formatBillingDate } from '../billing-format';

import { AccountingNavComponent } from './accounting-nav.component';
import { AccountingTenantSwitchComponent } from './accounting-tenant-switch.component';
import {
  ACCOUNTING_AGING_BUCKETS,
  accountingMoney,
  accountingNumber,
  accountingSeriesChart,
  accountingToday,
  agingBucketLabel,
  emptyAccountingResource,
} from './accounting-ui';

type OpenItemsTab = 'statistics' | 'items';

/** Days-overdue badge: due soon / not due neutral, overdue warning, more than 90 days danger. */
export function openItemState(row: Pick<AccountingOpenItemRow, 'daysOverdue'>): FpcTableState {
  if (row.daysOverdue > 90) {
    return {
      label: $localize`:@@featureAccountingOpenItems-overdue90:${row.daysOverdue}:days: days overdue`,
      tone: 'danger',
    };
  }

  if (row.daysOverdue > 0) {
    return {
      label: $localize`:@@featureAccountingOpenItems-overdue:${row.daysOverdue}:days: days overdue`,
      tone: 'warning',
    };
  }

  return { label: $localize`:@@featureAccountingOpenItems-notDue:Not due`, tone: 'success' };
}

/**
 * Open items (OP-Liste) of customers or suppliers as of a date: KPIs and the aging buckets next to the item list;
 * each item links to the bookings of its document.
 */
@Component({
  selector: 'framework-accounting-open-items-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    AccountingNavComponent,
    AccountingTenantSwitchComponent,
    FpcAlertComponent,
    FpcBoardLaneComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcLaneHeaderComponent,
    FpcListToolbarComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSectionColumnComponent,
    FpcSectionRowComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './accounting-open-items-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './accounting-section.scss',
})
export class AccountingOpenItemsPageComponent implements OnInit {
  private readonly facade = inject(AccountingFacade);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly router = inject(Router);

  readonly pageTitle = $localize`:@@featureAccountingOpenItems-title:Open items`;
  readonly statisticsTitle = $localize`:@@featureAccountingOpenItems-statistics:Statistics`;
  readonly itemsTitle = $localize`:@@featureAccountingOpenItems-items:Items`;
  readonly customersLabel = $localize`:@@featureAccountingOpenItems-customers:Customers`;
  readonly suppliersLabel = $localize`:@@featureAccountingOpenItems-suppliers:Suppliers`;
  readonly totalOpenLabel = $localize`:@@featureAccountingOpenItems-kpiTotal:Total open`;
  readonly countLabel = $localize`:@@featureAccountingOpenItems-kpiCount:Items`;
  readonly overdueLabel = $localize`:@@featureAccountingOpenItems-kpiOverdue:Overdue`;
  readonly overdue90Label = $localize`:@@featureAccountingOpenItems-kpiOverdue90:More than 90 days`;
  readonly agingChartTitle = $localize`:@@featureAccountingOpenItems-agingChart:Aging`;
  readonly bookingsLabel = $localize`:@@featureAccountingOpenItems-bookings:Bookings`;
  readonly money = accountingMoney;

  readonly type = signal<AccountingCounterpartyType>('customer');
  readonly activeTab = signal<OpenItemsTab>('statistics');
  readonly today = accountingToday();
  readonly filtersTitle = $localize`:@@featureAccountingBanking-filters:Filters`;
  readonly asOfLabel = $localize`:@@featureAccountingOpenItems-asOf:As of`;
  readonly filtersOpen = signal(false);
  readonly formatDate = formatBillingDate;
  asOf = this.today;
  draftAsOf = this.today;

  readonly openItems = toSignal(this.facade.openItems$, {
    initialValue: emptyAccountingResource<AccountingOpenItems>(),
  });
  readonly rows = computed(() => this.openItems().data?.items ?? []);
  readonly kpis = computed(() => {
    const data = this.openItems().data;

    if (!data) return null;

    const sum = (items: AccountingOpenItemRow[]) =>
      Math.round(items.reduce((s, i) => s + accountingNumber(i.open), 0) * 100) / 100;

    return {
      total: accountingNumber(data.total),
      count: data.items.length,
      overdue: sum(data.items.filter((i) => i.daysOverdue > 0)),
      overdue90: accountingNumber(data.aging['90+']),
    };
  });
  readonly agingChart = computed(() => {
    const aging = this.openItems().data?.aging;

    if (!aging) return null;

    return accountingSeriesChart(
      'bar',
      ACCOUNTING_AGING_BUCKETS.map((bucket) => agingBucketLabel(bucket)),
      [{ name: this.totalOpenLabel, data: ACCOUNTING_AGING_BUCKETS.map((bucket) => accountingNumber(aging[bucket])) }],
      {
        money: true,
        colors: ['var(--bs-warning)'],
      },
    );
  });

  readonly columns: FpcTableColumn<AccountingOpenItemRow>[] = [
    {
      id: 'state',
      label: $localize`:@@featureAccountingOpenItems-colState:State`,
      type: 'state',
      state: (row) => openItemState(row),
    },
    {
      id: 'documentNumber',
      label: $localize`:@@featureAccountingOpenItems-colDocument:Document`,
      value: (row) => row.documentNumber ?? '-',
      required: true,
      priority: 1,
    },
    {
      id: 'documentDate',
      label: $localize`:@@featureAccountingOpenItems-colDocumentDate:Document date`,
      value: (row) => formatBillingDate(row.documentDate),
      priority: 2,
    },
    {
      id: 'dueDate',
      label: $localize`:@@featureAccountingOpenItems-colDueDate:Due date`,
      value: (row) => formatBillingDate(row.dueDate),
      priority: 1,
    },
    {
      id: 'amount',
      label: $localize`:@@featureAccountingOpenItems-colAmount:Amount`,
      value: (row) => accountingMoney(row.amount),
      align: 'end',
      priority: 2,
    },
    {
      id: 'open',
      label: $localize`:@@featureAccountingOpenItems-colOpen:Open`,
      value: (row) => accountingMoney(row.open),
      align: 'end',
      required: true,
      priority: 1,
    },
    {
      id: 'daysOverdue',
      label: $localize`:@@featureAccountingOpenItems-colDaysOverdue:Days overdue`,
      value: (row) => Math.max(0, row.daysOverdue),
      align: 'end',
      priority: 2,
    },
    {
      id: 'counterparty',
      label: $localize`:@@featureAccountingOpenItems-colCounterparty:Counterparty`,
      value: (row) => row.counterpartyLabel ?? '-',
      priority: 3,
    },
    {
      id: 'tenant',
      label: $localize`:@@featureAccountingOpenItems-colTenant:Tenant`,
      value: (row) => (row.tenantId ? billingTenantDisplayName(row.tenantId) : '-'),
      priority: 3,
    },
  ];
  readonly openItemRowId = (row: AccountingOpenItemRow): string => row.openItemId;
  readonly rowMenu = (): FpcMenuItem[] => [{ id: 'bookings', label: this.bookingsLabel, icon: 'journal-text' }];

  ngOnInit(): void {
    this.capabilities.loadCapabilities();
    this.load();
  }

  load(): void {
    this.facade.load({ key: 'openItems', type: this.type(), asOf: this.asOf || undefined });
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersOpen.set(open);

    if (open) {
      this.draftAsOf = this.asOf;
    }
  }

  applyFilters(): void {
    this.asOf = this.draftAsOf || this.today;
    this.filtersOpen.set(false);
    this.load();
  }

  resetFilters(): void {
    this.asOf = this.today;
    this.draftAsOf = this.today;
    this.filtersOpen.set(false);
    this.load();
  }

  onTypeChange(id: string | null): void {
    if ((id === 'customer' || id === 'supplier') && id !== this.type()) {
      this.type.set(id);
      this.load();
    }
  }

  onTabChange(tabId: string | null): void {
    if (tabId === 'statistics' || tabId === 'items') this.activeTab.set(tabId);
  }

  tabLabel(tab: OpenItemsTab): string {
    return tab === 'statistics' ? this.statisticsTitle : this.itemsTitle;
  }

  onRowAction(row: AccountingOpenItemRow, action: string): void {
    if (action === 'bookings') this.showBookings(row);
  }

  /** Journal filtered to the bookings of the item's document (the open item id is the document id). */
  showBookings(row: AccountingOpenItemRow): void {
    void this.router.navigate(['/administration/accounting/journal'], {
      queryParams: {
        linkType: this.type() === 'customer' ? 'invoice' : 'supplier_invoice',
        targetId: row.openItemId,
      },
    });
  }
}
