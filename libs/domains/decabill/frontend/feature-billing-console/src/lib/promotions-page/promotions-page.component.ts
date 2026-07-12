import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  PromotionsFacade,
  ServicePlansFacade,
  SubscriptionsFacade,
  type PromotionRedemptionResponse,
  type ValidatePromotionRequest,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { map, switchMap } from 'rxjs';

import {
  getBillingIntervalLabel,
  getPromotionRedemptionContextLabel,
  getPromotionRedemptionStatusIconClass,
  getPromotionRedemptionStatusLabel,
  getPromotionRedemptionStatusTextClass,
  getSubscriptionStatusLabel,
} from '../billing-status-labels';
import { filterItemsBySearch } from '../billing-list-search';
import { buildPromotionPeriodPricingPreview } from '../promotion-pricing-preview.util';

const PROMOTION_ELIGIBLE_SUBSCRIPTION_STATUSES = new Set(['active', 'pending_backorder', 'pending_cancel']);

type PromotionsMobilePanel = 'active' | 'history';

const PROMOTIONS_MOBILE_PANELS: PromotionsMobilePanel[] = ['active', 'history'];

@Component({
  selector: 'framework-billing-promotions-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [DatePipe],
  templateUrl: './promotions-page.component.html',
  styleUrls: ['./promotions-page.component.scss'],
})
export class PromotionsPageComponent implements OnInit {
  private readonly promotionsFacade = inject(PromotionsFacade);
  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly datePipe = inject(DatePipe);

  promoCode = signal('');
  selectedSubscriptionId = signal('');
  readonly activeSearch = signal('');
  readonly historySearch = signal('');
  readonly mobilePanel = signal<PromotionsMobilePanel>('active');
  readonly mobilePanels = PROMOTIONS_MOBILE_PANELS;

  readonly activePromotions = toSignal(this.promotionsFacade.getActivePromotions$(), { initialValue: [] });
  readonly redemptions = toSignal(this.promotionsFacade.getRedemptions$(), { initialValue: [] });
  readonly filteredActivePromotions = computed(() =>
    filterItemsBySearch(this.activePromotions(), this.activeSearch(), (item) =>
      [item.promotionName, item.code, item.advantageSummary, item.planName, item.validFrom, item.validTo]
        .filter(Boolean)
        .join(' '),
    ),
  );
  readonly filteredRedemptions = computed(() =>
    filterItemsBySearch(this.redemptions(), this.historySearch(), (item) =>
      [
        item.code,
        item.promotionName,
        item.advantageSummary,
        item.subscriptionNumber,
        item.subscriptionId,
        item.planName,
        this.redemptionContextLabel(item.redemptionContext),
        this.redemptionStatusLabel(item.status),
        item.redeemedAt,
      ]
        .filter(Boolean)
        .join(' '),
    ),
  );
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

  private readonly eligibleSubscriptions = toSignal(this.eligibleSubscriptions$, { initialValue: [] });

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

  ngOnInit(): void {
    this.promotionsFacade.loadActivePromotions();
    this.promotionsFacade.loadRedemptions();
    this.subscriptionsFacade.loadSubscriptions();
    this.servicePlansFacade.loadServicePlans();
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

  subscriptionStatusLabel(status: string | null | undefined): string {
    return getSubscriptionStatusLabel(status);
  }

  redemptionContextLabel(context: PromotionRedemptionResponse['redemptionContext']): string {
    return getPromotionRedemptionContextLabel(context);
  }

  redemptionStatusLabel(status: PromotionRedemptionResponse['status']): string {
    return getPromotionRedemptionStatusLabel(status);
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
