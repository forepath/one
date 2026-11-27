import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  type AccountingDownloadableExportKind,
  type AccountingOverview,
  type AccountingStatement,
  type AccountingStatementKind,
  type AccountingStatementNode,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListToolbarComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { formatBillingDate } from '../billing-format';

import { AccountingNavComponent } from './accounting-nav.component';
import { ACCOUNTING_ALL_TENANTS, AccountingTenantSwitchComponent } from './accounting-tenant-switch.component';
import {
  accountingMoney,
  accountingTenantParam,
  accountingToday,
  accountingYearStart,
  emptyAccountingResource,
  exportKindLabel,
  saveAccountingBlob,
} from './accounting-ui';

/** One rendered row of a statement section (positions nested by `level`, accounts below leaf positions). */
export interface StatementRow {
  type: 'node' | 'account';
  key: string;
  level: number;
  code: string | null;
  label: string;
  amount: number;
  previousAmount: number | null;
  /** Position with child positions (bold). */
  group: boolean;
}

const STATUTORY_EXPORTS: readonly AccountingDownloadableExportKind[] = ['gdpdu', 'fec', 'saft', 'xaf'];

/** Depth-first rows of a statement section; accounts are listed only with `withAccounts`. */
export function flattenStatementNodes(
  nodes: readonly AccountingStatementNode[],
  withAccounts: boolean,
  level = 0,
  rows: StatementRow[] = [],
): StatementRow[] {
  for (const node of nodes) {
    rows.push({
      type: 'node',
      key: `n-${node.code}`,
      level,
      code: node.code,
      label: node.label,
      amount: node.amount,
      previousAmount: node.previousAmount ?? null,
      group: node.children.length > 0,
    });

    if (withAccounts) {
      for (const account of node.accounts) {
        rows.push({
          type: 'account',
          key: `a-${node.code}-${account.number}`,
          level: level + 1,
          code: account.number,
          label: account.name,
          amount: account.amount,
          previousAmount: null,
          group: false,
        });
      }
    }

    flattenStatementNodes(node.children, withAccounts, level + 1, rows);
  }

  return rows;
}

function statementKindLabel(kind: AccountingStatementKind): string {
  switch (kind) {
    case 'balance_sheet':
      return $localize`:@@featureAccountingStatements-balanceSheet:Balance sheet`;
    case 'cash_basis':
      return $localize`:@@featureAccountingStatements-cashBasis:Cash-basis result`;
    default:
      return $localize`:@@featureAccountingStatements-profitAndLoss:Profit and loss`;
  }
}

function hasPrevious(nodes: readonly AccountingStatementNode[]): boolean {
  return nodes.some((n) => (n.previousAmount !== undefined && n.previousAmount !== null) || hasPrevious(n.children));
}

/**
 * Statements (balance sheet, P&L, cash-basis result) for a range with nested positions and the previous-year
 * column, plus the ledger exports (journal / trial balance CSV always, GDPdU / FEC / SAF-T per country profile).
 */
@Component({
  selector: 'framework-accounting-statements-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AccountingNavComponent,
    AccountingTenantSwitchComponent,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListToolbarComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './accounting-statements-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './accounting-section.scss',
})
export class AccountingStatementsPageComponent implements OnInit {
  private readonly facade = inject(AccountingFacade);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly service = inject(AdminAccountingService);

  readonly pageTitle = $localize`:@@featureAccountingStatements-title:Statements and exports`;
  readonly statementPanelTitle = $localize`:@@featureAccountingStatements-statement:Statement`;
  readonly exportsPanelTitle = $localize`:@@featureAccountingStatements-exports:Exports`;
  readonly asOfLabel = $localize`:@@featureAccountingStatements-asOf:As of`;
  readonly toLabel = $localize`:@@featureAccountingStatements-to:To`;
  readonly money = accountingMoney;
  readonly exportKindLabel = exportKindLabel;
  readonly formatDate = (value: string | null | undefined): string => formatBillingDate(value ?? null);

  readonly filtersTitle = $localize`:@@featureAccountingBanking-filters:Filters`;
  readonly filtersOpen = signal(false);
  kind: AccountingStatementKind = 'profit_and_loss';
  from = accountingYearStart();
  to = accountingToday();
  draftKind: AccountingStatementKind = this.kind;
  draftFrom = this.from;
  draftTo = this.to;
  /** Bumped on apply so the toolbar lead / count recompute (kind / from / to are plain fields bound by ngModel). */
  private readonly applied = signal(0);
  readonly activeFilterCount = computed(() => {
    this.applied();

    return (
      (this.kind !== 'profit_and_loss' ? 1 : 0) +
      (this.from !== accountingYearStart() || this.to !== accountingToday() ? 1 : 0)
    );
  });
  readonly scopeLabel = computed(() => {
    this.applied();

    const kind = statementKindLabel(this.kind);

    return this.kind === 'balance_sheet'
      ? `${kind}: ${this.asOfLabel} ${this.formatDate(this.to)}`
      : `${kind}: ${this.formatDate(this.from)} – ${this.formatDate(this.to)}`;
  });
  readonly showAccounts = signal(false);

  readonly overview = toSignal(this.facade.overview$, { initialValue: emptyAccountingResource<AccountingOverview>() });
  readonly statement = toSignal(this.facade.statement$, {
    initialValue: emptyAccountingResource<AccountingStatement>(),
  });
  readonly viewTenantId = toSignal(this.facade.viewTenantId$, { initialValue: null as string | null });
  readonly globalAccess = toSignal(this.capabilities.accountingGlobalAccess$, { initialValue: false });

