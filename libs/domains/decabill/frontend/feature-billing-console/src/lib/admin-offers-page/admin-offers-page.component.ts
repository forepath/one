import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminOffersFacade,
  AdminOffersService,
  fillPeriodSeriesPoints,
  type AdminOfferListItem,
  type BillingAuditLogResponse,
  type CreateAdminOfferDto,
  type OfferStatisticsSeriesPoint,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexLegend,
  ApexStroke,
  ApexTitleSubtitle,
  ApexXAxis,
  ApexYAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import { debounceTime, distinctUntilChanged, of, skip, switchMap } from 'rxjs';

import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import { getOfferStatusBadgeClass, getOfferStatusLabel, getUnavailableLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { PricingTotalsSummaryComponent } from '../pricing-totals-summary/pricing-totals-summary.component';
import { AdminOfferLineEditorComponent } from './admin-offer-line-editor.component';
import {
  createEmptyOfferFormLine,
  isOfferFormValid,
  mapOfferDetailLinesToForm,
  mapOfferFormLinesToDto,
  type OfferFormLineItem,
} from './admin-offer-form.util';

const BS_CHART_COLORS = ['var(--bs-primary)', 'var(--bs-success)', 'var(--bs-danger)'] as const;

type AdminOffersMobilePanel = 'overview' | 'offers';

@Component({
  selector: 'framework-admin-offers-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgApexchartsModule,
    BillingAdminUserSelectComponent,
    AdminOfferLineEditorComponent,
    PricingTotalsSummaryComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormCheckComponent,
    FpcListItemComponent,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcConfirmDialogComponent,
    FpcLaneHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcSearchFieldComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  providers: [DatePipe],
  templateUrl: './admin-offers-page.component.html',
  styleUrls: ['./admin-offers-page.component.scss'],
})
export class AdminOffersPageComponent implements OnInit {
  @ViewChild('createOfferUserSelect', { static: false })
  private createOfferUserSelect?: BillingAdminUserSelectComponent;
  @ViewChild('createLineEditor', { static: false })
  createLineEditor?: AdminOfferLineEditorComponent;
  @ViewChild('editLineEditor', { static: false })
  editLineEditor?: AdminOfferLineEditorComponent;

  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  readonly auditHistoryModalOpen = signal(false);

  private readonly facade = inject(AdminOffersFacade);
  private readonly adminOffersService = inject(AdminOffersService);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly mobilePanel = signal<AdminOffersMobilePanel>('overview');
  readonly filtersCollapsed = signal(true);
  readonly filtersPanelTitle = $localize`:@@featureAdminOffers-filters:Filters`;
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<'day' | 'month'>('day');
  filterUserId = '';
  readonly pageTitle = $localize`:@@featureAdminOffers-title:Offers`;
  readonly createOfferAriaLabel = $localize`:@@featureAdminOffers-create:Create offer`;

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly auditOfferId = signal<string | null>(null);

  readonly offers$ = this.facade.offers$;
  readonly loading$ = this.facade.loading$;
  readonly mutating$ = this.facade.mutating$;
  readonly error$ = this.facade.error$;
  readonly statistics$ = this.facade.statistics$;
  readonly statisticsLoading$ = this.facade.statisticsLoading$;
  readonly draftCountLabel = $localize`:@@featureAdminOffers-draftCount:Draft`;
  readonly pendingCountLabel = $localize`:@@featureAdminOffers-pendingCount:Pending`;
  readonly acceptedCountLabel = $localize`:@@featureAdminOffers-acceptedCount:Accepted`;
  readonly pendingGrossLabel = $localize`:@@featureAdminOffers-pendingGross:Pending gross`;
  readonly statisticsError$ = this.facade.statisticsError$;
  readonly auditLogsLoading$ = this.facade.auditLogsLoading$;
  readonly auditLogsAppendLoading$ = this.facade.auditLogsAppendLoading$;
  readonly auditLogsError$ = this.facade.auditLogsError$;
  readonly auditLogsOffsetByOffer$ = this.facade.auditLogsOffsetByOffer$;

  readonly statistics = toSignal(this.statistics$, { initialValue: null });
  readonly offers = toSignal(this.offers$, { initialValue: [] as AdminOfferListItem[] });
  readonly auditLogsOffsetByOffer = toSignal(this.auditLogsOffsetByOffer$, {
    initialValue: {} as Record<string, number>,
  });

  readonly selectedAuditLogs = toSignal(
    toObservable(this.auditOfferId).pipe(
      switchMap((offerId) => (offerId ? this.facade.getAuditLogsForOffer$(offerId) : of([]))),
    ),
    { initialValue: [] as BillingAuditLogResponse[] },
  );

  readonly auditLogsHasMore = toSignal(
    toObservable(this.auditOfferId).pipe(
      switchMap((offerId) => (offerId ? this.facade.getAuditLogsHasMore$(offerId) : of(false))),
    ),
    { initialValue: false },
  );

  readonly seriesChartOptions = computed(() => this.buildSeriesChart(this.statistics()?.series ?? []));

  createForm: CreateAdminOfferDto = this.emptyForm();
  createUserId = '';
  createLineItems: OfferFormLineItem[] = [createEmptyOfferFormLine()];
  editForm: CreateAdminOfferDto & { id: string } = { ...this.emptyForm(), id: '' };
  editLineItems: OfferFormLineItem[] = [createEmptyOfferFormLine()];
  editDetailLoading = false;
  selectedOffer: AdminOfferListItem | null = null;

  ngOnInit(): void {
    this.setDefaultDates();
    this.facade.loadOffers();
    this.loadStatistics();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadOffers({
          search: search.trim() || undefined,
          userId: this.filterUserId.trim() || undefined,
        });
      });

    watchBillingMutationModalClose({
      loading$: this.facade.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = this.emptyForm();
        this.createLineItems = [createEmptyOfferFormLine()];
      },
    });
    watchBillingMutationModalClose({
      loading$: this.facade.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.facade.deleting$,
      error$: this.error$,
      open: this.deleteModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.selectedOffer = null;
      },
    });
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersCollapsed.set(!open);
  }

  onApplyFilters(): void {
    this.filtersCollapsed.set(true);
    this.loadStatistics();
    this.facade.loadOffers({
      search: this.searchQuery().trim() || undefined,
      userId: this.filterUserId.trim() || undefined,
    });
  }

  onResetFilters(): void {
    this.setDefaultDates();
    this.groupBy.set('day');
    this.filterUserId = '';
    this.onApplyFilters();
  }

  openCreateModal(): void {
    this.createForm = this.emptyForm();
    this.createUserId = '';
    this.createLineItems = [createEmptyOfferFormLine()];
    showBillingModal(this.createModalOpen);
    queueMicrotask(() => this.createOfferUserSelect?.reset());
  }

  openEditModal(offer: AdminOfferListItem): void {
    this.editDetailLoading = true;
    this.editForm = {
      id: offer.id,
      userId: offer.userId,
      currency: offer.currency,
      expiresAt: offer.expiresAt?.slice(0, 16) ?? '',
      billToOpenPositions: false,
      lineItems: [],
    };
    this.editLineItems = [createEmptyOfferFormLine()];
    showBillingModal(this.editModalOpen);

    this.adminOffersService
      .get(offer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.editForm = {
            id: detail.id,
            userId: detail.userId,
            currency: detail.currency,
            expiresAt: detail.expiresAt ? detail.expiresAt.slice(0, 16) : '',
            billToOpenPositions: detail.billToOpenPositions,
            lineItems: [],
          };
          this.editLineItems =
            detail.lineItems.length > 0 ? mapOfferDetailLinesToForm(detail.lineItems) : [createEmptyOfferFormLine()];
          this.editDetailLoading = false;
        },
        error: () => {
          this.editDetailLoading = false;
        },
      });
  }

  openDeleteModal(offer: AdminOfferListItem): void {
    this.selectedOffer = offer;
    showBillingModal(this.deleteModalOpen);
  }

  openAuditHistory(offer: AdminOfferListItem): void {
    this.auditOfferId.set(offer.id);
    this.facade.loadAuditLogs(offer.id);
    showBillingModal(this.auditHistoryModalOpen);
  }

  loadMoreAuditLogs(): void {
    const offerId = this.auditOfferId();

    if (!offerId) return;

    const offset = this.auditLogsOffsetByOffer()[offerId] ?? 0;

    this.facade.loadMoreAuditLogs(offerId, offset);
  }

  submitCreate(): void {
    if (!this.createUserId || !isOfferFormValid(this.createLineItems)) {
      return;
    }

    this.facade.createOffer({
      userId: this.createUserId,
      expiresAt: this.createForm.expiresAt || undefined,
      billToOpenPositions: this.createForm.billToOpenPositions,
      lineItems: mapOfferFormLinesToDto(this.createLineItems),
    });
  }

  submitEdit(): void {
    if (!isOfferFormValid(this.editLineItems)) {
      return;
    }

    this.facade.updateOffer(this.editForm.id, {
      userId: this.editForm.userId,
      expiresAt: this.editForm.expiresAt || undefined,
      billToOpenPositions: this.editForm.billToOpenPositions,
      lineItems: mapOfferFormLinesToDto(this.editLineItems),
    });
  }

  canSubmitCreate(): boolean {
    return Boolean(this.createUserId) && isOfferFormValid(this.createLineItems);
  }

  canSubmitEdit(): boolean {
    return isOfferFormValid(this.editLineItems) && !this.editDetailLoading;
  }

  confirmDelete(): void {
    if (!this.selectedOffer) return;

    this.facade.deleteOffer(this.selectedOffer.id);
  }

  archiveOffer(offer: AdminOfferListItem): void {
    this.facade.archiveOffer(offer.id);
  }

  revokeOffer(offer: AdminOfferListItem): void {
    this.facade.revokeOffer(offer.id);
  }

  offerStatusLabel(status: string | null | undefined): string {
    return getOfferStatusLabel(status);
  }

  offerStatusBadgeClass(status: string | null | undefined): string {
    return getOfferStatusBadgeClass(status);
  }

  formatDate(value?: string | null): string {
    if (!value) return getUnavailableLabel();

    return this.datePipe.transform(value, 'medium') ?? value;
  }

  onMobilePanelTabChange(tabId: string | null): void {
    if (tabId === 'overview' || tabId === 'offers') {
      this.mobilePanel.set(tabId);
    }
  }

  mobilePanelLabel(panel: AdminOffersMobilePanel): string {
    return panel === 'overview'
      ? $localize`:@@featureAdminOffers-mobileOverview:Overview`
      : $localize`:@@featureAdminOffers-mobileOffers:Offers`;
  }

  canEditOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'draft';
  }

  canDeleteOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'draft';
  }

  canArchiveOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'draft';
  }

  canRevokeOffer(offer: AdminOfferListItem): boolean {
    return offer.status === 'archived';
  }

  private loadStatistics(): void {
    this.facade.loadStatistics({
      from: this.fromDate(),
      to: this.toDate(),
      groupBy: this.groupBy(),
      userId: this.filterUserId.trim() || undefined,
    });
  }

  private setDefaultDates(): void {
    const to = new Date();
    const from = new Date(to);

    from.setDate(from.getDate() - 30);
    this.toDate.set(to.toISOString().slice(0, 10));
    this.fromDate.set(from.toISOString().slice(0, 10));
  }

  private emptyForm(): CreateAdminOfferDto {
    return {
      userId: '',
      billToOpenPositions: false,
      lineItems: [],
    };
  }

  private buildSeriesChart(series: OfferStatisticsSeriesPoint[]) {
    const filled = fillPeriodSeriesPoints(series, this.fromDate(), this.toDate(), this.groupBy(), (period) => ({
      period,
      archivedCount: 0,
      acceptedCount: 0,
      declinedCount: 0,
    }));

    if (filled.length === 0) {
      return null;
    }

    return {
      series: [
        { name: $localize`:@@featureAdminOffers-chartArchived:Archived`, data: filled.map((p) => p.archivedCount) },
        { name: $localize`:@@featureAdminOffers-chartAccepted:Accepted`, data: filled.map((p) => p.acceptedCount) },
        { name: $localize`:@@featureAdminOffers-chartDeclined:Declined`, data: filled.map((p) => p.declinedCount) },
      ] as ApexAxisChartSeries,
      chart: {
        type: 'area',
        height: 240,
        toolbar: { show: false },
        background: 'transparent',
        zoom: { enabled: false },
      } as ApexChart,
      colors: [...BS_CHART_COLORS],
      stroke: { width: 2 } as ApexStroke,
      dataLabels: { enabled: false } as ApexDataLabels,
      legend: { position: 'top' } as ApexLegend,
      xaxis: {
        type: 'category',
        categories: filled.map((p) => this.formatChartPeriodLabel(p.period)),
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
        },
        axisBorder: { color: 'var(--bs-border-color)' },
      } as ApexXAxis,
      yaxis: {
        labels: {
          style: { colors: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
        },
      } as ApexYAxis,
      grid: { borderColor: 'var(--bs-border-color)' },
      title: {
        text: $localize`:@@featureAdminOffers-chartTitle:Offer activity over time`,
        style: { color: 'var(--bs-body-color)', fontFamily: 'var(--bs-body-font-family)' },
      } as ApexTitleSubtitle,
    };
  }

  private formatChartPeriodLabel(period: string): string {
    const format = this.groupBy() === 'month' ? 'MMM y' : 'mediumDate';

    return this.datePipe.transform(`${period}T12:00:00.000Z`, format, 'UTC') ?? period;
  }
}
