import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AdminBillingFacade,
  AdminSubscriptionsFacade,
  MetersFacade,
  SubscriptionMetersFacade,
  isSubscriptionItemDetailEligible,
  resolveServiceDisplayLabel,
  resolveSubscriptionItemProvisioningDisplayStatus,
  type AdminSubscriptionListItem,
  type CreateUsageMeterEntryDto,
  type MeterResponse,
  type SubscriptionItemResponse,
  type SubscriptionMeterSummary,
  type UsageAttachmentType,
  type UsageMeterEntryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInfiniteScrollDirective,
  FpcListAppendFooterComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, filter, pairwise, skip } from 'rxjs';

import {
  getProvisioningStatusBadgeClass,
  getProvisioningStatusLabel,
  getSubscriptionStatusBadgeClass,
  getSubscriptionStatusLabel,
  getUnavailableLabel,
  resolveNamedLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

interface MeterEntryForm {
  meterId: string;
  value: number;
  attachmentType: UsageAttachmentType;
  addonId: string;
  periodStart: string;
  periodEnd: string;
}

interface AddonMeterOption {
  key: string;
  meterId: string;
  addonId: string;
  label: string;
}

@Component({
  selector: 'framework-admin-subscriptions-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    FpcAlertComponent,
    FpcInfiniteScrollDirective,
    FpcBadgeComponent,
    FpcListAppendFooterComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcListItemComponent,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
  ],
  providers: [DatePipe],
  templateUrl: './admin-subscriptions-page.component.html',
  styleUrls: ['./admin-subscriptions-page.component.scss'],
})
export class AdminSubscriptionsPageComponent implements OnInit {
  readonly cancelSubscriptionModalOpen = signal(false);
  readonly withdrawSubscriptionModalOpen = signal(false);
  readonly instantCancelSubscriptionModalOpen = signal(false);
  readonly resumeConfirmModalOpen = signal(false);
  readonly metersModalOpen = signal(false);
  readonly deleteEntryModalOpen = signal(false);

  readonly facade = inject(AdminSubscriptionsFacade);
  private readonly adminBillingFacade = inject(AdminBillingFacade);
  private readonly metersFacade = inject(MetersFacade);
  private readonly subscriptionMetersFacade = inject(SubscriptionMetersFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly pageTitle = $localize`:@@featureAdminSubscriptions-title:Contracts`;
  readonly searchAriaLabel = $localize`:@@featureAdminSubscriptions-search:Search contracts`;
  readonly searchPlaceholder = $localize`:@@featureAdminSubscriptions-searchPlaceholder:Search by number, email, plan, or status`;

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly subscriptions = toSignal(this.facade.subscriptions$, { initialValue: [] as AdminSubscriptionListItem[] });
  readonly billingSummary = toSignal(this.adminBillingFacade.summary$, { initialValue: null });
  readonly billingSummaryLoading$ = this.adminBillingFacade.summaryLoading$;
  readonly summaryTotalLabel = $localize`:@@featureAdminSubscriptions-summaryTotal:Contracts`;
  readonly summaryActiveLabel = $localize`:@@featureAdminSubscriptions-summaryActive:Active`;
  readonly meterSummaries = toSignal(this.subscriptionMetersFacade.summaries$, {
    initialValue: [] as SubscriptionMeterSummary[],
  });
  readonly meterEntries = toSignal(this.subscriptionMetersFacade.entries$, {
    initialValue: [] as UsageMeterEntryResponse[],
  });
  readonly activeMeters = toSignal(this.metersFacade.getActiveMeters$(), { initialValue: [] as MeterResponse[] });
  readonly loading$ = this.facade.loading$;
  readonly hasMore$ = this.facade.hasMore$;
  readonly appendLoading$ = this.facade.appendLoading$;
  readonly appendError$ = this.facade.appendError$;
  readonly canceling$ = this.facade.canceling$;
  readonly withdrawing$ = this.facade.withdrawing$;
  readonly instantCanceling$ = this.facade.instantCanceling$;
  readonly resuming$ = this.facade.resuming$;
  readonly error$ = this.facade.error$;
  readonly metersLoadingAny$ = this.subscriptionMetersFacade.loadingAny$;
  readonly metersError$ = this.subscriptionMetersFacade.error$;
  readonly creatingEntry$ = this.subscriptionMetersFacade.creating$;
  readonly deletingEntry$ = this.subscriptionMetersFacade.deleting$;

  subscriptionToCancel: AdminSubscriptionListItem | null = null;
  subscriptionToWithdraw: AdminSubscriptionListItem | null = null;
  subscriptionToInstantCancel: AdminSubscriptionListItem | null = null;
  subscriptionToResume: AdminSubscriptionListItem | null = null;
  subscriptionForMeters: AdminSubscriptionListItem | null = null;
  entryToDelete: UsageMeterEntryResponse | null = null;
  entryForm: MeterEntryForm = this.defaultEntryForm();
  selectedAddonMeterKey = '';

  ngOnInit(): void {
    this.facade.loadSubscriptions();
    this.adminBillingFacade.loadSummary();
    this.metersFacade.loadMeters();
    this.registerModalCloseWatchers();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadSubscriptions({ search: search.trim() || undefined });
      });

