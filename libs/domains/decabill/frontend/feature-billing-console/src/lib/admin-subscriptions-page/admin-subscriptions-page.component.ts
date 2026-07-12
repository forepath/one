import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminSubscriptionsFacade,
  type AdminSubscriptionListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';

import {
  getSubscriptionStatusBadgeClass,
  getSubscriptionStatusLabel,
  getUnavailableLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

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
  @ViewChild('resumeConfirmModal', { static: false }) private resumeConfirmModal!: ElementRef<HTMLDivElement>;

  private readonly facade = inject(AdminSubscriptionsFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly subscriptions = toSignal(this.facade.subscriptions$, { initialValue: [] as AdminSubscriptionListItem[] });
  readonly loading$ = this.facade.loading$;
  readonly canceling$ = this.facade.canceling$;
  readonly withdrawing$ = this.facade.withdrawing$;
  readonly resuming$ = this.facade.resuming$;
  readonly error$ = this.facade.error$;

  subscriptionToCancel: AdminSubscriptionListItem | null = null;
  subscriptionToWithdraw: AdminSubscriptionListItem | null = null;
  subscriptionToResume: AdminSubscriptionListItem | null = null;

  readonly activeCount = () => this.subscriptions().filter((sub) => sub.status === 'active').length;

  ngOnInit(): void {
    this.facade.loadSubscriptions();
    this.registerModalCloseWatchers();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadSubscriptions({ search: search.trim() || undefined });
      });
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
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
      loading$: this.resuming$,
      error$: this.error$,
      modal: () => this.resumeConfirmModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToResume = null;
      },
    });
  }
}
