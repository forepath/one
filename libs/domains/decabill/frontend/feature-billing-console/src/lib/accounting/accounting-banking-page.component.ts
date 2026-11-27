import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  type AccountingBankImport,
  type AccountingBankImportFormat,
  type AccountingBankImportUpload,
  type AccountingBankMatchStatus,
  type AccountingBankStatistics,
  type AccountingBankTransaction,
  type AccountingCsvMapping,
  type AccountingCsvPreset,
  AccountingFacade,
  type AccountingFinancialAccount,
  type AccountingFinancialAccountInput,
  type AccountingFinancialAccountKind,
  type AccountingImportEncoding,
  type AccountingMatchInput,
  type AccountingMatchRule,
  type AccountingMatchRuleInput,
  type AccountingMatchSuggestion,
  type AccountingPage,
  type AccountingProcessorSyncResult,
  type AccountingQifDateFormat,
  type AccountingTaxCode,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  billingPageWindow,
  billingTenantDisplayName,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
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
import { firstValueFrom } from 'rxjs';

import { formatBillingDate, formatBillingDateRange, formatBillingDateTime } from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { dbCopyIdItem } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { ThemeService } from '../theme.service';

import { AccountingNavComponent } from './accounting-nav.component';
import { AccountingTenantSwitchComponent } from './accounting-tenant-switch.component';
import {
  ACCOUNTING_MATCH_STATUSES,
  accountingDonutChart,
  accountingMoney,
  accountingMonthLabel,
  accountingNumber,
  accountingPercent,
  accountingSeriesChart,
  accountingYearEnd,
  accountingYearStart,
  emptyAccountingResource,
  importStatusState,
  matchStatusLabel,
  sourceTypeLabel,
  matchStatusState,
  saveAccountingBlob,
} from './accounting-ui';

type BankingTab = 'statistics' | 'list';
type BankingListTab = 'transactions' | 'imports' | 'accounts' | 'mappings' | 'rules';
type MatchTargetType = 'invoice' | 'supplier_invoice' | 'account';

export interface BankingMatchTargetForm {
  type: MatchTargetType;
  /** Set by a suggestion; typing a number clears it. */
  id: string;
  /** Invoice / supplier invoice number as shown and typed. */
  number: string;
  accountNumber: string;
  taxCode: string;
  description: string;
  amount: number | null;
}

interface FinancialAccountForm {
  name: string;
  kind: AccountingFinancialAccountKind;
  iban: string;
  accountNumber: string;
  bic: string;
  currency: string;
  ledgerAccountNumber: string;
  processor: '' | 'stripe' | 'paypal' | 'mollie' | 'adyen';
  shared: boolean;
  isActive: boolean;
}

export const BANK_IMPORT_FORMATS: readonly AccountingBankImportFormat[] = [
  'camt.052',
  'camt.053',
  'camt.054',
  'mt940',
  'mt942',
  'coda',
  'norma43',
  'cfonb120',
  'cbi-rh',
  'bai2',
  'ofx',
  'qif',
  'csv',
];
export const BANK_IMPORT_ENCODINGS: readonly AccountingImportEncoding[] = [
  'auto',
  'utf-8',
  'windows-1252',
  'iso-8859-1',
  'cp850',
];

/** Builds the multipart upload: `auto` format / encoding / QIF date format and empty selections are omitted. */
export function buildBankImportUpload(options: {
  file: File;
  format: AccountingBankImportFormat | 'auto';
  csvSource: string;
  encoding: AccountingImportEncoding;
  qifDateFormat: AccountingQifDateFormat;
  financialAccountId: string;
}): AccountingBankImportUpload {
  const upload: AccountingBankImportUpload = { file: options.file };

  if (options.format !== 'auto') upload.format = options.format;

  if (options.encoding !== 'auto') upload.encoding = options.encoding;

  const csv = options.format === 'csv' || options.format === 'auto';

  if (csv && options.csvSource.startsWith('preset:')) upload.csvPreset = options.csvSource.slice(7);

  if (csv && options.csvSource.startsWith('mapping:')) upload.csvMappingId = options.csvSource.slice(8);

  if ((options.format === 'qif' || options.format === 'auto') && options.qifDateFormat !== 'auto') {
    upload.qifDateFormat = options.qifDateFormat;
  }

  if (options.financialAccountId) upload.financialAccountId = options.financialAccountId;

  return upload;
}

/**
 * Match targets of the dialog → API payload (absolute amounts; documents by id when picked from a suggestion, else by
 * the typed document number; accounts by number).
 */
export function buildMatchInput(targets: readonly BankingMatchTargetForm[], learn: boolean): AccountingMatchInput {
  return {
    targets: targets.map((t) =>
      t.type === 'account'
        ? {
            type: 'account' as const,
            accountNumber: t.accountNumber.trim(),
            amount: Math.abs(Number(t.amount ?? 0)),
            ...(t.taxCode ? { taxCode: t.taxCode } : {}),
            ...(t.description.trim() ? { description: t.description.trim() } : {}),
          }
        : {
            type: t.type,
            ...(t.id.trim() ? { id: t.id.trim() } : { number: t.number.trim() }),
            amount: Math.abs(Number(t.amount ?? 0)),
          },
    ),
    learn,
  };
}

