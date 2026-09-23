import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  PromotionsFacade,
  ServicePlansFacade,
  SubscriptionsFacade,
  type PromotionRedemptionResponse,
  type ValidatePromotionRequest,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBoardLaneComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, map, skip, switchMap } from 'rxjs';

import {
  getBillingIntervalLabel,
  getPromotionRedemptionContextLabel,
  getPromotionRedemptionStatusIconClass,
  getPromotionRedemptionStatusLabel,
  getPromotionRedemptionStatusTextClass,
  resolveNamedLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { BillingSubscriptionSelectComponent } from '../billing-subscription-select/billing-subscription-select.component';
import { buildPromotionPeriodPricingPreview } from '../promotion-pricing-preview.util';

const PROMOTION_ELIGIBLE_SUBSCRIPTION_STATUSES = new Set(['active', 'pending_backorder', 'pending_cancel']);

type PromotionsMobilePanel = 'active' | 'history';

@Component({
  selector: 'framework-billing-promotions-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcPageHeaderComponent,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListItemComponent,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcBoardLaneComponent,
    FpcLaneHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    BillingSubscriptionSelectComponent,
  ],
  providers: [DatePipe],
  templateUrl: './promotions-page.component.html',
  styleUrls: ['./promotions-page.component.scss'],
})
export class PromotionsPageComponent implements OnInit {
  private readonly promotionsFacade = inject(PromotionsFacade);
  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featurePromotions-pageTitle:Promotions`;
  readonly applyPromoAriaLabel = $localize`:@@featurePromotions-applyCode:Apply a promotion code`;

  readonly applyModalOpen = signal(false);
  promoCode = signal('');
  selectedSubscriptionId = signal('');
  readonly activeSearch = signal('');
  readonly historySearch = signal('');
  readonly activeSearch$ = toObservable(this.activeSearch);
  readonly historySearch$ = toObservable(this.historySearch);
  readonly mobilePanel = signal<PromotionsMobilePanel>('active');

  readonly activePromotions = toSignal(this.promotionsFacade.getActivePromotions$(), { initialValue: [] });
  readonly redemptions = toSignal(this.promotionsFacade.getRedemptions$(), { initialValue: [] });
  readonly loadingActive$ = this.promotionsFacade.getActiveLoading$();
  readonly loadingRedemptions$ = this.promotionsFacade.getRedemptionsLoading$();
  readonly validationPreview = toSignal(this.promotionsFacade.getValidationPreview$('existing'), {
    initialValue: null,
  });
  readonly validationLoading$ = this.promotionsFacade.getValidationLoading$('existing');
  readonly validationError = toSignal(this.promotionsFacade.getValidationError$('existing'), { initialValue: null });
  readonly redeeming$ = this.promotionsFacade.getRedeeming$();
  readonly redeemError$ = this.promotionsFacade.getRedeemError$();
  readonly servicePlans = toSignal(this.servicePlansFacade.getServicePlans$(), { initialValue: [] });
  readonly eligibleSubscriptions$ = this.subscriptionsFacade
    .getSubscriptions$()
    .pipe(
      map((subscriptions) =>
        subscriptions.filter((subscription) => PROMOTION_ELIGIBLE_SUBSCRIPTION_STATUSES.has(subscription.status)),
      ),
    );

  readonly eligibleSubscriptions = toSignal(this.eligibleSubscriptions$, { initialValue: [] });

  readonly selectedSubscription = computed(
    () =>
      this.eligibleSubscriptions().find((subscription) => subscription.id === this.selectedSubscriptionId()) ?? null,
  );

  readonly selectedPlan = computed(() => {
    const subscription = this.selectedSubscription();

    if (!subscription) return null;

    return this.servicePlans().find((plan) => plan.id === subscription.planId) ?? null;
  });

  readonly hasPromotionCheckResult = computed(() => this.validationPreview() != null || this.validationError() != null);

  readonly promotionSimulationLocked = computed(() => {
    const preview = this.validationPreview();

    return Boolean(preview?.valid && this.promoCode().trim());
  });

  readonly promotionPeriodPricing = computed(() => {
    const preview = this.validationPreview();
    const subscription = this.selectedSubscription();
    const plan = this.selectedPlan();

    if (!preview?.valid || subscription?.periodTotalPrice == null) return null;

    return buildPromotionPeriodPricingPreview(preview, subscription.periodTotalPrice, {
      benefitEndsLabel: preview.benefitEndsAt ? this.formatDate(preview.benefitEndsAt) : undefined,
      billing: plan
        ? {
            billingIntervalType: plan.billingIntervalType,
            billingIntervalValue: plan.billingIntervalValue,
            billingDayOfMonth: plan.billingDayOfMonth,
          }
        : undefined,
      periodStart: preview.chargePeriodStart
        ? new Date(preview.chargePeriodStart)
        : preview.benefitStartsAt
          ? new Date(preview.benefitStartsAt)
          : undefined,
      periodEnd: preview.chargePeriodEnd ? new Date(preview.chargePeriodEnd) : undefined,
    });
  });

  private readonly validateRequest = computed<ValidatePromotionRequest | null>(() => {
    const code = this.promoCode().trim();
    const subscriptionId = this.selectedSubscriptionId().trim();

    if (!code || !subscriptionId) return null;

    const isEligible = this.eligibleSubscriptions().some((subscription) => subscription.id === subscriptionId);

    if (!isEligible) return null;

    return {
      code,
      redemptionContext: 'existing',
      subscriptionId,
    };
  });

  readonly canRedeem$ = toObservable(this.validateRequest).pipe(
    switchMap((request) => this.promotionsFacade.canRedeem$(request)),
  );

  readonly canRedeem = toSignal(this.canRedeem$, { initialValue: false });

  constructor() {
    watchBillingMutationModalClose({
      loading$: this.redeeming$,
      error$: this.redeemError$,
      open: this.applyModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetApplyForm(),
    });
  }

  ngOnInit(): void {
    this.promotionsFacade.loadActivePromotions();
    this.promotionsFacade.loadRedemptions();
    this.subscriptionsFacade.loadSubscriptions();
    this.servicePlansFacade.loadServicePlans();

    this.activeSearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.promotionsFacade.loadActivePromotions({ search: search.trim() || undefined });
      });

    this.historySearch$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.promotionsFacade.loadRedemptions({ search: search.trim() || undefined });
      });
  }

  openApplyModal(): void {
    this.resetApplyForm();
    showBillingModal(this.applyModalOpen);
  }

  onApplyModalClosed(): void {
    this.resetApplyForm();
  }

  onPromoInputChange(): void {
    this.promotionsFacade.clearValidation();
  }

  onSubscriptionChange(): void {
    this.promotionsFacade.clearValidation();
  }

  clearPromotionCheck(): void {
    this.promotionsFacade.clearValidation();
    this.promoCode.set('');
  }

  checkCode(): void {
    const request = this.validateRequest();

    if (!request) return;

    this.promotionsFacade.validatePromotion(request);
  }

  redeemNow(): void {
    const request = this.validateRequest();

    if (!request?.subscriptionId || !this.canRedeem()) return;

    this.promotionsFacade.redeemPromotion({
      code: request.code,
      redemptionContext: 'existing',
      subscriptionId: request.subscriptionId,
      benefitStartsAt: this.validationPreview()?.benefitStartsAt,
    });
  }

  private resetApplyForm(): void {
    this.promoCode.set('');
    this.selectedSubscriptionId.set('');
    this.promotionsFacade.clearValidation();
  }

  onMobilePanelTabChange(tabId: string | null): void {
    if (tabId === 'active' || tabId === 'history') {
      this.mobilePanel.set(tabId);
    }
  }

  mobilePanelLabel(panel: PromotionsMobilePanel): string {
    switch (panel) {
      case 'active':
        return $localize`:@@featurePromotions-mobileActive:Active promotions`;
      case 'history':
        return $localize`:@@featurePromotions-mobileHistory:History`;
      default:
        return panel;
    }
  }

  redemptionContextLabel(context: PromotionRedemptionResponse['redemptionContext']): string {
    return getPromotionRedemptionContextLabel(context);
  }

  redemptionStatusLabel(status: PromotionRedemptionResponse['status']): string {
    return getPromotionRedemptionStatusLabel(status);
  }

  redemptionSubscriptionLabel(item: PromotionRedemptionResponse): string {
    return resolveNamedLabel(item.subscriptionNumber);
  }

  redemptionStatusTextClass(status: PromotionRedemptionResponse['status']): string {
    return getPromotionRedemptionStatusTextClass(status);
  }

  redemptionStatusIconClass(status: PromotionRedemptionResponse['status']): string {
    return getPromotionRedemptionStatusIconClass(status);
  }

  formatCurrencyAmount(amount: number): string {
    return `€${Number.isInteger(amount) ? String(amount) : amount.toFixed(2)}`;
  }

  formatPeriodPrice(amount: number): string {
    const plan = this.selectedPlan();
    const price = this.formatCurrencyAmount(amount);

    if (!plan) return price;

    return `${price} / ${getBillingIntervalLabel(plan.billingIntervalValue, plan.billingIntervalType)}`;
  }

  formatDate(value?: string): string {
    if (!value) return '-';

    return this.datePipe.transform(value, 'mediumDate') ?? value;
  }

  formatDateTime(value?: string): string {
    if (!value) return '-';

    return this.datePipe.transform(value, 'medium') ?? value;
  }

  trackRedemption(_index: number, item: PromotionRedemptionResponse): string {
    return item.id;
  }
}
