import { CommonModule, DatePipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminBillingFacade,
  InvoicesFacade,
  type AdminInvoiceListItem,
  type BillingAuditLogResponse,
  type BillingStatisticsSeriesPoint,
} from '@forepath/framework/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexNonAxisChartSeries,
  ApexTitleSubtitle,
  ApexXAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import { filter, Observable, pairwise, take } from 'rxjs';

const PAGE_SIZE = 10;
const FILTERS_STORAGE_KEY = 'billing-console-admin-billing-filters';

interface AdminBillingFiltersStorage {
  fromDate: string;
  toDate: string;
  groupBy: 'day' | 'month';
  userId: string | null;
  filtersCollapsed: boolean;
}

const BS_CHART_COLORS = [
  'var(--bs-primary)',
  'var(--bs-secondary)',
  'var(--bs-success)',
  'var(--bs-danger)',
  'var(--bs-warning)',
  'var(--bs-info)',
] as const;

@Component({
  selector: 'framework-admin-billing-page',
  standalone: true,
  imports: [CommonModule, FormsModule, NgApexchartsModule],
  providers: [DatePipe],
  templateUrl: './admin-billing-page.component.html',
  styleUrls: ['./admin-billing-page.component.scss'],
})
export class AdminBillingPageComponent implements OnInit, AfterViewInit {
  @ViewChild('billNowModal', { static: false }) private billNowModal!: ElementRef<HTMLDivElement>;
  @ViewChild('actionConfirmModal', { static: false }) private actionConfirmModal!: ElementRef<HTMLDivElement>;
  @ViewChild('auditHistoryModal', { static: false }) private auditHistoryModal!: ElementRef<HTMLDivElement>;

  private readonly adminBillingFacade = inject(AdminBillingFacade);
  private readonly invoicesFacade = inject(InvoicesFacade);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly PAGE_SIZE = PAGE_SIZE;

  readonly filtersCollapsed = signal(true);
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<'day' | 'month'>('day');
  readonly selectedUserId = signal<string | null>(null);
  readonly invoiceSearch = signal('');
  readonly invoicesPage = signal(0);

  readonly billNowScope = signal<'all' | 'user'>('all');
  readonly billNowUserId = signal<string | null>(null);
  readonly billNowUserSearch = signal('');

  readonly pendingAction = signal<'void' | 'markPaid' | 'markUnpaid' | null>(null);
  readonly pendingInvoice = signal<AdminInvoiceListItem | null>(null);
  readonly actionReason = signal('');
  readonly auditInvoiceId = signal<string | null>(null);

