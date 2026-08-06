import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminSubscriptionsFacade,
  MetersFacade,
  SubscriptionMetersFacade,
  type AdminSubscriptionListItem,
  type CreateUsageMeterEntryDto,
  type MeterResponse,
  type SubscriptionMeterSummary,
  type UsageAttachmentType,
  type UsageMeterEntryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { debounceTime, distinctUntilChanged, filter, pairwise, skip } from 'rxjs';

import {
  getSubscriptionStatusBadgeClass,
  getSubscriptionStatusLabel,
  getUnavailableLabel,
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

@Component({
  selector: 'framework-admin-subscriptions-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [DatePipe],
  templateUrl: './admin-subscriptions-page.component.html',
  styleUrls: ['./admin-subscriptions-page.component.scss'],
})
export class AdminSubscriptionsPageComponent implements OnInit {
  @ViewChild('cancelSubscriptionModal', { static: false }) private cancelSubscriptionModal!: ElementRef<HTMLDivElement>;
  @ViewChild('withdrawSubscriptionModal', { static: false })
  private withdrawSubscriptionModal!: ElementRef<HTMLDivElement>;
  @ViewChild('instantCancelSubscriptionModal', { static: false })
  private instantCancelSubscriptionModal!: ElementRef<HTMLDivElement>;
  @ViewChild('resumeConfirmModal', { static: false }) private resumeConfirmModal!: ElementRef<HTMLDivElement>;
  @ViewChild('metersModal', { static: false }) private metersModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteEntryModal', { static: false }) private deleteEntryModal!: ElementRef<HTMLDivElement>;

  private readonly facade = inject(AdminSubscriptionsFacade);
  private readonly metersFacade = inject(MetersFacade);
  private readonly subscriptionMetersFacade = inject(SubscriptionMetersFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly subscriptions = toSignal(this.facade.subscriptions$, { initialValue: [] as AdminSubscriptionListItem[] });
  readonly meterSummaries = toSignal(this.subscriptionMetersFacade.summaries$, {
    initialValue: [] as SubscriptionMeterSummary[],
  });
  readonly meterEntries = toSignal(this.subscriptionMetersFacade.entries$, {
    initialValue: [] as UsageMeterEntryResponse[],
  });
  readonly activeMeters = toSignal(this.metersFacade.getActiveMeters$(), { initialValue: [] as MeterResponse[] });
  readonly loading$ = this.facade.loading$;
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

  readonly activeCount = () => this.subscriptions().filter((sub) => sub.status === 'active').length;

  ngOnInit(): void {
    this.facade.loadSubscriptions();
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
      });
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  openMetersModal(sub: AdminSubscriptionListItem): void {
    this.subscriptionForMeters = sub;
    this.entryForm = this.defaultEntryForm();
    this.subscriptionMetersFacade.loadAll(sub.id);
    showBillingModal(this.metersModal);
  }

  submitMeterEntry(): void {
    if (!this.subscriptionForMeters || !this.entryForm.meterId || this.entryForm.value < 0) return;

    const dto: CreateUsageMeterEntryDto = {
      meterId: this.entryForm.meterId,
      value: Number(this.entryForm.value) || 0,
      attachmentType: this.entryForm.attachmentType,
      addonId: this.entryForm.attachmentType === 'addon' ? this.entryForm.addonId || undefined : undefined,
      periodStart: new Date(this.entryForm.periodStart).toISOString(),
      periodEnd: new Date(this.entryForm.periodEnd).toISOString(),
    };

    this.subscriptionMetersFacade.createEntry(this.subscriptionForMeters.id, dto);
  }

  openDeleteEntryConfirm(entry: UsageMeterEntryResponse): void {
    this.entryToDelete = entry;
    showBillingModal(this.deleteEntryModal);
  }

  confirmDeleteEntry(): void {
    if (!this.subscriptionForMeters || !this.entryToDelete) return;

    this.subscriptionMetersFacade.deleteEntry(this.subscriptionForMeters.id, this.entryToDelete.id);
  }

  subscriptionMeterSummaries(sub: AdminSubscriptionListItem): SubscriptionMeterSummary[] {
    return sub.meters ?? [];
  }

  hasSubscriptionMeters(sub: AdminSubscriptionListItem): boolean {
    return this.subscriptionMeterSummaries(sub).length > 0;
  }

  meterNameById(meterId: string): string {
    return this.activeMeters().find((meter) => meter.id === meterId)?.name ?? meterId;
  }

  formatMeterCharge(amount: number): string {
    return `${amount.toFixed(2)} EUR`;
  }

  formatMeterValue(summary: SubscriptionMeterSummary): string {
    const unit = summary.unitLabel ? ` ${summary.unitLabel}` : '';

    return `${summary.aggregatedValue}${unit}`;
  }

  attachmentTypeLabel(type: UsageAttachmentType): string {
    return type === 'addon'
      ? $localize`:@@featureAdminSubscriptions-attachmentAddon:Addon`
      : $localize`:@@featureAdminSubscriptions-attachmentPlan:Plan`;
  }

  openCancelConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToCancel = sub;
    showBillingModal(this.cancelSubscriptionModal);
  }

  confirmCancelSubscription(): void {
    if (!this.subscriptionToCancel) return;

    this.facade.cancelSubscription(this.subscriptionToCancel.id);
  }

  openWithdrawConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToWithdraw = sub;
    showBillingModal(this.withdrawSubscriptionModal);
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
    showBillingModal(this.instantCancelSubscriptionModal);
  }

  confirmInstantCancelSubscription(): void {
    if (!this.subscriptionToInstantCancel) return;

    this.facade.instantCancelSubscription(this.subscriptionToInstantCancel.id);
  }

  openResumeConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToResume = sub;
    showBillingModal(this.resumeConfirmModal);
  }

  confirmResume(): void {
    if (!this.subscriptionToResume) return;

    this.facade.resumeSubscription(this.subscriptionToResume.id);
  }

  subscriptionTitle(sub: AdminSubscriptionListItem): string {
    return sub.planName?.trim() || sub.planId;
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
      modal: () => this.cancelSubscriptionModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToCancel = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.withdrawing$,
      error$: this.error$,
      modal: () => this.withdrawSubscriptionModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToWithdraw = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.instantCanceling$,
      error$: this.error$,
      modal: () => this.instantCancelSubscriptionModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToInstantCancel = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.resuming$,
      error$: this.error$,
      modal: () => this.resumeConfirmModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToResume = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.deletingEntry$,
      error$: this.metersError$,
      modal: () => this.deleteEntryModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.entryToDelete = null;
      },
    });
  }
}
