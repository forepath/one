import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AccountingFacade,
  BillingCapabilitiesFacade,
  type AccountingAccount,
  type AccountingAccountImportResult,
  type AccountingAccountInput,
  type AccountingAccountType,
  type AccountingChart,
  type AccountingFiscalYear,
  type AccountingLedger,
  type AccountingTaxCode,
  type AccountingTaxCodeKind,
  type AccountingTrialBalanceRow,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
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
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { NgApexchartsModule } from 'ng-apexcharts';

import { formatBillingDate, formatBillingDateRange } from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { DB_DL_DELETE, DB_DL_EDIT } from '../shared/data-list';

import { AccountingNavComponent } from './accounting-nav.component';
import { AccountingTenantSwitchComponent } from './accounting-tenant-switch.component';
import {
  ACCOUNTING_ACCOUNT_TYPES,
  ACCOUNTING_TAX_CODE_KINDS,
  accountingMoney,
  accountingNumber,
  accountingSeriesChart,
  accountingToday,
  accountingYearStart,
  accountTypeLabel,
  emptyAccountingResource,
  entryKindLabel,
  sourceTypeLabel,
  taxCodeKindLabel,
} from './accounting-ui';

type AccountsTab = 'accounts' | 'tax-codes' | 'trial-balance';
type TrialBalanceLane = 'statistics' | 'list';

interface AccountForm {
  number: string;
  name: string;
  type: AccountingAccountType;
  role: string;
  statementPosition: string;
  defaultTaxCodeId: string;
  isAutomatic: boolean;
  isActive: boolean;
  description: string;
}

interface TaxCodeForm {
  code: string;
  name: string;
  kind: AccountingTaxCodeKind;
  rate: number | string | null;
  accountId: string;
  reverseAccountId: string;
  baseBox: string;
  taxBox: string;
  reverseTaxBox: string;
  ecSalesList: boolean;
  oss: boolean;
  datevBuKey: string;
  isActive: boolean;
}

/**
 * Charts of accounts: accounts (create / edit / deactivate / delete / import, ledger), tax codes and the trial
 * balance with statistics. Changes to accounts and tax codes are entity-wide (accounting global access).
 */