/** Banking: financial accounts, statement imports, transactions with reconciliation, CSV mappings and match rules. */
@Component({
  selector: 'framework-accounting-banking-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    AccountingNavComponent,
    AccountingTenantSwitchComponent,
    FpcAlertComponent,
    FpcBoardLaneComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
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
  templateUrl: './accounting-banking-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './accounting-section.scss',
})
export class AccountingBankingPageComponent implements OnInit {
  private readonly facade = inject(AccountingFacade);
  private readonly service = inject(AdminAccountingService);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAccountingBanking-title:Banking`;
  readonly filtersTitle = $localize`:@@featureAccountingBanking-filters:Filters`;
  readonly supplierInvoiceLabel = sourceTypeLabel('supplier_invoice');
  readonly mappingHint = $localize`:@@featureAccountingBanking-mappingHint:delimiter, decimalSeparator, dateFormat (e.g. DD.MM.YYYY), encoding, hasHeader and columns (bookingDate, amount or debit/credit, counterpartyName, remittance …).`;
  readonly flowsTitle = $localize`:@@featureAccountingBanking-flowsTitle:Inflow vs outflow`;
  readonly statusTitle = $localize`:@@featureAccountingBanking-statusTitle:Reconciliation status`;
  readonly transactionsLabel = $localize`:@@featureAccountingBanking-transactions:Transactions`;
  readonly importsLabel = $localize`:@@featureAccountingBanking-imports:Imports`;
  readonly uploadLabel = $localize`:@@featureAccountingBanking-upload:Upload statement`;
  readonly createAccountLabel = $localize`:@@featureAccountingBanking-createAccount:Add account`;
  readonly createMappingLabel = $localize`:@@featureAccountingBanking-createMapping:Add CSV mapping`;
  readonly createRuleLabel = $localize`:@@featureAccountingBanking-createRule:Add rule`;
  readonly syncLabel = $localize`:@@featureAccountingBanking-processorSync:Processor sync`;
  readonly searchPlaceholder = $localize`:@@featureAccountingBanking-search:Search counterparty, reference, IBAN`;
  readonly statuses = ACCOUNTING_MATCH_STATUSES;
  readonly formats = BANK_IMPORT_FORMATS;
  readonly encodings = BANK_IMPORT_ENCODINGS;

  readonly globalAccess = toSignal(this.capabilities.accountingGlobalAccess$, { initialValue: false });
  readonly statistics = toSignal(this.facade.bankStatistics$, {
    initialValue: emptyAccountingResource<AccountingBankStatistics>(),
  });
  readonly transactions = toSignal(this.facade.transactions$, {
    initialValue: emptyAccountingResource<AccountingPage<AccountingBankTransaction>>(),
  });
  readonly imports = toSignal(this.facade.imports$, {
    initialValue: emptyAccountingResource<AccountingPage<AccountingBankImport>>(),
  });
  readonly importDetail = toSignal(this.facade.importDetail$, {
    initialValue: emptyAccountingResource<AccountingBankImport>(),
  });
  readonly accounts = toSignal(this.facade.financialAccounts$, {
    initialValue: emptyAccountingResource<AccountingFinancialAccount[]>(),
  });
  readonly presets = toSignal(this.facade.csvPresets$, {
    initialValue: emptyAccountingResource<AccountingCsvPreset[]>(),
  });
  readonly mappings = toSignal(this.facade.csvMappings$, {
    initialValue: emptyAccountingResource<AccountingCsvMapping[]>(),
  });
  readonly rules = toSignal(this.facade.matchRules$, {
    initialValue: emptyAccountingResource<AccountingMatchRule[]>(),
  });
  readonly suggestions = toSignal(this.facade.suggestions$, {
    initialValue: emptyAccountingResource<AccountingMatchSuggestion[]>(),
  });
  readonly taxCodes = toSignal(this.facade.taxCodes$, { initialValue: emptyAccountingResource<AccountingTaxCode[]>() });
  readonly currentFiscalYear = toSignal(this.facade.currentFiscalYear$, { initialValue: null });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null as string | null });

  readonly activeTab = signal<BankingTab>('statistics');
  readonly listTab = signal<BankingListTab>('transactions');

  // ---- Statistics ----

  readonly statsOpen = signal(false);
  readonly fromDate = signal(accountingYearStart());
  readonly toDate = signal(accountingYearEnd());
  fromDraft = accountingYearStart();
  toDraft = accountingYearEnd();
  readonly scopeLabel = computed(() => formatBillingDateRange(this.fromDate(), this.toDate(), ''));
  readonly statsFilterCount = computed(() =>
    this.fromDate() !== accountingYearStart() || this.toDate() !== accountingYearEnd() ? 1 : 0,
  );
  readonly flowsChart = computed(() => {
    const flows = this.statistics().data?.flows ?? [];

    return accountingSeriesChart(
      'bar',
      flows.map((f) => accountingMonthLabel(f.month)),
      [
        { name: $localize`:@@featureAccountingBanking-inflow:Inflow`, data: flows.map((f) => f.inflow) },
        { name: $localize`:@@featureAccountingBanking-outflow:Outflow`, data: flows.map((f) => f.outflow) },
      ],
      { money: true, colors: ['var(--bs-success)', 'var(--bs-danger)'] },
    );
  });
  readonly statusChart = computed(() => {
    const statuses = this.statistics().data?.statuses ?? [];

    return accountingDonutChart(
      statuses.map((s) => matchStatusLabel(s.status)),
      statuses.map((s) => s.count),
      { dark: this.theme.isDarkMode() },
    );
  });

  // ---- Transactions ----

  readonly matchStatus = signal<AccountingBankMatchStatus | ''>('');
  readonly financialAccountId = signal('');
  readonly importId = signal('');
  readonly txFiltersOpen = signal(false);
  matchStatusDraft: AccountingBankMatchStatus | '' = '';
  financialAccountDraft = '';
  readonly txFilterCount = computed(
    () => [this.matchStatus(), this.financialAccountId(), this.importId()].filter(Boolean).length,
  );
  /** `GET /banking/transactions?matchStatus&financialAccountId&importId&search&limit&offset` (replace-page). */
  readonly paging = dbServerPaging(
    (query) => {
      const { limit, offset } = billingPageWindow(query.page, query.pageSize);

      this.facade.load({
        key: 'transactions',
        params: {
          matchStatus: untracked(this.matchStatus) || undefined,
          financialAccountId: untracked(this.financialAccountId) || undefined,
          importId: untracked(this.importId) || undefined,
          search: query.search,
          limit,
          offset,
        },
      });
    },
    { url: 'tx-', filters: () => [this.matchStatus(), this.financialAccountId(), this.importId()] },
  );
  readonly accountNames = computed(() => new Map((this.accounts().data ?? []).map((a) => [a.id, a.name])));

  readonly txColumns: FpcTableColumn<AccountingBankTransaction>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAccountingBanking-colStatus:Status`,
      type: 'state',
      state: (row) => matchStatusState(row.matchStatus),
    },
    {
      id: 'date',
      label: $localize`:@@featureAccountingBanking-colDate:Booking date`,
      value: (row) => formatBillingDate(row.bookingDate),
      required: true,
      priority: 1,
    },
    {
      id: 'counterparty',
      label: $localize`:@@featureAccountingBanking-colCounterparty:Counterparty`,
      value: (row) => row.counterpartyName ?? row.counterpartyIban ?? '',
      priority: 1,
    },
    {
      id: 'remittance',
      label: $localize`:@@featureAccountingBanking-colRemittance:Reference`,
      value: (row) => row.remittance ?? row.bookingText ?? '',
      priority: 2,
    },
    {
      id: 'amount',
      label: $localize`:@@featureAccountingBanking-colAmount:Amount`,
      value: (row) => accountingMoney(row.amount, row.currency),
      align: 'end',
      required: true,
      priority: 1,
    },
    {
      id: 'suggestion',
      label: $localize`:@@featureAccountingBanking-colSuggestion:Suggestion`,
      value: (row) => this.suggestionLabel(row),
      priority: 3,
    },
    {
      id: 'account',
      label: $localize`:@@featureAccountingBanking-colAccount:Account`,
      value: (row) => this.accountNames().get(row.financialAccountId) ?? '',
      priority: 3,
    },
    {
      id: 'format',
      label: $localize`:@@featureAccountingBanking-colFormat:Format`,
      value: (row) => row.sourceFormat ?? '',
      priority: 3,
    },
  ];
  readonly txMenu = (row: AccountingBankTransaction): FpcMenuItem[] => {
    const reconciled = row.matchStatus === 'matched' || row.matchStatus === 'booked';
    const open = row.matchStatus === 'unmatched' || row.matchStatus === 'suggested';

    return [
      { id: 'match', label: $localize`:@@featureAccountingBanking-match:Match`, icon: 'link-45deg', disabled: !open },
      {
        id: 'unmatch',
        label: $localize`:@@featureAccountingBanking-unmatch:Undo match`,
        icon: 'arrow-counterclockwise',
        disabled: !reconciled,
      },
      { id: 'ignore', label: $localize`:@@featureAccountingBanking-ignore:Ignore`, icon: 'eye-slash', disabled: !open },
      { id: 'bookings', label: $localize`:@@featureAccountingBanking-bookings:Bookings`, icon: 'journal-text' },
      dbCopyIdItem(),
    ];
  };

  // ---- Match dialog ----

  readonly matchOpen = signal(false);
  readonly matchTx = signal<AccountingBankTransaction | null>(null);
  readonly matchTargets = signal<BankingMatchTargetForm[]>([]);
  matchLearn = false;
  readonly matchSum = computed(
    () => Math.round(this.matchTargets().reduce((s, t) => s + Math.abs(Number(t.amount ?? 0)), 0) * 100) / 100,
  );
  readonly matchExpected = computed(() => Math.abs(accountingNumber(this.matchTx()?.amount)));
  readonly matchValid = computed(
    () =>
      this.matchTargets().length > 0 &&
      Math.round(this.matchSum() * 100) === Math.round(this.matchExpected() * 100) &&
      this.matchTargets().every((t) =>
        t.type === 'account' ? Boolean(t.accountNumber.trim()) : Boolean(t.id.trim() || t.number.trim()),
      ),
  );

  // ---- Imports ----

  readonly importColumns: FpcTableColumn<AccountingBankImport>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAccountingBanking-colStatus:Status`,
      type: 'state',
      state: (row) => importStatusState(row.status),
    },
    {
      id: 'file',
      label: $localize`:@@featureAccountingBanking-colFile:File`,
      value: (row) => row.fileName,
      required: true,
      priority: 1,
    },
    {
      id: 'format',
      label: $localize`:@@featureAccountingBanking-colFormat:Format`,
      value: (row) => row.format ?? '',
      priority: 2,
    },
    {
      id: 'statements',
      label: $localize`:@@featureAccountingBanking-colStatements:Statements`,
      value: (row) => row.statementCount,
      align: 'end',
      priority: 3,
    },
    {
      id: 'transactions',
      label: $localize`:@@featureAccountingBanking-transactions:Transactions`,
      value: (row) => row.transactionCount,
      align: 'end',
      priority: 2,
    },
    {
      id: 'duplicates',
      label: $localize`:@@featureAccountingBanking-colDuplicates:Duplicates`,
      value: (row) => row.duplicateCount,
      align: 'end',
      priority: 3,
    },
    {
      id: 'matched',
      label: $localize`:@@featureAccountingBanking-colMatched:Matched`,
      value: (row) => row.matchedCount,
      align: 'end',
      priority: 3,
    },
    {
      id: 'created',
      label: $localize`:@@featureAccountingBanking-colCreated:Uploaded`,
      value: (row) => formatBillingDateTime(row.createdAt),
      priority: 2,
    },
    {
      id: 'notes',
      label: $localize`:@@featureAccountingBanking-colNotes:Warnings`,
      value: (row) => row.errorMessage ?? (row.warnings?.length ? row.warnings.join('; ') : ''),
      priority: 3,
    },
  ];
  readonly importMenu = (row: AccountingBankImport): FpcMenuItem[] => [
    { id: 'details', label: $localize`:@@featureAccountingBanking-details:Details`, icon: 'info-circle' },
    {
      id: 'download',
      label: $localize`:@@featureAccountingBanking-downloadOriginal:Download original`,
      icon: 'download',
    },
    {
      id: 'transactions',
      label: $localize`:@@featureAccountingBanking-showTransactions:Show transactions`,
      icon: 'list-ul',
    },
    {
      id: 'rollback',
      label: $localize`:@@featureAccountingBanking-rollback:Roll back`,
      icon: 'arrow-counterclockwise',
      disabled: row.status !== 'completed',
    },
  ];
  readonly uploadOpen = signal(false);
  readonly uploadDone = signal(false);
  readonly importDetailOpen = signal(false);
  uploadFile: File | null = null;
  uploadFormat: AccountingBankImportFormat | 'auto' = 'auto';
  uploadCsvSource = '';
  uploadEncoding: AccountingImportEncoding = 'auto';
  uploadQifDateFormat: AccountingQifDateFormat = 'auto';
  uploadAccountId = '';
  readonly importDetailItems = computed<FpcKeyValueItem[]>(() => {
    const row = this.importDetail().data;

    if (!row) return [];

    return [
      { key: 'file', label: $localize`:@@featureAccountingBanking-colFile:File`, value: row.fileName },
      {
        key: 'status',
        label: $localize`:@@featureAccountingBanking-colStatus:Status`,
        value: importStatusState(row.status).label,
      },
      {
        key: 'format',
        label: $localize`:@@featureAccountingBanking-colFormat:Format`,
        value: [row.format, row.formatVersion].filter(Boolean).join(' '),
      },
      { key: 'encoding', label: $localize`:@@featureAccountingBanking-encoding:Encoding`, value: row.encoding ?? '' },
      {
        key: 'account',
        label: $localize`:@@featureAccountingBanking-colAccount:Account`,
        value: row.financialAccountId ? (this.accountNames().get(row.financialAccountId) ?? '') : '',
      },
      {
        key: 'statements',
        label: $localize`:@@featureAccountingBanking-colStatements:Statements`,
        value: row.statementCount,
      },
      {
        key: 'transactions',
        label: $localize`:@@featureAccountingBanking-transactions:Transactions`,
        value: row.transactionCount,
      },
      {
        key: 'duplicates',
        label: $localize`:@@featureAccountingBanking-colDuplicates:Duplicates`,
        value: row.duplicateCount,
      },
      { key: 'matched', label: $localize`:@@featureAccountingBanking-colMatched:Matched`, value: row.matchedCount },
      {
        key: 'created',
        label: $localize`:@@featureAccountingBanking-colCreated:Uploaded`,
        value: formatBillingDateTime(row.createdAt),
      },
    ];
  });

  // ---- Financial accounts ----

  readonly accountColumns: FpcTableColumn<AccountingFinancialAccount>[] = [
    {
      id: 'name',
      label: $localize`:@@featureAccountingBanking-colName:Name`,
      value: (row) => row.name,
      required: true,
      priority: 1,
    },
    {
      id: 'kind',
      label: $localize`:@@featureAccountingBanking-colKind:Kind`,
      value: (row) => this.kindLabel(row.kind),
      priority: 2,
    },
    {
      id: 'iban',
      label: $localize`:@@featureAccountingBanking-colIban:IBAN / number`,
      value: (row) => row.iban ?? row.accountNumber ?? '',
      mono: true,
      priority: 2,
    },
    {
      id: 'ledger',
      label: $localize`:@@featureAccountingBanking-colLedger:Ledger account`,
      value: (row) => row.ledgerAccountNumber,
      mono: true,
      priority: 3,
    },
    {
      id: 'balance',
      label: $localize`:@@featureAccountingBanking-colBalance:Balance`,
      value: (row) => (row.lastClosingBalance == null ? '-' : accountingMoney(row.lastClosingBalance, row.currency)),
      align: 'end',
      priority: 1,
    },
    {
      id: 'balanceDate',
      label: $localize`:@@featureAccountingBanking-colBalanceDate:Balance date`,
      value: (row) => (row.lastClosingDate ? formatBillingDate(row.lastClosingDate) : '-'),
      priority: 3,
    },
    {
      id: 'scope',
      label: $localize`:@@featureAccountingBanking-colScope:Scope`,
      value: (row) =>
        row.tenantId ? billingTenantDisplayName(row.tenantId) : $localize`:@@featureAccountingBanking-shared:Shared`,
      priority: 3,
    },
    {
      id: 'active',
      label: $localize`:@@featureAccountingBanking-colActive:Active`,
      value: (row) => (row.isActive ? '✓' : ''),
      align: 'center',
      priority: 3,
    },
  ];
  readonly accountMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: $localize`:@@featureAccountingBanking-edit:Edit`, icon: 'pencil' },
    {
      id: 'transactions',
      label: $localize`:@@featureAccountingBanking-showTransactions:Show transactions`,
      icon: 'list-ul',
    },
    dbCopyIdItem(),
  ];
  readonly accountOpen = signal(false);
  editingAccountId: string | null = null;
  accountForm: FinancialAccountForm = this.emptyAccountForm();

  // ---- CSV mappings ----

  readonly mappingColumns: FpcTableColumn<AccountingCsvMapping>[] = [
    {
      id: 'name',
      label: $localize`:@@featureAccountingBanking-colName:Name`,
      value: (row) => row.name,
      required: true,
      priority: 1,
    },
    {
      id: 'dateFormat',
      label: $localize`:@@featureAccountingBanking-colDateFormat:Date format`,
      value: (row) => row.mapping?.dateFormat ?? '',
      mono: true,
      priority: 2,
    },
    {
      id: 'delimiter',
      label: $localize`:@@featureAccountingBanking-colDelimiter:Delimiter`,
      value: (row) => (row.mapping?.delimiter === '\t' ? 'TAB' : (row.mapping?.delimiter ?? '')),
      mono: true,
      priority: 3,
    },
    {
      id: 'updated',
      label: $localize`:@@featureAccountingBanking-colUpdated:Updated`,
      value: (row) => formatBillingDateTime(row.updatedAt),
      priority: 3,
    },
  ];
  readonly mappingMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: $localize`:@@featureAccountingBanking-edit:Edit`, icon: 'pencil' },
    { id: 'delete', label: $localize`:@@featureAccountingBanking-delete:Delete`, icon: 'trash' },
  ];
  readonly mappingOpen = signal(false);
  readonly mappingError = signal<string | null>(null);
  editingMappingId: string | null = null;
  mappingName = '';
  mappingJson = '';
  mappingPreset = '';

  // ---- Rules ----

  readonly ruleColumns: FpcTableColumn<AccountingMatchRule>[] = [
    {
      id: 'kind',
      label: $localize`:@@featureAccountingBanking-colRuleKind:Kind`,
      value: (row) => (row.kind === 'iban' ? 'IBAN' : $localize`:@@featureAccountingBanking-ruleText:Text`),
      priority: 2,
    },
    {
      id: 'pattern',
      label: $localize`:@@featureAccountingBanking-colPattern:Pattern`,
      value: (row) => row.pattern,
      mono: true,
      required: true,
      priority: 1,
    },
    {
      id: 'target',
      label: $localize`:@@featureAccountingBanking-colTarget:Target`,
      value: (row) => `${this.ruleTargetLabel(row.targetType)} ${row.targetLabel ?? row.targetId}`,
      priority: 1,
    },
    {
      id: 'taxCode',
      label: $localize`:@@featureAccountingBanking-colTaxCode:Tax code`,
      value: (row) => row.taxCode ?? '',
      mono: true,
      priority: 3,
    },
    {
      id: 'hits',
      label: $localize`:@@featureAccountingBanking-colHits:Hits`,
      value: (row) => row.hits,
      align: 'end',
      priority: 2,
    },
  ];
  readonly ruleMenu = (): FpcMenuItem[] => [
    { id: 'delete', label: $localize`:@@featureAccountingBanking-delete:Delete`, icon: 'trash' },
  ];
  readonly ruleOpen = signal(false);
  ruleForm: AccountingMatchRuleInput = this.emptyRuleForm();

  // ---- Confirm / sync ----

  readonly confirmOpen = signal(false);
  readonly confirmMessage = signal('');
  private confirmAction: (() => void) | null = null;
  readonly syncResult = signal<AccountingProcessorSyncResult | null>(null);

  ngOnInit(): void {
    this.capabilities.loadCapabilities();
    this.facade.load({ key: 'overview' });
    this.facade.load({ key: 'financialAccounts' });
    this.facade.load({ key: 'imports', limit: 100 });
    this.facade.load({ key: 'csvPresets' });
    this.facade.load({ key: 'csvMappings' });
    this.loadStatistics();

    if (this.globalAccess()) this.facade.load({ key: 'matchRules' });

    const base = { loading$: this.facade.mutating$, error$: this.facade.mutationError$, destroyRef: this.destroyRef };

    watchBillingMutationModalClose({ ...base, open: this.matchOpen });
    watchBillingMutationModalClose({ ...base, open: this.accountOpen });
    watchBillingMutationModalClose({ ...base, open: this.mappingOpen });
    watchBillingMutationModalClose({ ...base, open: this.ruleOpen });
    this.facade.lastMutation$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((last) => {
      if (last?.kind === 'uploadImport' && this.uploadOpen()) this.uploadDone.set(true);

      if (last?.kind === 'runProcessorSync') this.syncResult.set(last.result as AccountingProcessorSyncResult);
    });
  }

  // ---- Tabs ----

  onTabChange(id: string | null): void {
    if (id === 'statistics' || id === 'list') this.activeTab.set(id);
  }

  onListTabChange(id: string | null): void {
    if (id === 'transactions' || id === 'imports' || id === 'accounts' || id === 'mappings' || id === 'rules') {
      this.listTab.set(id);

      if (id === 'rules') this.facade.load({ key: 'matchRules' });
    }
  }

  tabLabel(tab: BankingTab): string {
    return tab === 'statistics'
      ? $localize`:@@featureAccountingBanking-statistics:Statistics`
      : $localize`:@@featureAccountingBanking-list:Banking`;
  }

  // ---- Statistics ----

  loadStatistics(): void {
    this.facade.load({ key: 'bankStatistics', range: { from: this.fromDate(), to: this.toDate() } });
  }

  applyStatsFilters(): void {
    this.fromDate.set(this.fromDraft || accountingYearStart());
    this.toDate.set(this.toDraft || accountingYearEnd());
    this.statsOpen.set(false);
    this.loadStatistics();
  }

  resetStatsFilters(): void {
    this.fromDraft = accountingYearStart();
    this.toDraft = accountingYearEnd();
    this.applyStatsFilters();
  }

  money(value: number | string | null | undefined, currency?: string | null): string {
    return accountingMoney(value, currency);
  }

  percent(value: number | null | undefined): string {
    return accountingPercent(value);
  }

  // ---- Transactions ----

  applyTxFilters(): void {
    this.matchStatus.set(this.matchStatusDraft);
    this.financialAccountId.set(this.financialAccountDraft);
    this.txFiltersOpen.set(false);
  }

  clearTxFilters(): void {
    this.matchStatusDraft = '';
    this.financialAccountDraft = '';
    this.matchStatus.set('');
    this.financialAccountId.set('');
    this.importId.set('');
  }

  clearImportFilter(): void {
    this.importId.set('');
  }

  statusLabel(status: string): string {
    return matchStatusLabel(status);
  }

  suggestionLabel(row: AccountingBankTransaction): string {
    const suggestion = row.suggestion;

    if (!suggestion) return '';

    const label = suggestion.label ?? (suggestion.reasons ?? []).join(', ');

    return suggestion.score != null ? `${label} (${Math.round(Number(suggestion.score) * 100)}%)` : label;
  }

  onTxAction(row: AccountingBankTransaction, action: string): void {
    if (action === 'match') this.openMatch(row);
    else if (action === 'unmatch') {
      this.confirm(
        $localize`:@@featureAccountingBanking-confirmUnmatch:Undo the reconciliation and its bookings?`,
        () => this.facade.mutate({ kind: 'unmatchTransaction', transactionId: row.id }),
      );
    } else if (action === 'ignore') this.facade.mutate({ kind: 'ignoreTransaction', transactionId: row.id });
    else if (action === 'bookings') {
      void this.router.navigate(['/administration/accounting/journal'], {
        queryParams: { linkType: 'bank_transaction', targetId: row.id },
      });
    } else if (action === 'copy-id') fpcCopyText(row.id);
  }

  onTxActivate(row: AccountingBankTransaction): void {
    if (row.matchStatus === 'unmatched' || row.matchStatus === 'suggested') this.openMatch(row);
  }

  // ---- Match ----

  openMatch(row: AccountingBankTransaction): void {
    this.matchTx.set(row);
    this.matchLearn = false;
    this.matchTargets.set([
      this.emptyTarget(Math.abs(accountingNumber(row.amount)), accountingNumber(row.amount) >= 0),
    ]);
    this.facade.clearMutation();
    this.facade.load({ key: 'suggestions', transactionId: row.id });

    const chartId = this.currentFiscalYear()?.chartId;

    if (chartId) this.facade.load({ key: 'taxCodes', chartId });

    showBillingModal(this.matchOpen);
  }

  /** Date and counterparty next to the amount in the match dialog (empty parts left out). */
  matchHeaderDetails(tx: AccountingBankTransaction): string[] {
    return [formatBillingDate(tx.bookingDate), tx.counterpartyName?.trim() || tx.counterpartyIban?.trim() || ''].filter(
      Boolean,
    );
  }

  applySuggestion(suggestion: AccountingMatchSuggestion): void {
    this.matchTargets.set(
      suggestion.targets.map(
        (t): BankingMatchTargetForm =>
          t.type === 'account'
            ? {
                type: 'account',
                id: '',
                number: '',
                accountNumber: t.accountNumber,
                taxCode: t.taxCode ?? '',
                description: t.description ?? '',
                amount: Math.abs(t.amount),
              }
            : {
                type: t.type,
                id: t.id ?? '',
                number: t.number ?? '',
                accountNumber: '',
                taxCode: '',
                description: '',
                amount: Math.abs(t.amount),
              },
      ),
    );
  }

  suggestionText(suggestion: AccountingMatchSuggestion): string {
    return suggestion.label ?? suggestion.reasons.join(', ');
  }

  scorePercent(score: number): string {
    return accountingPercent(score > 1 ? score / 100 : score);
  }

  addTarget(): void {
    const remaining = Math.max(0, Math.round((this.matchExpected() - this.matchSum()) * 100) / 100);
    const incoming = accountingNumber(this.matchTx()?.amount) >= 0;

    this.matchTargets.update((targets) => [...targets, this.emptyTarget(remaining, incoming)]);
  }

  removeTarget(index: number): void {
    this.matchTargets.update((targets) => targets.filter((_, i) => i !== index));
  }

  patchTarget(index: number, patch: Partial<BankingMatchTargetForm>): void {
    this.matchTargets.update((targets) => targets.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  submitMatch(): void {
    const tx = this.matchTx();

    if (!tx || !this.matchValid()) return;

    this.facade.mutate({
      kind: 'matchTransaction',
      transactionId: tx.id,
      // Learned rules are entity-wide: only global access may create them.
      dto: buildMatchInput(this.matchTargets(), this.globalAccess() && this.matchLearn),
    });
  }

  // ---- Imports ----

  openUpload(): void {
    this.uploadFile = null;
    this.uploadFormat = 'auto';
    this.uploadCsvSource = '';
    this.uploadEncoding = 'auto';
    this.uploadQifDateFormat = 'auto';
    this.uploadAccountId = '';
    this.uploadDone.set(false);
    this.facade.clearMutation();
    showBillingModal(this.uploadOpen);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;

    this.uploadFile = input?.files?.[0] ?? null;
  }

  showCsvOptions(): boolean {
    return this.uploadFormat === 'csv' || this.uploadFormat === 'auto';
  }

  showQifOptions(): boolean {
    return this.uploadFormat === 'qif' || this.uploadFormat === 'auto';
  }

  submitUpload(): void {
    if (!this.uploadFile) return;

    this.facade.mutate({
      kind: 'uploadImport',
      upload: buildBankImportUpload({
        file: this.uploadFile,
        format: this.uploadFormat,
        csvSource: this.uploadCsvSource,
        encoding: this.uploadEncoding,
        qifDateFormat: this.uploadQifDateFormat,
        financialAccountId: this.uploadAccountId,
      }),
    });
  }

  onImportAction(row: AccountingBankImport, action: string): void {
    if (action === 'details') this.openImportDetail(row);
    else if (action === 'download') void this.downloadImport(row);
    else if (action === 'transactions') this.showImportTransactions(row.id);
    else if (action === 'rollback') {
      this.confirm(
        $localize`:@@featureAccountingBanking-confirmRollback:Roll back this import? Its transactions and their reconciliations are removed.`,
        () => this.facade.mutate({ kind: 'rollbackImport', id: row.id }),
      );
    }
  }

  openImportDetail(row: AccountingBankImport): void {
    this.facade.load({ key: 'importDetail', id: row.id });
    showBillingModal(this.importDetailOpen);
  }

  async downloadImport(row: AccountingBankImport): Promise<void> {
    const blob = await firstValueFrom(this.service.downloadImportFile(row.id));

    saveAccountingBlob(blob, row.fileName);
  }

  showImportTransactions(importId: string): void {
    this.importId.set(importId);
    this.importDetailOpen.set(false);
    this.listTab.set('transactions');
  }

  // ---- Financial accounts ----

  kindLabel(kind: AccountingFinancialAccountKind | string): string {
    const labels: Record<string, string> = {
      bank: $localize`:@@featureAccountingBanking-kindBank:Bank`,
      cash: $localize`:@@featureAccountingBanking-kindCash:Cash`,
      processor: $localize`:@@featureAccountingBanking-kindProcessor:Payment processor`,
      other: $localize`:@@featureAccountingBanking-kindOther:Other`,
    };

    return labels[kind] ?? kind;
  }

  openAccount(row?: AccountingFinancialAccount): void {
    this.editingAccountId = row?.id ?? null;
    this.accountForm = row
      ? {
          name: row.name,
          kind: row.kind,
          iban: row.iban ?? '',
          accountNumber: row.accountNumber ?? '',
          bic: row.bic ?? '',
          currency: row.currency,
          ledgerAccountNumber: row.ledgerAccountNumber,
          processor: (row.processor as FinancialAccountForm['processor']) ?? '',
          shared: !row.tenantId,
          isActive: row.isActive,
        }
      : this.emptyAccountForm();
    this.facade.clearMutation();
    showBillingModal(this.accountOpen);
  }

  onAccountAction(row: AccountingFinancialAccount, action: string): void {
    if (action === 'edit') this.openAccount(row);
    else if (action === 'transactions') {
      this.financialAccountDraft = row.id;
      this.financialAccountId.set(row.id);
      this.listTab.set('transactions');
    } else if (action === 'copy-id') fpcCopyText(row.id);
  }

  accountFormValid(): boolean {
    const f = this.accountForm;

    return Boolean(f.name.trim() && /^[A-Za-z]{3}$/.test(f.currency.trim()) && f.ledgerAccountNumber.trim());
  }

  submitAccount(): void {
    if (!this.accountFormValid()) return;

    const f = this.accountForm;
    const dto: AccountingFinancialAccountInput = {
      name: f.name.trim(),
      kind: f.kind,
      iban: f.iban.trim() || null,
      accountNumber: f.accountNumber.trim() || null,
      bic: f.bic.trim().toUpperCase() || null,
      currency: f.currency.trim().toUpperCase(),
      ledgerAccountNumber: f.ledgerAccountNumber.trim(),
      processor: f.kind === 'processor' && f.processor ? f.processor : null,
      isActive: f.isActive,
    };

    // Shared accounts (no tenant) are global-only; otherwise the owner stays as is (new: request tenant).
    if (this.globalAccess() && f.shared) dto.tenantId = null;

    this.facade.mutate({ kind: 'saveFinancialAccount', id: this.editingAccountId ?? undefined, dto });
  }

  // ---- CSV mappings ----

  openMapping(row?: AccountingCsvMapping): void {
    this.editingMappingId = row?.id ?? null;
    this.mappingName = row?.name ?? '';
    this.mappingJson = row ? JSON.stringify(row.mapping, null, 2) : '';
    this.mappingPreset = '';
    this.mappingError.set(null);
    this.facade.clearMutation();
    showBillingModal(this.mappingOpen);
  }

  applyPreset(key: string): void {
    this.mappingPreset = key;

    const preset = (this.presets().data ?? []).find((p) => p.key === key);

    if (!preset) return;

    this.mappingJson = JSON.stringify(preset.mapping, null, 2);

    if (!this.mappingName.trim()) this.mappingName = preset.label;
  }

  submitMapping(): void {
    let mapping: Record<string, unknown>;

    try {
      mapping = JSON.parse(this.mappingJson) as Record<string, unknown>;
    } catch (error) {
      this.mappingError.set(
        $localize`:@@featureAccountingBanking-mappingInvalidJson:The mapping is not valid JSON: ${(error as Error).message}:message:`,
      );

      return;
    }

    if (
      !mapping ||
      typeof mapping !== 'object' ||
      Array.isArray(mapping) ||
      !mapping['columns'] ||
      !mapping['dateFormat']
    ) {
      this.mappingError.set(
        $localize`:@@featureAccountingBanking-mappingMissingFields:The mapping needs "columns" and "dateFormat".`,
      );

      return;
    }

    if (!this.mappingName.trim()) {
      this.mappingError.set($localize`:@@featureAccountingBanking-mappingMissingName:Enter a name.`);

      return;
    }

    this.mappingError.set(null);
    this.facade.mutate({
      kind: 'saveCsvMapping',
      id: this.editingMappingId ?? undefined,
      dto: { name: this.mappingName.trim(), mapping },
    });
  }

  onMappingAction(row: AccountingCsvMapping, action: string): void {
    if (action === 'edit') this.openMapping(row);
    else if (action === 'delete') {
      this.confirm(
        $localize`:@@featureAccountingBanking-confirmDeleteMapping:Delete the CSV mapping "${row.name}:name:"?`,
        () => this.facade.mutate({ kind: 'deleteCsvMapping', id: row.id }),
      );
    }
  }

  // ---- Rules ----

  ruleTargetLabel(type: string): string {
    const labels: Record<string, string> = {
      customer: $localize`:@@featureAccountingBanking-targetCustomer:Customer`,
      supplier: $localize`:@@featureAccountingBanking-targetSupplier:Supplier`,
      account: $localize`:@@featureAccountingBanking-targetAccount:Account`,
    };

    return labels[type] ?? type;
  }

  openRule(): void {
    this.ruleForm = this.emptyRuleForm();
    this.facade.clearMutation();
    showBillingModal(this.ruleOpen);
  }

  ruleValid(): boolean {
    return this.ruleForm.pattern.trim().length >= 3 && Boolean(this.ruleForm.targetId.trim());
  }

  submitRule(): void {
    if (!this.ruleValid()) return;

    const taxCode = this.ruleForm.taxCode?.trim();

    this.facade.mutate({
      kind: 'createMatchRule',
      dto: {
        kind: this.ruleForm.kind,
        pattern: this.ruleForm.pattern.trim(),
        targetType: this.ruleForm.targetType,
        targetId: this.ruleForm.targetId.trim(),
        ...(taxCode ? { taxCode } : {}),
      },
    });
  }

  onRuleAction(row: AccountingMatchRule, action: string): void {
    if (action === 'delete') {
      this.confirm($localize`:@@featureAccountingBanking-confirmDeleteRule:Delete this match rule?`, () =>
        this.facade.mutate({ kind: 'deleteMatchRule', id: row.id }),
      );
    }
  }

  // ---- Sync / confirm ----

  runProcessorSync(): void {
    this.syncResult.set(null);
    this.facade.mutate({ kind: 'runProcessorSync' });
  }

  syncSummary(result: AccountingProcessorSyncResult): string {
    const imported = result.reduce((s, r) => s + r.imported, 0);
    const errors = result
      .filter((r) => r.error)
      .map((r) => `${this.accountNames().get(r.accountId) ?? r.accountId}: ${r.error}`);

    return [
      $localize`:@@featureAccountingBanking-syncImported:Processor sync imported ${imported}:count: transactions.`,
      ...errors,
    ].join(' ');
  }

  onConfirmed(): void {
    const action = this.confirmAction;

    this.confirmAction = null;
    this.confirmOpen.set(false);
    action?.();
  }

  private confirm(message: string, action: () => void): void {
    this.confirmMessage.set(message);
    this.confirmAction = action;
    this.facade.clearMutation();
    showBillingModal(this.confirmOpen);
  }

  private emptyTarget(amount: number, incoming: boolean): BankingMatchTargetForm {
    return {
      type: incoming ? 'invoice' : 'supplier_invoice',
      id: '',
      number: '',
      accountNumber: '',
      taxCode: '',
      description: '',
      amount,
    };
  }

  private emptyAccountForm(): FinancialAccountForm {
    return {
      name: '',
      kind: 'bank',
      iban: '',
      accountNumber: '',
      bic: '',
      currency: 'EUR',
      ledgerAccountNumber: '',
      processor: '',
      shared: false,
      isActive: true,
    };
  }

  private emptyRuleForm(): AccountingMatchRuleInput {
    return { kind: 'iban', pattern: '', targetType: 'customer', targetId: '', taxCode: '' };
  }
}