  readonly hasCashBasis = computed(() => this.overview().data?.profile.hasCashBasis === true);
  /** Tenant-filtered statements are management reports; `all` is the statutory view. */
  readonly managementReport = computed(
    () => this.globalAccess() === true && this.viewTenantId() !== ACCOUNTING_ALL_TENANTS,
  );
  readonly sections = computed(() => {
    const statement = this.statement().data;
    const withAccounts = this.showAccounts();

    return (statement?.sections ?? []).map((section) => ({
      key: section.key,
      label: section.label,
      total: section.total,
      rows: flattenStatementNodes(section.nodes, withAccounts),
    }));
  });
  readonly showPrevious = computed(() => (this.statement().data?.sections ?? []).some((s) => hasPrevious(s.nodes)));
  readonly unassigned = computed(() => this.statement().data?.unassigned ?? []);

  /** Journal / trial balance CSV always; statutory formats only when the country profile offers them. */
  readonly exportKinds = computed<AccountingDownloadableExportKind[]>(() => {
    const offered = this.overview().data?.profile.exports ?? [];

    return ['journal_csv', 'trial_balance_csv', ...STATUTORY_EXPORTS.filter((kind) => offered.includes(kind))];
  });
  readonly downloading = signal<AccountingDownloadableExportKind | null>(null);
  readonly downloadError = signal<string | null>(null);

  ngOnInit(): void {
    this.capabilities.loadCapabilities();
    this.facade.load({ key: 'overview' });
    this.loadStatement();
  }

  loadStatement(): void {
    if (this.kind === 'cash_basis' && this.overview().loaded && !this.hasCashBasis()) {
      this.kind = 'profit_and_loss';
    }

    this.facade.load({ key: 'statement', params: { kind: this.kind, from: this.from, to: this.to } });
  }

  onKindChange(kind: AccountingStatementKind): void {
    this.kind = kind;
    this.draftKind = kind;
    this.applied.update((n) => n + 1);
    this.loadStatement();
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersOpen.set(open);

    if (open) {
      this.draftKind = this.kind;
      this.draftFrom = this.from;
      this.draftTo = this.to;
    }
  }

  applyFilters(): void {
    this.kind = this.draftKind;
    const from = this.draftFrom || accountingYearStart();
    const to = this.draftTo || accountingToday();

    // An inverted range would yield an empty statement (and empty exports): take it the right way round.
    [this.from, this.to] = from <= to ? [from, to] : [to, from];
    this.draftFrom = this.from;
    this.draftTo = this.to;
    this.filtersOpen.set(false);
    this.applied.update((n) => n + 1);
    this.loadStatement();
  }

  resetFilters(): void {
    this.draftKind = 'profit_and_loss';
    this.draftFrom = accountingYearStart();
    this.draftTo = accountingToday();
    this.applyFilters();
  }

  rowClass(row: StatementRow): string {
    const level = Math.min(row.level, 3);

    if (row.type === 'account') return `accounting-statement-account accounting-statement-node--level-${level}`;

    return `accounting-statement-node--level-${level}${row.group ? ' accounting-statement-node--group' : ''}`;
  }

  /** Why an export cannot be downloaded right now (`null` = available); shown as the button tooltip. */
  exportDisabledReason(kind: AccountingDownloadableExportKind): string | null {
    if (!STATUTORY_EXPORTS.includes(kind)) return null;

    if (!this.globalAccess()) {
      return $localize`:@@featureAccountingStatements-needsGlobal:Statutory exports need entity-wide access.`;
    }

    const feature = this.overview().data?.features.find((f) => f.key === kind);

    if (feature && !feature.available) {
      return feature.missing.length > 0
        ? $localize`:@@featureAccountingStatements-missingConfig:Not configured. Missing: ${feature.missing.join(', ')}:missing:`
        : $localize`:@@featureAccountingStatements-unavailable:Not available for this configuration.`;
    }

    if (this.viewTenantId() !== ACCOUNTING_ALL_TENANTS) {
      return $localize`:@@featureAccountingStatements-needsAll:Statutory exports cover all tenants; select All tenants.`;
    }

    return null;
  }

  exportFileName(kind: AccountingDownloadableExportKind): string {
    const range = `${this.from}_${this.to}`;
    const names: Record<AccountingDownloadableExportKind, string> = {
      journal_csv: `journal_${range}.csv`,
      trial_balance_csv: `trial-balance_${range}.csv`,
      gdpdu: `gdpdu_${range}.zip`,
      fec: `FEC_${range}.txt`,
      saft: `saft_${range}.xml`,
      xaf: `auditfile_${range}.xaf`,
    };

    return names[kind];
  }

  async downloadExport(kind: AccountingDownloadableExportKind): Promise<void> {
    if (this.exportDisabledReason(kind) || this.downloading()) return;

    this.downloading.set(kind);
    this.downloadError.set(null);

    try {
      const blob = await firstValueFrom(
        this.service.downloadExport(kind, { from: this.from, to: this.to }, accountingTenantParam(this.viewTenantId())),
      );

      saveAccountingBlob(blob, this.exportFileName(kind));
    } catch {
      this.downloadError.set(
        $localize`:@@featureAccountingStatements-downloadFailed:The export could not be created. Check the period and try again.`,
      );
    } finally {
      this.downloading.set(null);
    }
  }
}