    this.creatingEntry$
      .pipe(
        pairwise(),
        filter(([previous, current]) => previous === true && current === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.entryForm = this.defaultEntryForm();
        this.selectedAddonMeterKey = '';
      });
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  openMetersModal(sub: AdminSubscriptionListItem): void {
    this.subscriptionForMeters = sub;
    this.entryForm = this.defaultEntryForm();
    this.selectedAddonMeterKey = '';
    this.subscriptionMetersFacade.loadAll(sub.id);
    showBillingModal(this.metersModalOpen);
  }

  submitMeterEntry(): void {
    if (!this.subscriptionForMeters || !this.entryForm.meterId || this.entryForm.value < 0) return;

    if (this.entryForm.attachmentType === 'addon' && !this.entryForm.addonId) return;

    const dto: CreateUsageMeterEntryDto = {
      meterId: this.entryForm.meterId,
      value: Number(this.entryForm.value) || 0,
      attachmentType: this.entryForm.attachmentType,
      addonId: this.entryForm.attachmentType === 'addon' ? this.entryForm.addonId : undefined,
      periodStart: new Date(this.entryForm.periodStart).toISOString(),
      periodEnd: new Date(this.entryForm.periodEnd).toISOString(),
    };

    this.subscriptionMetersFacade.createEntry(this.subscriptionForMeters.id, dto);
  }

  openDeleteEntryConfirm(entry: UsageMeterEntryResponse): void {
    this.entryToDelete = entry;
    showBillingModal(this.deleteEntryModalOpen);
  }

  confirmDeleteEntry(): void {
    if (!this.subscriptionForMeters || !this.entryToDelete) return;

    this.subscriptionMetersFacade.deleteEntry(this.subscriptionForMeters.id, this.entryToDelete.id);
  }

  subscriptionMeterSummaries(sub: AdminSubscriptionListItem): SubscriptionMeterSummary[] {
    return sub.meters ?? [];
  }

  subscriptionItems(sub: AdminSubscriptionListItem): SubscriptionItemResponse[] {
    return sub.items ?? [];
  }

  serviceDisplayLabel(item: SubscriptionItemResponse): string {
    return resolveServiceDisplayLabel(item);
  }

  isServiceDetailEligible(sub: AdminSubscriptionListItem, item: SubscriptionItemResponse): boolean {
    return isSubscriptionItemDetailEligible(item, sub.status);
  }

  itemProvisioningStatusLabel(sub: AdminSubscriptionListItem, item: SubscriptionItemResponse): string {
    return getProvisioningStatusLabel(resolveSubscriptionItemProvisioningDisplayStatus(item, sub.status));
  }

  itemProvisioningStatusBadgeClass(sub: AdminSubscriptionListItem, item: SubscriptionItemResponse): string {
    return getProvisioningStatusBadgeClass(resolveSubscriptionItemProvisioningDisplayStatus(item, sub.status));
  }

  serviceDetailLink(sub: AdminSubscriptionListItem, item: SubscriptionItemResponse): string[] {
    return ['/administration', 'subscriptions', sub.id, 'services', item.id];
  }

  hasSubscriptionMeters(sub: AdminSubscriptionListItem): boolean {
    return this.subscriptionMeterSummaries(sub).length > 0;
  }

  meterNameById(meterId: string): string {
    return resolveNamedLabel(this.activeMeters().find((meter) => meter.id === meterId)?.name);
  }

  formatMeterCharge(amount: number): string {
    return `${amount.toFixed(2)} EUR`;
  }

  formatMeterValue(summary: SubscriptionMeterSummary): string {
    const unit = summary.unitLabel ? ` ${summary.unitLabel}` : '';

    return `${summary.aggregatedValue}${unit}`;
  }

  formatMeterBillingDetails(summary: SubscriptionMeterSummary): string {
    const unit = summary.unitLabel ? ` ${summary.unitLabel}` : '';
    const parts: string[] = [];

    if (summary.effectiveIncludedUsage > 0) {
      parts.push(
        $localize`:@@featureAdminSubscriptions-meterIncludedAllowance:${summary.effectiveIncludedUsage}${unit}:value: included`,
      );
    }

    if (summary.billableValue !== summary.aggregatedValue) {
      parts.push(
        $localize`:@@featureAdminSubscriptions-meterBillableValue:${summary.billableValue}${unit}:value: billable`,
      );
    }

    return parts.join(' · ');
  }

  hasMeterBillingDetails(summary: SubscriptionMeterSummary): boolean {
    return summary.effectiveIncludedUsage > 0 || summary.billableValue !== summary.aggregatedValue;
  }

  attachmentTypeLabel(type: UsageAttachmentType): string {
    return type === 'addon'
      ? $localize`:@@featureAdminSubscriptions-attachmentAddon:Addon`
      : $localize`:@@featureAdminSubscriptions-attachmentPlan:Plan`;
  }

