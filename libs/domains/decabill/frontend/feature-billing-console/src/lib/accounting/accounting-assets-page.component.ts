import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AccountingFacade,
  billingPageWindow,
  BillingCapabilitiesFacade,
  type AccountingAssetScheduleRow,
  type AccountingDepreciationRunResult,
  type AccountingFixedAsset,
  type AccountingFixedAssetDetail,
  type AccountingFixedAssetInput,
  type AccountingFixedAssetMethod,
  type AccountingPage,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcKeyValueListComponent,
  FpcLaneHeaderComponent,
  FpcListToolbarComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSectionColumnComponent,
  FpcSectionRowComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcKeyValueItem,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { NgApexchartsModule } from 'ng-apexcharts';

import { formatBillingDate, formatBillingDateRange } from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { dbServerPaging } from '../shared/server-paging';

import { AccountingNavComponent } from './accounting-nav.component';
import {
  accountingMoney,
  accountingNumber,
  accountingPreviousMonth,
  accountingSeriesChart,
  accountingToday,
  accountingYearEnd,
  accountingYearStart,
  assetMethodLabel,
  assetStatusState,
  emptyAccountingResource,
} from './accounting-ui';

type AssetsTab = 'statistics' | 'list';
type AssetsListTab = 'register' | 'schedule';

interface AssetForm {
  name: string;
  acquisitionDate: string;
  acquisitionCost: number | null;
  method: AccountingFixedAssetMethod | '';
  usefulLifeMonths: number | null;
  assetAccountNumber: string;
  residualValue: number | null;
  note: string;
}

const PLAN_PREVIEW_ROWS = 60;