@Component({
  selector: 'framework-accounting-accounts-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcBoardLaneComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
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
    AccountingNavComponent,
    AccountingTenantSwitchComponent,
  ],
  templateUrl: './accounting-accounts-page.component.html',
  styleUrl: './accounting-section.scss',
})
export class AccountingAccountsPageComponent implements OnInit {
  private readonly facade = inject(AccountingFacade);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAccountingAccounts-title:Accounts`;
  readonly accountTypes = ACCOUNTING_ACCOUNT_TYPES;
  readonly taxCodeKinds = ACCOUNTING_TAX_CODE_KINDS;

  readonly globalAccess = toSignal(this.capabilities.accountingGlobalAccess$, { initialValue: false });
  readonly charts = toSignal(this.facade.charts$, { initialValue: emptyAccountingResource<AccountingChart[]>() });
  readonly accounts = toSignal(this.facade.accounts$, { initialValue: emptyAccountingResource<AccountingAccount[]>() });
  readonly taxCodes = toSignal(this.facade.taxCodes$, {
    initialValue: emptyAccountingResource<AccountingTaxCode[]>(),
  });
  readonly trialBalance = toSignal(this.facade.trialBalance$, {
    initialValue: emptyAccountingResource<AccountingTrialBalanceRow[]>(),
  });
  readonly ledger = toSignal(this.facade.ledger$, { initialValue: emptyAccountingResource<AccountingLedger>() });
  readonly currentFiscalYear = toSignal(this.facade.currentFiscalYear$, {
    initialValue: null as AccountingFiscalYear | null,
  });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null as string | null });
  readonly lastMutation = toSignal(this.facade.lastMutation$, {
    initialValue: null,
  });

  readonly selectedChartId = signal('');
  readonly chartFiltersOpen = signal(false);
  draftChartId = '';
  readonly selectedChartLabel = computed(() => {
    const chart = (this.charts().data ?? []).find((c) => c.id === this.selectedChartId());

    return chart ? `${chart.name} (${chart.code})` : '';
  });
  readonly activeTab = signal<AccountsTab>('accounts');

  // ---- Accounts ----

  readonly taxCodeById = computed(() => new Map((this.taxCodes().data ?? []).map((t) => [t.id, t])));
  readonly accountById = computed(() => new Map((this.accounts().data ?? []).map((a) => [a.id, a])));

  readonly accountColumns: FpcTableColumn<AccountingAccount>[] = [
    {
      id: 'number',
      label: $localize`:@@featureAccountingAccounts-colNumber:Number`,
      value: (a) => a.number,
      mono: true,
      sortable: true,
      required: true,
    },
    {
      id: 'name',
      label: $localize`:@@featureAccountingAccounts-colName:Name`,
      value: (a) => a.name,
      sortable: true,
      priority: 1,
    },
    {
      id: 'type',
      label: $localize`:@@featureAccountingAccounts-colType:Type`,
      value: (a) => accountTypeLabel(a.type),
      sortable: true,
      priority: 1,
    },
    {
      id: 'role',
      label: $localize`:@@featureAccountingAccounts-colRole:Role`,
      value: (a) => a.role ?? '',
      mono: true,
      priority: 3,
    },
    {
      id: 'position',
      label: $localize`:@@featureAccountingAccounts-colPosition:Statement position`,
      value: (a) => a.statementPosition ?? '',
      mono: true,
      priority: 3,
    },
    {
      id: 'automatic',
      label: $localize`:@@featureAccountingAccounts-colAutomatic:Automatic VAT`,
      value: (a) => (a.isAutomatic ? this.taxCodeById().get(a.defaultTaxCodeId ?? '')?.code || '✓' : ''),
      priority: 2,
    },
    {
      id: 'active',
      label: $localize`:@@featureAccountingAccounts-colActive:Status`,
      type: 'state',
      state: (a) =>
        a.isActive
          ? { label: $localize`:@@featureAccountingAccounts-active:Active`, tone: 'success' }
          : { label: $localize`:@@featureAccountingAccounts-inactive:Inactive`, tone: 'neutral' },
    },
  ];

  readonly accountMenu = (account: AccountingAccount): FpcMenuItem[] => {
    const items: FpcMenuItem[] = [
      { id: 'ledger', label: $localize`:@@featureAccountingAccounts-ledger:Ledger`, icon: 'journal-text' },
    ];

    if (this.globalAccess()) {
      items.unshift({ id: 'edit', label: DB_DL_EDIT, icon: 'pencil' });
      items.push(
        account.isActive
          ? {
              id: 'deactivate',
              label: $localize`:@@featureAccountingAccounts-deactivate:Deactivate`,
              icon: 'pause-circle',
            }
          : { id: 'activate', label: $localize`:@@featureAccountingAccounts-activate:Activate`, icon: 'play-circle' },
        { id: 'delete', label: DB_DL_DELETE, icon: 'trash', danger: true, dividerBefore: true },
      );
    }

    return items;
  };

  readonly accountModalOpen = signal(false);
  readonly editingAccount = signal<AccountingAccount | null>(null);
  accountForm: AccountForm = this.emptyAccountForm();
  readonly deleteTarget = signal<AccountingAccount | null>(null);
  readonly accountModalTitle = computed(() => {
    const account = this.editingAccount();

    return account
      ? $localize`:@@featureAccountingAccounts-editAccount:Edit account ${account.number}:number:`
      : $localize`:@@featureAccountingAccounts-createAccount:Create account`;
  });

  readonly importModalOpen = signal(false);
  readonly importFile = signal<File | null>(null);
  readonly importResult = computed<AccountingAccountImportResult | null>(() => {
    const last = this.lastMutation();

    return last?.kind === 'importAccounts' ? (last.result as AccountingAccountImportResult) : null;
  });

  // ---- Tax codes ----

  readonly taxCodeColumns: FpcTableColumn<AccountingTaxCode>[] = [
    {
      id: 'code',
      label: $localize`:@@featureAccountingAccounts-colCode:Code`,
      value: (t) => t.code,
      mono: true,
      sortable: true,
      required: true,
    },
    { id: 'name', label: $localize`:@@featureAccountingAccounts-colName:Name`, value: (t) => t.name, priority: 1 },
    {
      id: 'kind',
      label: $localize`:@@featureAccountingAccounts-colKind:Kind`,
      value: (t) => taxCodeKindLabel(t.kind),
      priority: 1,
    },
    {
      id: 'rate',
      label: $localize`:@@featureAccountingAccounts-colRate:Rate`,
      value: (t) =>
        t.rate === null || t.rate === undefined
          ? $localize`:@@featureAccountingAccounts-rateFromDocument:From document`
          : `${accountingNumber(t.rate)} %`,
      align: 'end',
      priority: 1,
    },
    {
      id: 'account',
      label: $localize`:@@featureAccountingAccounts-colTaxAccount:VAT account`,
      value: (t) => this.accountLabel(t.accountId),
      priority: 2,
    },
    {
      id: 'boxes',
      label: $localize`:@@featureAccountingAccounts-colBoxes:Boxes (base / tax / reverse)`,
      value: (t) => [t.baseBox, t.taxBox, t.reverseTaxBox].map((b) => b || '–').join(' / '),
      mono: true,
      priority: 3,
    },
    {
      id: 'reporting',
      label: $localize`:@@featureAccountingAccounts-colReporting:Reporting`,
      value: (t) =>
        [t.ecSalesList ? $localize`:@@featureAccountingAccounts-ecSalesList:EC sales list` : '', t.oss ? 'OSS' : '']
          .filter(Boolean)
          .join(', '),
      priority: 3,
    },
    {
      id: 'active',
      label: $localize`:@@featureAccountingAccounts-colActive:Status`,
      type: 'state',
      state: (t) =>
        t.isActive
          ? { label: $localize`:@@featureAccountingAccounts-active:Active`, tone: 'success' }
          : { label: $localize`:@@featureAccountingAccounts-inactive:Inactive`, tone: 'neutral' },
    },
  ];

  readonly taxCodeMenu = (): FpcMenuItem[] =>
    this.globalAccess() ? [{ id: 'edit', label: DB_DL_EDIT, icon: 'pencil' }] : [];

  readonly taxCodeModalOpen = signal(false);
  readonly editingTaxCode = signal<AccountingTaxCode | null>(null);
  taxCodeForm: TaxCodeForm = this.emptyTaxCodeForm();
  readonly taxCodeModalTitle = computed(() => {
    const taxCode = this.editingTaxCode();

    return taxCode
      ? $localize`:@@featureAccountingAccounts-editTaxCode:Edit tax code ${taxCode.code}:code:`
      : $localize`:@@featureAccountingAccounts-createTaxCode:Create tax code`;
  });

  // ---- Ledger ----

  readonly ledgerModalOpen = signal(false);
  readonly ledgerAccount = signal<AccountingAccount | null>(null);
  readonly ledgerTitle = computed(() => {
    const account = this.ledgerAccount();

    return account
      ? $localize`:@@featureAccountingAccounts-ledgerTitle:Ledger ${account.number}:number: ${account.name}:name:`
      : '';
  });
  ledgerFrom = accountingYearStart();
  ledgerTo = accountingToday();

  // ---- Trial balance ----

  readonly laneTab = signal<TrialBalanceLane>('statistics');
  readonly filtersOpen = signal(false);
  readonly rangeFrom = signal(accountingYearStart());
  readonly rangeTo = signal(accountingToday());
  draftFrom = accountingYearStart();
  draftTo = accountingToday();
  readonly rangeLabel = computed(() => formatBillingDateRange(this.rangeFrom(), this.rangeTo(), ''));
  readonly filtersTitle = $localize`:@@featureAccountingAccounts-filters:Filters`;
  readonly chartTitle = $localize`:@@featureAccountingAccounts-balanceByType:Closing balance by account type`;

  readonly trialRows = computed(() => this.trialBalance().data ?? []);
  readonly trialTotals = computed(() => {
    const rows = this.trialRows();
    const sum = (pick: (r: AccountingTrialBalanceRow) => number) =>
      Math.round(rows.reduce((s, r) => s + pick(r), 0) * 100) / 100;

    return {
      opening: sum((r) => r.opening),
      debit: sum((r) => r.debit),
      credit: sum((r) => r.credit),
      closing: sum((r) => r.closing),
      withBalance: rows.filter((r) => Math.abs(r.closing) >= 0.005).length,
    };
  });
  readonly balanceChart = computed(() => {
    const byType = new Map<string, number>();

    for (const row of this.trialRows()) {
      byType.set(row.type, (byType.get(row.type) ?? 0) + row.closing);
    }

    const types = ACCOUNTING_ACCOUNT_TYPES.filter((t) => byType.has(t));

    return accountingSeriesChart(
      'bar',
      types.map((t) => accountTypeLabel(t)),
      [
        {
          name: $localize`:@@featureAccountingAccounts-closing:Closing balance`,
          data: types.map((t) => Math.round((byType.get(t) ?? 0) * 100) / 100),
        },
      ],
      { money: true },
    );
  });

  constructor() {
    // Default chart: the chart of the current fiscal year, else the first one.
    effect(() => {
      const charts = this.charts().data ?? [];
      const year = this.currentFiscalYear();

      if (untracked(this.selectedChartId) || charts.length === 0) return;

      const chartId = charts.some((c) => c.id === year?.chartId) ? (year?.chartId as string) : charts[0].id;

      untracked(() => this.selectChart(chartId));
    });
  }

  ngOnInit(): void {
    this.capabilities.loadCapabilities();
    this.facade.clearMutation();
    this.facade.load({ key: 'overview' });
    this.facade.load({ key: 'charts' });
    this.loadTrialBalance();

    for (const open of [this.accountModalOpen, this.taxCodeModalOpen, this.importModalOpen]) {
      watchBillingMutationModalClose({
        loading$: this.facade.mutating$,
        error$: this.facade.mutationError$,
        open,
        destroyRef: this.destroyRef,
      });
    }
  }

  onChartFiltersOpenChange(open: boolean): void {
    this.chartFiltersOpen.set(open);

    if (open) {
      this.draftChartId = this.selectedChartId();
    }
  }

  applyChartFilter(): void {
    this.chartFiltersOpen.set(false);

    if (this.draftChartId && this.draftChartId !== this.selectedChartId()) {
      this.selectChart(this.draftChartId);
    }
  }

  selectChart(chartId: string): void {
    if (!chartId) return;

    this.selectedChartId.set(chartId);
    this.facade.load({ key: 'accounts', chartId });
    this.facade.load({ key: 'taxCodes', chartId });
  }

  onTabChange(id: string | null): void {
    if (id === 'accounts' || id === 'tax-codes' || id === 'trial-balance') this.activeTab.set(id);
  }

  onLaneChange(id: string | null): void {
    if (id === 'statistics' || id === 'list') this.laneTab.set(id);
  }

  laneLabel(lane: TrialBalanceLane): string {
    return lane === 'statistics'
      ? $localize`:@@featureAccountingAccounts-statistics:Statistics`
      : $localize`:@@featureAccountingAccounts-trialBalance:Trial balance`;
  }

  money(value: number | string | null | undefined): string {
    return accountingMoney(value);
  }

  date(value: string | null | undefined): string {
    return formatBillingDate(value ?? null);
  }

  accountLabel(accountId: string | null | undefined): string {
    if (!accountId) return '';

    const account = this.accountById().get(accountId);

    return account ? `${account.number} ${account.name}` : accountId;
  }

  kindLabel(kind: string): string {
    return entryKindLabel(kind);
  }

  sourceLabel(source: string): string {
    return sourceTypeLabel(source);
  }

  typeLabel(type: string): string {
    return accountTypeLabel(type);
  }

  taxKindLabel(kind: string): string {
    return taxCodeKindLabel(kind);
  }

  // ---- Account actions ----

  onAccountAction(account: AccountingAccount, action: string): void {
    if (action === 'edit') this.openAccountModal(account);
    else if (action === 'ledger') this.openLedger(account);
    else if (action === 'deactivate' || action === 'activate') {
      this.facade.mutate({
        kind: 'updateAccount',
        accountId: account.id,
        dto: { isActive: action === 'activate' },
      });
    } else if (action === 'delete') {
      this.facade.clearMutation();
      this.deleteTarget.set(account);
    }
  }

  openAccountModal(account: AccountingAccount | null = null): void {
    this.facade.clearMutation();
    this.editingAccount.set(account);
    this.accountForm = account
      ? {
          number: account.number,
          name: account.name,
          type: account.type,
          role: account.role ?? '',
          statementPosition: account.statementPosition ?? '',
          defaultTaxCodeId: account.defaultTaxCodeId ?? '',
          isAutomatic: account.isAutomatic,
          isActive: account.isActive,
          description: account.description ?? '',
        }
      : this.emptyAccountForm();
    showBillingModal(this.accountModalOpen);
  }

  accountFormValid(): boolean {
    return /^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/.test(this.accountForm.number.trim()) && !!this.accountForm.name.trim();
  }

  submitAccount(): void {
    const chartId = this.selectedChartId();

    if (!this.accountFormValid() || !chartId) return;

    const f = this.accountForm;
    const dto: AccountingAccountInput = {
      number: f.number.trim(),
      name: f.name.trim(),
      type: f.type,
      role: f.role.trim() || null,
      statementPosition: f.statementPosition.trim() || null,
      defaultTaxCodeId: f.defaultTaxCodeId || null,
      isAutomatic: f.isAutomatic,
      isActive: f.isActive,
      description: f.description.trim() || null,
    };
    const editing = this.editingAccount();

    if (editing) {
      this.facade.mutate({ kind: 'updateAccount', accountId: editing.id, dto });

      return;
    }

    this.facade.mutate({ kind: 'createAccount', chartId, dto });
  }

  confirmDelete(): void {
    const account = this.deleteTarget();

    if (!account) return;

    this.facade.mutate({ kind: 'deleteAccount', accountId: account.id });
    this.deleteTarget.set(null);
  }

  openImport(): void {
    this.facade.clearMutation();
    this.importFile.set(null);
    showBillingModal(this.importModalOpen);
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement | null;

    this.importFile.set(input?.files?.[0] ?? null);
  }

  submitImport(): void {
    const file = this.importFile();
    const chartId = this.selectedChartId();

    if (!file || !chartId) return;

    this.facade.mutate({ kind: 'importAccounts', chartId, file });
  }

  private emptyAccountForm(): AccountForm {
    return {
      number: '',
      name: '',
      type: 'expense',
      role: '',
      statementPosition: '',
      defaultTaxCodeId: '',
      isAutomatic: false,
      isActive: true,
      description: '',
    };
  }

  // ---- Tax code actions ----

  onTaxCodeAction(taxCode: AccountingTaxCode, action: string): void {
    if (action === 'edit') this.openTaxCodeModal(taxCode);
  }

  openTaxCodeModal(taxCode: AccountingTaxCode | null = null): void {
    this.facade.clearMutation();
    this.editingTaxCode.set(taxCode);
    this.taxCodeForm = taxCode
      ? {
          code: taxCode.code,
          name: taxCode.name,
          kind: taxCode.kind,
          rate: taxCode.rate === null || taxCode.rate === undefined ? null : accountingNumber(taxCode.rate),
          accountId: taxCode.accountId ?? '',
          reverseAccountId: taxCode.reverseAccountId ?? '',
          baseBox: taxCode.baseBox ?? '',
          taxBox: taxCode.taxBox ?? '',
          reverseTaxBox: taxCode.reverseTaxBox ?? '',
          ecSalesList: taxCode.ecSalesList,
          oss: taxCode.oss,
          datevBuKey: taxCode.datevBuKey ?? '',
          isActive: taxCode.isActive,
        }
      : this.emptyTaxCodeForm();
    showBillingModal(this.taxCodeModalOpen);
  }

  taxCodeFormValid(): boolean {
    const f = this.taxCodeForm;

    return (this.editingTaxCode() !== null || /^[A-Z0-9_]{2,32}$/.test(f.code.trim())) && !!f.name.trim();
  }

  submitTaxCode(): void {
    const chartId = this.selectedChartId();

    if (!this.taxCodeFormValid() || !chartId) return;

    const f = this.taxCodeForm;
    const rate = f.rate === null || f.rate === '' ? null : Number(f.rate);
    const common = {
      name: f.name.trim(),
      rate: Number.isFinite(rate) ? rate : null,
      accountId: f.accountId || null,
      reverseAccountId: f.reverseAccountId || null,
      baseBox: f.baseBox.trim() || null,
      taxBox: f.taxBox.trim() || null,
      reverseTaxBox: f.reverseTaxBox.trim() || null,
      ecSalesList: f.ecSalesList,
      oss: f.oss,
      datevBuKey: f.datevBuKey.trim() || null,
      isActive: f.isActive,
    };
    const editing = this.editingTaxCode();

    if (editing) {
      this.facade.mutate({ kind: 'updateTaxCode', taxCodeId: editing.id, dto: common });

      return;
    }

    this.facade.mutate({
      kind: 'createTaxCode',
      chartId,
      dto: { ...common, code: f.code.trim(), kind: f.kind },
    });
  }

  private emptyTaxCodeForm(): TaxCodeForm {
    return {
      code: '',
      name: '',
      kind: 'output',
      rate: null,
      accountId: '',
      reverseAccountId: '',
      baseBox: '',
      taxBox: '',
      reverseTaxBox: '',
      ecSalesList: false,
      oss: false,
      datevBuKey: '',
      isActive: true,
    };
  }

  // ---- Ledger ----

  openLedger(account: AccountingAccount): void {
    this.ledgerAccount.set(account);
    this.ledgerFrom = this.rangeFrom();
    this.ledgerTo = this.rangeTo();
    this.loadLedger();
    showBillingModal(this.ledgerModalOpen);
  }

  openLedgerById(accountId: string): void {
    const account = this.accountById().get(accountId);

    if (account) this.openLedger(account);
  }

  loadLedger(): void {
    const account = this.ledgerAccount();

    if (!account || !this.ledgerFrom || !this.ledgerTo) return;

    this.facade.load({
      key: 'ledger',
      params: { accountId: account.id, from: this.ledgerFrom, to: this.ledgerTo, limit: 100, offset: 0 },
    });
  }

  // ---- Trial balance ----

  onFiltersOpenChange(open: boolean): void {
    this.filtersOpen.set(open);

    if (open) {
      this.draftFrom = this.rangeFrom();
      this.draftTo = this.rangeTo();
    }
  }

  applyRange(): void {
    if (!this.draftFrom || !this.draftTo || this.draftFrom > this.draftTo) return;

    this.rangeFrom.set(this.draftFrom);
    this.rangeTo.set(this.draftTo);
    this.filtersOpen.set(false);
    this.loadTrialBalance();
  }

  resetRange(): void {
    this.draftFrom = accountingYearStart();
    this.draftTo = accountingToday();
    this.applyRange();
  }

  loadTrialBalance(): void {
    this.facade.load({ key: 'trialBalance', range: { from: this.rangeFrom(), to: this.rangeTo() } });
  }
}
