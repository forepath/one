import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  PromotionsFacade,
  ServicePlansFacade,
  SubscriptionsFacade,
  type PromotionRedemptionResponse,
  type ValidatePromotionRequest,
  type PromotionValidationResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { map, switchMap } from 'rxjs';

import {
  getBillingIntervalLabel,
  getPromotionAdvantageText,
  getPromotionRedemptionContextLabel,
  resolveNamedLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { BillingSubscriptionSelectComponent } from '../billing-subscription-select/billing-subscription-select.component';
import { buildPromotionPeriodPricingPreview } from '../promotion-pricing-preview.util';
import { dbServerPaging } from '../shared/server-paging';
import { redemptionState } from '../shared/table-states';
import {
  formatBillingDate,
  formatBillingDateRange,
  formatBillingDateTime,
  formatBillingMoney,
} from '../billing-format';

const PROMOTION_ELIGIBLE_SUBSCRIPTION_STATUSES = new Set(['active', 'pending_backorder', 'pending_cancel']);

type PromotionsTab = 'active' | 'history';

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
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
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

  advantageText(preview: PromotionValidationResponse): string {
    return getPromotionAdvantageText(preview);
  }
  readonly applyPromoAriaLabel = $localize`:@@featurePromotions-applyCode:Apply a promotion code`;

  readonly applyModalOpen = signal(false);
  promoCode = signal('');
  selectedSubscriptionId = signal('');
  readonly activeTab = signal<PromotionsTab>('active');
  /** Active tab → `GET /promotions/active?limit&offset&search` (replace-page; only while the tab is shown). */
  readonly activePaging = dbServerPaging(
    (query) => {
      if (untracked(this.activeTab) === 'active') this.promotionsFacade.loadActivePromotions(query);
    },
    { url: 'act-' },
  );
  /** History tab → `GET /promotions/redemptions?limit&offset&search` (replace-page; only while the tab is shown). */
  readonly historyPaging = dbServerPaging(
    (query) => {
      if (untracked(this.activeTab) === 'history') this.promotionsFacade.loadRedemptions(query);
    },
    { url: 'hist-' },
  );
  readonly searchActivePlaceholder = $localize`:@@featurePromotions-searchActive:Search active promotions`;
  readonly searchHistoryPlaceholder = $localize`:@@featurePromotions-searchHistory:Search redemption history`;

  readonly activeColumns: FpcTableColumn<PromotionRedemptionResponse>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAdminPromotions-colStatus:Status`,
      type: 'state',
      state: (item) => redemptionState(item.status),
    },
    {
      id: 'name',
      label: $localize`:@@featureAdminPromotions-colPromotion:Promotion`,
      value: (item) => item.promotionName,
      required: true,
      priority: 1,
    },
    {
      id: 'code',
      label: $localize`:@@featureAdminPromotions-colCode:Code`,
      value: (item) => item.code,
      mono: true,
      priority: 2,
    },
    {
      id: 'advantage',
      label: $localize`:@@featureAdminPromotions-colAdvantage:Advantage`,
      value: (item) => getPromotionAdvantageText(item),
      priority: 1,
    },
    {
      id: 'valid',
      label: $localize`:@@featurePromotions-colValid:Valid`,
      value: (item) => item.validFrom,
      priority: 2,
    },
    {
      id: 'plan',
      label: $localize`:@@featureAdminPromotions-colPlan:Plan`,
      value: (item) => item.planName ?? '',
      priority: 3,
    },
  ];

  readonly historyColumns: FpcTableColumn<PromotionRedemptionResponse>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAdminPromotions-colStatus:Status`,
      type: 'state',
      state: (item) => redemptionState(item.status),
    },
    {
      id: 'name',
      label: $localize`:@@featureAdminPromotions-colPromotion:Promotion`,
      value: (item) => item.promotionName || item.code,
      required: true,
      priority: 1,
    },
    {
      id: 'redeemedAt',
      label: $localize`:@@featureAdminPromotions-colRedeemedAt:Redeemed`,
      value: (item) => item.redeemedAt,
      priority: 1,
    },
    {
      id: 'code',
      label: $localize`:@@featureAdminPromotions-colCode:Code`,
      value: (item) => item.code,
      mono: true,
      priority: 3,
    },
    {
      id: 'advantage',
      label: $localize`:@@featureAdminPromotions-colAdvantage:Advantage`,
      value: (item) => getPromotionAdvantageText(item),
      priority: 2,
    },
    {
      id: 'subscription',
      label: $localize`:@@featureAdminPromotions-colSubscription:Subscription`,
      value: (item) => this.redemptionSubscriptionLabel(item),
      priority: 2,
    },
    {
      id: 'plan',
      label: $localize`:@@featureAdminPromotions-colPlan:Plan`,
      value: (item) => item.planName ?? '',
      priority: 3,
    },
    {
      id: 'context',
      label: $localize`:@@featureAdminPromotions-colContext:Context`,
      value: (item) => this.redemptionContextLabel(item.redemptionContext),
      priority: 3,
    },
  ];

  readonly activePromotions = toSignal(this.promotionsFacade.getActivePromotions$(), { initialValue: [] });
  readonly redemptions = toSignal(this.promotionsFacade.getRedemptions$(), { initialValue: [] });
  readonly activeTotal = toSignal(this.promotionsFacade.getActiveTotal$(), { initialValue: 0 });
  readonly redemptionsTotal = toSignal(this.promotionsFacade.getRedemptionsTotal$(), { initialValue: 0 });
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
      onSuccess: () => {
        this.resetApplyForm();
        this.reloadCurrentTab();
      },
    });

    // A tab switch loads the shown tab's current page (the hidden tab does not query).
    let firstTab = true;

    effect(() => {
      this.activeTab();
      if (firstTab) {
        firstTab = false;

        return;
      }
      untracked(() => this.reloadCurrentTab());
    });
  }

  private reloadCurrentTab(): void {
    if (this.activeTab() === 'history') this.historyPaging.reload();
    else this.activePaging.reload();
  }

  ngOnInit(): void {
    this.subscriptionsFacade.loadSubscriptions();
    this.servicePlansFacade.loadServicePlans();
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

  onTabChange(tabId: string | null): void {
    if (tabId === 'active' || tabId === 'history') {
      this.activeTab.set(tabId);
    }
  }

  tabLabel(panel: PromotionsTab): string {
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

  redemptionSubscriptionLabel(item: PromotionRedemptionResponse): string {
    return resolveNamedLabel(item.subscriptionNumber);
  }

  validRange(item: PromotionRedemptionResponse): string {
    return formatBillingDateRange(item.validFrom, item.validTo);
  }

  redeemedAt(item: PromotionRedemptionResponse): string {
    return item.redeemedAt;
  }

  formatCurrencyAmount(amount: number): string {
    return formatBillingMoney(amount);
  }

  formatPeriodPrice(amount: number): string {
    const plan = this.selectedPlan();
    const price = this.formatCurrencyAmount(amount);

    if (!plan) return price;

    return `${price} / ${getBillingIntervalLabel(plan.billingIntervalValue, plan.billingIntervalType)}`;
  }

  formatDate(value?: string): string {
    if (!value) return '-';

    return formatBillingDate(value, value ?? '-');
  }

  formatDateTime(value?: string): string {
    if (!value) return '-';

    return formatBillingDateTime(value, value ?? '-');
  }
}