/** Fixed asset register, depreciation runs, disposals and the asset schedule (entity-wide: global access). */
@Component({
  selector: 'framework-accounting-assets-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    AccountingNavComponent,
    FpcAlertComponent,
    FpcBoardLaneComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueListComponent,
    FpcLaneHeaderComponent,
    FpcListToolbarComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSectionColumnComponent,
    FpcSectionRowComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './accounting-assets-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './accounting-section.scss',
})
export class AccountingAssetsPageComponent implements OnInit {
  private readonly facade = inject(AccountingFacade);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAccountingAssets-title:Fixed assets`;
  readonly filtersTitle = $localize`:@@featureAccountingAssets-filters:Filters`;
  readonly searchPlaceholder = $localize`:@@featureAccountingAssets-search:Search assets`;
  readonly createLabel = $localize`:@@featureAccountingAssets-create:Create asset`;
  readonly depreciationLabel = $localize`:@@featureAccountingAssets-depreciationRun:Depreciation run`;
  readonly chartTitle = $localize`:@@featureAccountingAssets-chartTitle:Book value, additions and depreciation by acquisition year`;

  readonly assets = toSignal(this.facade.assets$, {
    initialValue: emptyAccountingResource<AccountingPage<AccountingFixedAsset>>(),
  });
  readonly asset = toSignal(this.facade.asset$, {
    initialValue: emptyAccountingResource<AccountingFixedAssetDetail>(),
  });
  readonly schedule = toSignal(this.facade.assetSchedule$, {
    initialValue: emptyAccountingResource<AccountingAssetScheduleRow[]>(),
  });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null as string | null });

  readonly activeTab = signal<AssetsTab>('statistics');
  readonly listTab = signal<AssetsListTab>('register');
  readonly filtersOpen = signal(false);
  readonly fromDate = signal(accountingYearStart());
  readonly toDate = signal(accountingYearEnd());
  fromDraft = accountingYearStart();
  toDraft = accountingYearEnd();

  readonly scopeLabel = computed(() => formatBillingDateRange(this.fromDate(), this.toDate(), ''));
  readonly activeFilterCount = computed(() =>
    this.fromDate() !== accountingYearStart() || this.toDate() !== accountingYearEnd() ? 1 : 0,
  );

  readonly scheduleRows = computed(() => this.schedule().data ?? []);
  readonly scheduleTotals = computed(() => {
    const totals = {
      openingCost: 0,
      additions: 0,
      disposals: 0,
      closingCost: 0,
      openingDepreciation: 0,
      depreciation: 0,
      openingBookValue: 0,
      closingBookValue: 0,
    };

    for (const row of this.scheduleRows()) {
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[key] = Math.round((totals[key] + accountingNumber(row[key])) * 100) / 100;
      }
    }

    return totals;
  });
  readonly activeAssetCount = computed(
    () => (this.assets().data?.items ?? []).filter((asset) => asset.status === 'active').length,
  );
  /** Book value / additions / depreciation of the range per acquisition year. */
  readonly yearChart = computed(() => {
    const byYear = new Map<string, { bookValue: number; additions: number; depreciation: number }>();

    for (const row of this.scheduleRows()) {
      const year = row.acquisitionDate.slice(0, 4);
      const bucket = byYear.get(year) ?? { bookValue: 0, additions: 0, depreciation: 0 };

      bucket.bookValue += accountingNumber(row.closingBookValue);
      bucket.additions += accountingNumber(row.additions);
      bucket.depreciation += accountingNumber(row.depreciation);
      byYear.set(year, bucket);
    }

    const years = [...byYear.keys()].sort();

    return accountingSeriesChart(
      'bar',
      years,
      [
        {
          name: $localize`:@@featureAccountingAssets-seriesBookValue:Book value`,
          data: years.map((y) => round2(byYear.get(y)!.bookValue)),
        },
        {
          name: $localize`:@@featureAccountingAssets-seriesAdditions:Additions`,
          data: years.map((y) => round2(byYear.get(y)!.additions)),
        },
        {
          name: $localize`:@@featureAccountingAssets-seriesDepreciation:Depreciation`,
          data: years.map((y) => round2(byYear.get(y)!.depreciation)),
        },
      ],
      { money: true, colors: ['var(--bs-primary)', 'var(--bs-success)', 'var(--bs-danger)'] },
    );
  });

  readonly columns: FpcTableColumn<AccountingFixedAsset>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAccountingAssets-colStatus:Status`,
      type: 'state',
      state: (row) => assetStatusState(row.status),
    },
    {
      id: 'number',
      label: $localize`:@@featureAccountingAssets-colNumber:Number`,
      value: (row) => row.assetNumber,
      mono: true,
      required: true,
      priority: 1,
    },
    { id: 'name', label: $localize`:@@featureAccountingAssets-colName:Name`, value: (row) => row.name, priority: 1 },
    {
      id: 'acquired',
      label: $localize`:@@featureAccountingAssets-colAcquired:Acquired`,
      value: (row) => formatBillingDate(row.acquisitionDate),
      priority: 2,
    },
    {
      id: 'cost',
      label: $localize`:@@featureAccountingAssets-colCost:Cost`,
      value: (row) => accountingMoney(row.acquisitionCost),
      align: 'end',
      priority: 2,
    },
    {
      id: 'method',
      label: $localize`:@@featureAccountingAssets-colMethod:Method`,
      value: (row) => assetMethodLabel(row.method),
      priority: 3,
    },
    {
      id: 'life',
      label: $localize`:@@featureAccountingAssets-colLife:Useful life (months)`,
      value: (row) => row.usefulLifeMonths,
      align: 'end',
      priority: 3,
    },
    {
      id: 'accumulated',
      label: $localize`:@@featureAccountingAssets-colAccumulated:Accumulated depreciation`,
      value: (row) => accountingMoney(row.accumulatedDepreciation),
      align: 'end',
      priority: 3,
    },
    {
      id: 'bookValue',
      label: $localize`:@@featureAccountingAssets-colBookValue:Book value`,
      value: (row) => accountingMoney(this.bookValue(row)),
      align: 'end',
      priority: 1,
    },
    {
      id: 'through',
      label: $localize`:@@featureAccountingAssets-colThrough:Depreciated through`,
      value: (row) => row.depreciatedThrough ?? '-',
      priority: 3,
    },
  ];
  readonly rowMenu = (row: AccountingFixedAsset): FpcMenuItem[] => [
    { id: 'open', label: $localize`:@@featureAccountingAssets-open:Details`, icon: 'eye' },
    {
      id: 'dispose',
      label: $localize`:@@featureAccountingAssets-dispose:Dispose`,
      icon: 'box-arrow-right',
      disabled: row.status === 'disposed',
    },
    { id: 'bookings', label: $localize`:@@featureAccountingAssets-bookings:Bookings`, icon: 'journal-text' },
  ];

  readonly createOpen = signal(false);
  readonly depreciationOpen = signal(false);
  readonly detailOpen = signal(false);
  readonly disposeOpen = signal(false);
  readonly showFullPlan = signal(false);
  readonly depreciationResult = signal<AccountingDepreciationRunResult | null>(null);

  form: AssetForm = this.emptyForm();
  depreciationMonth = accountingPreviousMonth();
  disposeDate = accountingToday();
  disposeNote = '';
  private disposeAssetId: string | null = null;

  readonly planRows = computed(() => {
    const plan = this.asset().data?.plan ?? [];

    return this.showFullPlan() ? plan : plan.slice(0, PLAN_PREVIEW_ROWS);
  });
  readonly planTruncated = computed(() => (this.asset().data?.plan.length ?? 0) > PLAN_PREVIEW_ROWS);
  readonly detailItems = computed<FpcKeyValueItem[]>(() => {
    const asset = this.asset().data;

    if (!asset) return [];

    return [
      {
        key: 'number',
        label: $localize`:@@featureAccountingAssets-colNumber:Number`,
        value: asset.assetNumber,
        mono: true,
      },
      { key: 'name', label: $localize`:@@featureAccountingAssets-colName:Name`, value: asset.name },
      {
        key: 'status',
        label: $localize`:@@featureAccountingAssets-colStatus:Status`,
        value: assetStatusState(asset.status).label,
      },
      {
        key: 'acquired',
        label: $localize`:@@featureAccountingAssets-colAcquired:Acquired`,
        value: formatBillingDate(asset.acquisitionDate),
      },
      {
        key: 'cost',
        label: $localize`:@@featureAccountingAssets-colCost:Cost`,
        value: accountingMoney(asset.acquisitionCost),
      },
      {
        key: 'method',
        label: $localize`:@@featureAccountingAssets-colMethod:Method`,
        value: assetMethodLabel(asset.method),
      },
      {
        key: 'life',
        label: $localize`:@@featureAccountingAssets-colLife:Useful life (months)`,
        value: asset.usefulLifeMonths,
      },
      {
        key: 'account',
        label: $localize`:@@featureAccountingAssets-colAccount:Asset account`,
        value: asset.assetAccountNumber,
        mono: true,
      },
      {
        key: 'residual',
        label: $localize`:@@featureAccountingAssets-residual:Residual value`,
        value: accountingMoney(asset.residualValue),
      },
      {
        key: 'accumulated',
        label: $localize`:@@featureAccountingAssets-colAccumulated:Accumulated depreciation`,
        value: accountingMoney(asset.accumulatedDepreciation),
      },
      {
        key: 'bookValue',
        label: $localize`:@@featureAccountingAssets-colBookValue:Book value`,
        value: accountingMoney(this.bookValue(asset)),
      },
      {
        key: 'through',
        label: $localize`:@@featureAccountingAssets-colThrough:Depreciated through`,
        value: asset.depreciatedThrough ?? '-',
      },
      ...(asset.disposalDate
        ? [
            {
              key: 'disposed',
              label: $localize`:@@featureAccountingAssets-disposedOn:Disposed on`,
              value: formatBillingDate(asset.disposalDate),
            },
          ]
        : []),
      ...(asset.note
        ? [{ key: 'note', label: $localize`:@@featureAccountingAssets-note:Note`, value: asset.note }]
        : []),
    ];
  });

  ngOnInit(): void {
    this.capabilities.loadCapabilities();
    this.loadSchedule();
    this.registerModalWatchers();
  }

  loadSchedule(): void {
    this.facade.load({ key: 'assetSchedule', range: { from: this.fromDate(), to: this.toDate() } });
  }

  applyFilters(): void {
    this.fromDate.set(this.fromDraft || accountingYearStart());
    this.toDate.set(this.toDraft || accountingYearEnd());
    this.filtersOpen.set(false);
    this.loadSchedule();
  }

  resetFilters(): void {
    this.fromDraft = accountingYearStart();
    this.toDraft = accountingYearEnd();
    this.applyFilters();
  }

  onTabChange(id: string | null): void {
    if (id === 'statistics' || id === 'list') this.activeTab.set(id);
  }

  onListTabChange(id: string | null): void {
    if (id === 'register' || id === 'schedule') this.listTab.set(id);
  }

  tabLabel(tab: AssetsTab): string {
    return tab === 'statistics'
      ? $localize`:@@featureAccountingAssets-statistics:Statistics`
      : $localize`:@@featureAccountingAssets-register:Assets`;
  }

  /** Server-paged register (`GET /assets?search&limit&offset`): large registers are not truncated. */
  readonly paging = dbServerPaging(
    (query) => {
      const { limit, offset } = billingPageWindow(query.page, query.pageSize);

      this.facade.load({ key: 'assets', params: { search: query.search || undefined, limit, offset } });
    },
    { url: 'asset-' },
  );

  reload(): void {
    this.paging.reload();
  }

  money(value: number | string | null | undefined): string {
    return accountingMoney(value);
  }

  bookValue(asset: AccountingFixedAsset): number {
    return round2(accountingNumber(asset.acquisitionCost) - accountingNumber(asset.accumulatedDepreciation));
  }

  // ---- Create ----

  openCreate(): void {
    this.form = this.emptyForm();
    this.facade.clearMutation();
    showBillingModal(this.createOpen);
  }

  formValid(): boolean {
    return Boolean(this.form.name.trim() && this.form.acquisitionDate && (this.form.acquisitionCost ?? -1) >= 0);
  }

  submitCreate(): void {
    if (!this.formValid()) return;

    const dto: AccountingFixedAssetInput = {
      name: this.form.name.trim(),
      acquisitionDate: this.form.acquisitionDate,
      acquisitionCost: Number(this.form.acquisitionCost),
    };

    if (this.form.method) dto.method = this.form.method;

    if (this.form.usefulLifeMonths) dto.usefulLifeMonths = Number(this.form.usefulLifeMonths);

    if (this.form.assetAccountNumber.trim()) dto.assetAccountNumber = this.form.assetAccountNumber.trim();

    if (this.form.residualValue != null && `${this.form.residualValue}` !== '') {
      dto.residualValue = Number(this.form.residualValue);
    }

    if (this.form.note.trim()) dto.note = this.form.note.trim();

    this.facade.mutate({ kind: 'createAsset', dto });
  }

  // ---- Depreciation run ----

  openDepreciation(): void {
    this.depreciationMonth = accountingPreviousMonth();
    this.depreciationResult.set(null);
    this.facade.clearMutation();
    showBillingModal(this.depreciationOpen);
  }

  submitDepreciation(): void {
    if (!/^\d{4}-\d{2}$/.test(this.depreciationMonth)) return;

    this.facade.mutate({ kind: 'runDepreciation', through: this.depreciationMonth });
  }

  // ---- Detail / dispose ----

  onRowActivate(row: AccountingFixedAsset): void {
    this.openDetail(row.id);
  }

  onRowAction(row: AccountingFixedAsset, action: string): void {
    if (action === 'open') this.openDetail(row.id);
    else if (action === 'dispose' && row.status !== 'disposed') this.openDispose(row.id);
    else if (action === 'bookings') this.openBookings(row.id);
  }

  openDetail(id: string): void {
    this.showFullPlan.set(false);
    this.facade.load({ key: 'asset', id });
    showBillingModal(this.detailOpen);
  }

  openDispose(id: string): void {
    this.disposeAssetId = id;
    this.disposeDate = accountingToday();
    this.disposeNote = '';
    this.facade.clearMutation();
    this.detailOpen.set(false);
    showBillingModal(this.disposeOpen);
  }

  submitDispose(): void {
    if (!this.disposeAssetId || !this.disposeDate) return;

    this.facade.mutate({
      kind: 'disposeAsset',
      id: this.disposeAssetId,
      dto: { date: this.disposeDate, ...(this.disposeNote.trim() ? { note: this.disposeNote.trim() } : {}) },
    });
  }

  openBookings(id: string): void {
    void this.router.navigate(['/administration/accounting/journal'], {
      queryParams: { linkType: 'fixed_asset', targetId: id },
    });
  }

  private emptyForm(): AssetForm {
    return {
      name: '',
      acquisitionDate: accountingToday(),
      acquisitionCost: null,
      method: '',
      usefulLifeMonths: null,
      assetAccountNumber: '',
      residualValue: null,
      note: '',
    };
  }

  private registerModalWatchers(): void {
    const base = { loading$: this.facade.mutating$, error$: this.facade.mutationError$, destroyRef: this.destroyRef };

    watchBillingMutationModalClose({ ...base, open: this.createOpen });
    watchBillingMutationModalClose({ ...base, open: this.disposeOpen });
    // The depreciation dialog stays open to show the run result.
    this.facade.lastMutation$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((last) => {
      if (last?.kind === 'runDepreciation' && this.depreciationOpen()) {
        this.depreciationResult.set(last.result as AccountingDepreciationRunResult);
      }
    });
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