  readonly summary$ = this.adminBillingFacade.summary$;
  readonly summaryLoading$ = this.adminBillingFacade.summaryLoading$;
  readonly summaryError$ = this.adminBillingFacade.summaryError$;
  readonly openOverdueItems$ = this.adminBillingFacade.openOverdueItems$;
  readonly openOverdueTotal$ = this.adminBillingFacade.openOverdueTotal$;
  readonly openOverdueLoading$ = this.adminBillingFacade.openOverdueLoading$;
  readonly openOverdueError$ = this.adminBillingFacade.openOverdueError$;
  readonly billNowLoading$ = this.adminBillingFacade.billNowLoading$;
  readonly billNowResult$ = this.adminBillingFacade.billNowResult$;
  readonly billNowError$ = this.adminBillingFacade.billNowError$;
  readonly actionLoading$ = this.adminBillingFacade.actionLoading$;
  readonly actionError$ = this.adminBillingFacade.actionError$;
  readonly statisticsSummary$ = this.adminBillingFacade.statisticsSummary$;
  readonly statisticsSummaryLoading$ = this.adminBillingFacade.statisticsSummaryLoading$;
  readonly statisticsByProduct$ = this.adminBillingFacade.statisticsByProduct$;
  readonly statisticsByProductLoading$ = this.adminBillingFacade.statisticsByProductLoading$;
  readonly statisticsError$ = this.adminBillingFacade.statisticsError$;
  readonly auditLogsByInvoice$ = this.adminBillingFacade.auditLogsByInvoice$;
  readonly auditLogsLoading$ = this.adminBillingFacade.auditLogsLoading$;

  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });
  readonly openOverdueItems = toSignal(this.openOverdueItems$, { initialValue: [] as AdminInvoiceListItem[] });
  readonly openOverdueTotal = toSignal(this.openOverdueTotal$, { initialValue: 0 });
  readonly statisticsSummary = toSignal(this.statisticsSummary$, { initialValue: null });
  readonly statisticsByProduct = toSignal(this.statisticsByProduct$, { initialValue: null });
  readonly auditLogsByInvoice = toSignal(this.auditLogsByInvoice$, {
    initialValue: {} as Record<string, BillingAuditLogResponse[]>,
  });

  readonly selectedAuditLogs = computed(() => {
    const id = this.auditInvoiceId();

    if (!id) return [] as BillingAuditLogResponse[];

    return this.auditLogsByInvoice()[id] ?? [];
  });

  readonly filteredBillNowUsers = computed(() => {
    const term = this.billNowUserSearch().trim().toLowerCase();
    const list = this.users();

    if (!term) return list;

    return list.filter((user) => user.email.toLowerCase().includes(term) || user.id.toLowerCase().includes(term));
  });

  readonly totalInvoicePages = computed(() => Math.max(1, Math.ceil(this.openOverdueTotal() / PAGE_SIZE)));

  readonly seriesChartOptions = computed(() => this.buildSeriesChart(this.statisticsSummary()?.series ?? []));
  readonly donutChartOptions = computed(() => this.buildDonutChart(this.statisticsByProduct()?.items ?? []));

  ngOnInit(): void {
    this.restoreFilters();
    this.setDefaultDates();
    this.adminBillingFacade.loadSummary();
    this.loadInvoices();
    this.loadStatistics();

    this.authFacade.loadUsers();

    this.billNowResult$
      .pipe(
        pairwise(),
        filter(([prev, next]) => !prev && !!next),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.billNowModal);
        this.adminBillingFacade.loadSummary();
        this.loadInvoices();
      });
  }

  ngAfterViewInit(): void {
    this.adminBillingFacade.billNowError$
      .pipe(
        filter((err) => !!err),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  onToggleFilters(): void {
    this.filtersCollapsed.update((v) => !v);
    this.persistFilters();
  }

  onApplyFilters(): void {
    this.persistFilters();
    this.loadStatistics();
  }

  onResetFilters(): void {
    this.setDefaultDates();
    this.groupBy.set('day');
    this.selectedUserId.set(null);
    this.persistFilters();
    this.loadStatistics();
  }

  onInvoiceSearch(): void {
    this.invoicesPage.set(0);
    this.loadInvoices();
  }

  onInvoicesPageChange(page: number): void {
    this.invoicesPage.set(page);
    this.loadInvoices();
  }

  openBillNowModal(): void {
    this.billNowScope.set('all');
    this.billNowUserId.set(null);
    this.billNowUserSearch.set('');
    this.showModal(this.billNowModal);
  }

  submitBillNow(): void {
    const dto = this.billNowScope() === 'user' && this.billNowUserId() ? { userId: this.billNowUserId()! } : {};

    this.adminBillingFacade.billNow(dto);
  }

  openActionModal(action: 'void' | 'markPaid' | 'markUnpaid', invoice: AdminInvoiceListItem): void {
    this.pendingAction.set(action);
    this.pendingInvoice.set(invoice);
    this.actionReason.set('');
    this.showModal(this.actionConfirmModal);
  }

  confirmAction(): void {
    const invoice = this.pendingInvoice();
    const action = this.pendingAction();

    if (!invoice || !action) return;

    const reason = this.actionReason().trim() || undefined;

    if (action === 'void') {
      this.adminBillingFacade.voidInvoice(invoice.id);
    } else if (action === 'markPaid') {
      this.adminBillingFacade.markPaid(invoice.id, { reason });
    } else {
      this.adminBillingFacade.markUnpaid(invoice.id, { reason });
    }

    this.actionLoading$
      .pipe(
        pairwise(),
        filter(([wasLoading, loading]) => wasLoading && !loading),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.actionConfirmModal);
        this.adminBillingFacade.loadSummary();
        this.loadInvoices();
      });
  }

  openAuditHistory(invoice: AdminInvoiceListItem): void {
    this.auditInvoiceId.set(invoice.id);
    this.adminBillingFacade.loadAuditLogs(invoice.id);
    this.showModal(this.auditHistoryModal);
  }

  downloadInvoice(invoice: AdminInvoiceListItem): void {
    if (!invoice.canDownload) return;

    this.downloadPdfBlob(
      this.invoicesFacade.downloadInvoicePdf(invoice.subscriptionId, invoice.id),
      `${invoice.invoiceNumber ?? invoice.id}.pdf`,
    );
  }

  downloadVoidDocument(invoice: AdminInvoiceListItem): void {
    if (!invoice.canDownloadVoidDocument) return;

    this.downloadPdfBlob(
      this.invoicesFacade.downloadVoidDocumentPdf(invoice.subscriptionId, invoice.id),
      `${invoice.voidDocumentNumber ?? `${invoice.invoiceNumber ?? invoice.id}-void`}.pdf`,
    );
  }

  private downloadPdfBlob(source: Observable<Blob>, filename: string): void {
    source.subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      },
    });
  }

  canMarkPaid(invoice: AdminInvoiceListItem): boolean {
    return ['issued', 'partially_paid', 'overdue'].includes(invoice.status ?? '');
  }

  canMarkUnpaid(invoice: AdminInvoiceListItem): boolean {
    return invoice.status === 'paid';
  }

  canVoid(invoice: AdminInvoiceListItem): boolean {
    return invoice.status !== 'void' && invoice.status !== 'paid';
  }

  private loadInvoices(): void {
    this.adminBillingFacade.loadOpenOverdue({
      limit: PAGE_SIZE,
      offset: this.invoicesPage() * PAGE_SIZE,
      search: this.invoiceSearch().trim() || undefined,
      userId: this.selectedUserId() ?? undefined,
    });
  }

  private loadStatistics(): void {
    const params = {
      from: this.fromDate(),
      to: this.toDate(),
      groupBy: this.groupBy(),
      userId: this.selectedUserId() ?? undefined,
    };

    this.adminBillingFacade.loadStatisticsSummary(params);
    this.adminBillingFacade.loadStatisticsByProduct(params);
  }

  private setDefaultDates(): void {
    const to = new Date();
    const from = new Date();

    from.setDate(from.getDate() - 30);
    this.toDate.set(to.toISOString().slice(0, 10));
    this.fromDate.set(from.toISOString().slice(0, 10));
  }

  private restoreFilters(): void {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);

      if (!raw) return;

      const stored = JSON.parse(raw) as AdminBillingFiltersStorage;

      if (stored.fromDate) this.fromDate.set(stored.fromDate);

      if (stored.toDate) this.toDate.set(stored.toDate);

      if (stored.groupBy) this.groupBy.set(stored.groupBy);

      if (stored.userId !== undefined) this.selectedUserId.set(stored.userId);

      if (stored.filtersCollapsed !== undefined) this.filtersCollapsed.set(stored.filtersCollapsed);
    } catch {
      // ignore invalid storage
    }
  }

  private persistFilters(): void {
    const payload: AdminBillingFiltersStorage = {
      fromDate: this.fromDate(),
      toDate: this.toDate(),
      groupBy: this.groupBy(),
      userId: this.selectedUserId(),
      filtersCollapsed: this.filtersCollapsed(),
    };

    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
  }

  private buildSeriesChart(series: BillingStatisticsSeriesPoint[]) {
    if (series.length === 0) return null;

    const axisDateFormat = this.groupBy() === 'month' ? 'mediumDate' : 'shortDate';

    return {
      series: [{ name: 'Turnover', data: series.map((p) => p.totalGross) }] as ApexAxisChartSeries,
      chart: {
        type: 'area',
        height: 280,
        toolbar: { show: false },
        background: 'transparent',
        zoom: { enabled: false },
      } as ApexChart,
      colors: [BS_CHART_COLORS[0]],
      stroke: { colors: [BS_CHART_COLORS[0]] },
      fill: { colors: [BS_CHART_COLORS[0]] },
      dataLabels: { enabled: false } as ApexDataLabels,
      xaxis: {
        categories: series.map((p) => this.datePipe.transform(p.period, axisDateFormat) ?? p.period),
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
        },
        axisBorder: { color: 'var(--bs-border-color)' },
      } as ApexXAxis,
      yaxis: {
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
          formatter: (value: number) => `${value.toFixed(2)}€`,
        },
      },
      grid: { borderColor: 'var(--bs-border-color)' },
      title: {
        text: $localize`:@@featureAdminBilling-chartTurnoverTitle:Turnover over time`,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }

  private buildDonutChart(items: { planName: string; totalGross: number }[]) {
    if (items.length === 0) return null;

    return {
      series: items.map((i) => i.totalGross) as ApexNonAxisChartSeries,
      chart: { type: 'donut', height: 280, background: 'transparent' } as ApexChart,
      labels: items.map((i) => i.planName),
      colors: BS_CHART_COLORS.slice(0, items.length),
      legend: {
        labels: { colors: 'var(--bs-body-color)' },
        fontFamily: 'var(--bs-body-font-family)',
      },
      title: {
        text: $localize`:@@featureAdminBilling-chartProductTitle:Turnover by product`,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }

  private showModal(modalElement: ElementRef<HTMLDivElement>): void {
    const instance = (
      globalThis as unknown as {
        bootstrap?: { Modal?: { getOrCreateInstance: (el: HTMLElement) => { show: () => void } } };
      }
    ).bootstrap?.Modal?.getOrCreateInstance(modalElement.nativeElement);

    instance?.show();
  }

  private hideModal(modalElement: ElementRef<HTMLDivElement>): void {
    const instance = (
      globalThis as unknown as {
        bootstrap?: { Modal?: { getInstance: (el: HTMLElement) => { hide: () => void } | null } };
      }
    ).bootstrap?.Modal?.getInstance(modalElement.nativeElement);

    instance?.hide();
  }
}