  availableAddonMeters(): AddonMeterOption[] {
    return this.meterSummaries()
      .filter((summary) => summary.attachmentType === 'addon' && !!summary.addonId?.trim())
      .map((summary) => {
        const addonId = summary.addonId!.trim();
        const addonName = summary.addonName?.trim();

        return {
          key: `${summary.meterId}|${addonId}`,
          meterId: summary.meterId,
          addonId,
          label: addonName ? `${summary.name} · ${addonName}` : summary.name,
        };
      });
  }

  hasAvailableAddonMeters(): boolean {
    return this.availableAddonMeters().length > 0;
  }

  onAttachmentTypeChange(): void {
    if (this.entryForm.attachmentType === 'addon' && !this.hasAvailableAddonMeters()) {
      this.entryForm.attachmentType = 'plan';
    }

    this.entryForm.meterId = '';
    this.entryForm.addonId = '';
    this.selectedAddonMeterKey = '';
  }

  onAddonMeterChange(): void {
    const selected = this.availableAddonMeters().find((option) => option.key === this.selectedAddonMeterKey);

    this.entryForm.meterId = selected?.meterId ?? '';
    this.entryForm.addonId = selected?.addonId ?? '';
  }

  openCancelConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToCancel = sub;
    showBillingModal(this.cancelSubscriptionModalOpen);
  }

  confirmCancelSubscription(): void {
    if (!this.subscriptionToCancel) return;

    this.facade.cancelSubscription(this.subscriptionToCancel.id);
  }

  openWithdrawConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToWithdraw = sub;
    showBillingModal(this.withdrawSubscriptionModalOpen);
  }

  confirmWithdrawSubscription(): void {
    if (!this.subscriptionToWithdraw) return;

    this.facade.withdrawSubscription(this.subscriptionToWithdraw.id);
  }

  canInstantCancel(sub: AdminSubscriptionListItem): boolean {
    return sub.status === 'active' || sub.status === 'pending_cancel' || sub.status === 'pending_backorder';
  }

  openInstantCancelConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToInstantCancel = sub;
    showBillingModal(this.instantCancelSubscriptionModalOpen);
  }

  confirmInstantCancelSubscription(): void {
    if (!this.subscriptionToInstantCancel) return;

    this.facade.instantCancelSubscription(this.subscriptionToInstantCancel.id);
  }

  openResumeConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToResume = sub;
    showBillingModal(this.resumeConfirmModalOpen);
  }

  confirmResume(): void {
    if (!this.subscriptionToResume) return;

    this.facade.resumeSubscription(this.subscriptionToResume.id);
  }

  subscriptionTitle(sub: AdminSubscriptionListItem): string {
    return resolveNamedLabel(sub.planName);
  }

  subscriptionUserLabel(sub: AdminSubscriptionListItem): string {
    const email = sub.userEmail?.trim();

    if (email) return email;

    return getUnavailableLabel();
  }

  subscriptionStatusLabel(status: string | null | undefined): string {
    return getSubscriptionStatusLabel(status);
  }

  subscriptionStatusBadgeClass(status: string | null | undefined): string {
    return getSubscriptionStatusBadgeClass(status);
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return '-';

    return this.datePipe.transform(value, 'shortDate') ?? '-';
  }

  formatDateTime(value: string | null | undefined): string {
    if (!value) return '-';

    return this.datePipe.transform(value, 'short') ?? '-';
  }

  formatSubscriptionPeriod(sub: AdminSubscriptionListItem): string {
    if (!sub.currentPeriodStart || !sub.currentPeriodEnd) return '-';

    return `${this.formatDate(sub.currentPeriodStart)} to ${this.formatDate(sub.currentPeriodEnd)}`;
  }

  formatPeriodPrice(sub: AdminSubscriptionListItem): string {
    if (sub.periodTotalPrice == null) return '-';

    return `${sub.periodTotalPrice.toFixed(2)} EUR`;
  }

  formatCurrencyAmount(amount: number): string {
    return `${amount.toFixed(2)} EUR`;
  }

  private defaultEntryForm(): MeterEntryForm {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return {
      meterId: '',
      value: 0,
      attachmentType: 'plan',
      addonId: '',
      periodStart: this.toDateTimeLocal(start),
      periodEnd: this.toDateTimeLocal(end),
    };
  }

  private toDateTimeLocal(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.canceling$,
      error$: this.error$,
      open: this.cancelSubscriptionModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToCancel = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.withdrawing$,
      error$: this.error$,
      open: this.withdrawSubscriptionModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToWithdraw = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.instantCanceling$,
      error$: this.error$,
      open: this.instantCancelSubscriptionModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToInstantCancel = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.resuming$,
      error$: this.error$,
      open: this.resumeConfirmModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToResume = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.deletingEntry$,
      error$: this.metersError$,
      open: this.deleteEntryModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.entryToDelete = null;
      },
    });
  }
}
