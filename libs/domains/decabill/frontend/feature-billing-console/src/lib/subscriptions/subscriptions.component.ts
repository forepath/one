import { CommonModule, DatePipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AvailabilityService,
  BackordersFacade,
  CustomerProfileFacade,
  PromotionsFacade,
  ServicePlansFacade,
  ServicePlansService,
  ServiceTypesFacade,
  ServiceTypesService,
  SubscriptionConfigChangeFacade,
  SubscriptionsFacade,
  SubscriptionServerInfoFacade,
  type BackorderResponse,
  type CloudInitConfigOrderField,
  type ConfigChangeEligibility,
  type ConfigChangeErrorCode,
  type ConfigChangeRequest,
  type CreateSubscriptionDto,
  type CustomerProfileDto,
  type OrderProvisioningOption,
  type PlanAddonOptionDto,
  type PricingPreviewResponse,
  type ProviderDetail,
  type ServicePlanResponse,
  type ServiceTypeResponse,
  type ServerType,
  type SubscriptionResponse,
  type SubscriptionMeterSummary,
  formatBillingProviderLocationLabel,
  formatServerTypeOption,
  isNoneServiceTypeId,
  normalizeAllowedServerTypeIds,
  providerLocationCatalogFromList,
  type ProviderLocationCatalog,
  type ValidatePromotionRequest,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { combineLatest, filter, interval, map, of, pairwise, switchMap, take, withLatestFrom } from 'rxjs';

import {
  getBackorderStatusBadgeClass,
  getBackorderStatusLabel,
  getBillingIntervalLabel,
  getProfileCompleteLabel,
  getProvisioningStatusBadgeClass,
  getProvisioningStatusLabel,
  getSubscriptionStatusBadgeClass,
  getSubscriptionStatusLabel,
  getVatIdValidationStatusLabel,
} from '../billing-status-labels';
import { filterItemsBySearch } from '../billing-list-search';
import {
  BILLING_COUNTRY_OPTIONS,
  DEFAULT_BILLING_COUNTRY_CODE,
  type BillingCountryOption,
} from '../billing-country-options';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { buildPromotionAdjustedOrderPricing } from '../promotion-pricing-preview.util';

type CustomerPlansMobilePanel = 'subscriptions' | 'backorders';

type AutoBillingSetupFeedback = 'waiting' | 'confirmed' | 'canceled';

type OrderWizardStepId = 'plan' | 'infrastructure' | 'configuration' | 'summary';

type OrderWizardStep = {
  id: OrderWizardStepId;
  label: string;
};

type ConfigChangeWizardStepId = 'serverType' | 'addons' | 'summary';

type ConfigChangeWizardStep = {
  id: ConfigChangeWizardStepId;
  label: string;
};

@Component({
  selector: 'framework-billing-subscriptions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  providers: [DatePipe],
  templateUrl: './subscriptions.component.html',
  styleUrls: ['./subscriptions.component.scss'],
})
export class SubscriptionsComponent implements OnInit, AfterViewInit {
  readonly mobilePanels: CustomerPlansMobilePanel[] = ['subscriptions', 'backorders'];
  readonly mobilePanel = signal<CustomerPlansMobilePanel>('subscriptions');
  readonly subscriptionsSearch = signal('');
  readonly backordersSearch = signal('');
  @ViewChild('orderPlanModal', { static: false }) private orderPlanModal!: ElementRef<HTMLDivElement>;
  @ViewChild('modifyConfigModal', { static: false }) private modifyConfigModal!: ElementRef<HTMLDivElement>;
  @ViewChild('cancelSubscriptionModal', { static: false }) private cancelSubscriptionModal!: ElementRef<HTMLDivElement>;
  @ViewChild('withdrawSubscriptionModal', { static: false })
  private withdrawSubscriptionModal!: ElementRef<HTMLDivElement>;
  @ViewChild('resumeConfirmModal', { static: false }) private resumeConfirmModal!: ElementRef<HTMLDivElement>;
  @ViewChild('cancelBackorderModal', { static: false }) private cancelBackorderModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editProfileModal', { static: false }) private editProfileModal!: ElementRef<HTMLDivElement>;

  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  private readonly configChangeFacade = inject(SubscriptionConfigChangeFacade);
  private readonly serverInfoFacade = inject(SubscriptionServerInfoFacade);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly servicePlansService = inject(ServicePlansService);
  private readonly serviceTypesFacade = inject(ServiceTypesFacade);
  private readonly serviceTypesService = inject(ServiceTypesService);
  private readonly availabilityService = inject(AvailabilityService);
  private readonly backordersFacade = inject(BackordersFacade);
  private readonly customerProfileFacade = inject(CustomerProfileFacade);
  private readonly promotionsFacade = inject(PromotionsFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly datePipe = inject(DatePipe);

  readonly subscriptions$ = this.subscriptionsFacade.getSubscriptions$();
  readonly subscriptions = toSignal(this.subscriptionsFacade.getSubscriptions$(), {
    initialValue: [] as SubscriptionResponse[],
  });
  readonly subscriptionsLoading$ = this.subscriptionsFacade.getSubscriptionsLoading$();
  readonly subscriptionsError$ = this.subscriptionsFacade.getSubscriptionsError$();
  readonly subscriptionsCreating$ = this.subscriptionsFacade.getSubscriptionsCreating$();
  readonly subscriptionsCreating = toSignal(this.subscriptionsFacade.getSubscriptionsCreating$(), {
    initialValue: false,
  });
  readonly subscriptionsCanceling$ = this.subscriptionsFacade.getSubscriptionsCanceling$();
  readonly subscriptionsWithdrawing$ = this.subscriptionsFacade.getSubscriptionsWithdrawing$();
  readonly subscriptionsResuming$ = this.subscriptionsFacade.getSubscriptionsResuming$();
  readonly backordersCanceling$ = this.backordersFacade.getBackordersCanceling$();
  readonly provisioningStatusBySubscriptionId = toSignal(
    this.serverInfoFacade.getProvisioningStatusBySubscriptionId$(),
    {
      initialValue: {} as Record<string, string>,
    },
  );

  readonly filteredSubscriptions = computed(() =>
    filterItemsBySearch(this.subscriptions(), this.subscriptionsSearch(), (sub) =>
      this.subscriptionSearchHaystack(sub),
    ),
  );
  readonly activeSubscriptionsCount = computed(
    () => this.subscriptions().filter((sub) => sub.status === 'active').length,
  );
  readonly isCustomerProfileComplete = toSignal(this.customerProfileFacade.isCustomerProfileComplete$(), {
    initialValue: false,
  });

  readonly servicePlans$ = this.servicePlansFacade.getActiveServicePlans$();
  readonly servicePlans = toSignal(this.servicePlansFacade.getActiveServicePlans$(), {
    initialValue: [] as ServicePlanResponse[],
  });
  readonly servicePlansLoading$ = this.servicePlansFacade.getServicePlansLoading$();

  readonly pendingBackorders$ = this.backordersFacade.getPendingBackorders$();
  readonly backorders = toSignal(this.backordersFacade.getPendingBackorders$(), {
    initialValue: [] as BackorderResponse[],
  });
  readonly backordersLoading$ = this.backordersFacade.getBackordersLoading$();
  readonly backordersError$ = this.backordersFacade.getBackordersError$();

  readonly filteredBackorders = computed(() =>
    filterItemsBySearch(this.backorders(), this.backordersSearch(), (backorder) =>
      this.backorderSearchHaystack(backorder),
    ),
  );

  readonly customerProfile$ = this.customerProfileFacade.getCustomerProfile$();
  readonly customerProfileUpdating$ = this.customerProfileFacade.getCustomerProfileUpdating$();
  readonly customerProfileError$ = this.customerProfileFacade.getCustomerProfileError$();
  readonly isCustomerProfileComplete$ = this.customerProfileFacade.isCustomerProfileComplete$();

  readonly termsUrl = this.environment.cookieConsent.termsUrl;
  readonly privacyUrl = this.environment.cookieConsent.privacyPolicyUrl;

  readonly countryOptions: BillingCountryOption[] = BILLING_COUNTRY_OPTIONS;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private initialPlanIdFromQuery: string | null = null;
  autoBillingSetupFeedback: AutoBillingSetupFeedback | null = null;

  orderPlanId = '';
  orderAddons: PlanAddonOptionDto[] = [];
  orderAddonIds = new Set<string>();
  /** Per-addon order field values, keyed by addon id then env key. */
  orderAddonConfigs: Record<string, Record<string, string>> = {};
  orderAddonsLoading = false;
  orderPromotionCode = signal('');
  readonly orderPromotionValidationPreview = toSignal(this.promotionsFacade.getValidationPreview$('new'), {
    initialValue: null,
  });
  readonly orderPromotionValidationError = toSignal(this.promotionsFacade.getValidationError$('new'), {
    initialValue: null,
  });
  readonly orderPromotionValidationLoading$ = this.promotionsFacade.getValidationLoading$('new');
  readonly orderPricingPreview = signal<PricingPreviewResponse | null>(null);
  readonly orderPromotionPricingAdjustment = computed(() => {
    const preview = this.orderPromotionValidationPreview();
    const pricing = this.orderPricingPreview();

    if (!preview?.valid || !pricing) {
      return null;
    }

    const benefitEndsLabel = preview.benefitEndsAt
      ? (this.datePipe.transform(preview.benefitEndsAt, 'mediumDate') ?? undefined)
      : undefined;
    const plan = this.servicePlans().find((entry) => entry.id === this.orderPlanId.trim()) ?? null;

    return buildPromotionAdjustedOrderPricing(
      preview,
      { ...pricing, totalPrice: pricing.grandTotal ?? pricing.totalPrice },
      {
        benefitEndsLabel,
        billing: plan
          ? {
              billingIntervalType: plan.billingIntervalType,
              billingIntervalValue: plan.billingIntervalValue,
              billingDayOfMonth: plan.billingDayOfMonth,
            }
          : undefined,
        periodStart: preview.benefitStartsAt ? new Date(preview.benefitStartsAt) : undefined,
      },
    );
  });
  readonly hasOrderPromotionCheckResult = computed(
    () => this.orderPromotionValidationPreview() != null || this.orderPromotionValidationError() != null,
  );
  readonly orderPromotionSimulationLocked = computed(() => {
    const preview = this.orderPromotionValidationPreview();

    return Boolean(preview?.valid && this.orderPromotionCode().trim());
  });
  private readonly orderPromotionValidateRequest = computed<ValidatePromotionRequest | null>(() => {
    const code = this.orderPromotionCode().trim();
    const planId = this.orderPlanId.trim();

    if (!code || !planId) return null;

    return {
      code,
      redemptionContext: 'new',
      planId,
    };
  });
  readonly orderPromotionCanProceed = toSignal(
    toObservable(this.orderPromotionValidateRequest).pipe(
      switchMap((request) => (request ? this.promotionsFacade.canRedeem$(request) : of(true))),
    ),
    { initialValue: true },
  );
  orderAutoBackorder = false;
  orderAcceptLegal = false;
  /** Canonical schema key for geography when customer may choose (region or location). */
  orderGeographyFieldKey: 'region' | 'location' | null = null;
  orderLocationOptions: string[] = [];
  orderProvisioningLocation = '';
  orderLocationCatalog: ProviderLocationCatalog = new Map();
  orderProvisioningServerType = '';
  orderServerTypeOptions: ServerType[] = [];
  orderServerTypesLoading = false;
  orderCustomOrderFields: CloudInitConfigOrderField[] = [];
  orderCustomEnv: Record<string, string> = {};
  readonly orderFieldDefaultPlaceholder = 'Uses a pre-configured default if left empty';
  orderProvisioningOptions: OrderProvisioningOption[] = [];
  orderProvisioningOptionKey = '';
  orderProvisioningOptionsLoading = false;
  orderProvisioningOptionsError = false;
  orderCustomOrderFieldsLoading = false;
  orderCustomOrderFieldsError = false;
  private orderProvisioningRequestId = 0;
  private orderCustomFieldsRequestId = 0;
  private orderPricingRequestId = 0;
  private orderServerTypesRequestId = 0;
  orderPricingLoading = false;
  /** Signal for reactive conditional form fields; kept in sync with orderRequestedConfig.authenticationMethod. */
  authMethod = signal<'users' | 'api-key' | 'keycloak'>('users');
  readonly orderWizardStepIndex = signal(0);
  readonly orderOrderComplete = signal(false);

  subscriptionToModify: SubscriptionResponse | null = null;
  configChangeServerType = '';
  configChangeServerTypeOptions: ServerType[] = [];
  configChangeServerTypesLoading = false;
  configChangeAddons: PlanAddonOptionDto[] = [];
  configChangeAddonsLoading = false;
  /** Target addon selection: active addons stay selected unless the customer removes them. */
  configChangeSelectedAddonIds = new Set<string>();
  /** Per-addon order field values for newly added addons, keyed by addon id then field key. */
  configChangeAddonConfigs: Record<string, Record<string, string>> = {};
  readonly configChangeWizardStepIndex = signal(0);
  readonly configChangeComplete = signal(false);
  private configChangeServerTypesRequestId = 0;
  private configChangeAddonsRequestId = 0;

  readonly configChangeSubmitting$ = this.configChangeFacade.getSubmitting$();
  readonly configChangeEligibility = toSignal(this.configChangeFacade.getEligibility$(), { initialValue: null });
  readonly configChangeEligibilityLoading = toSignal(this.configChangeFacade.getEligibilityLoading$(), {
    initialValue: false,
  });
  readonly configChangeEligibilityError = toSignal(this.configChangeFacade.getEligibilityError$(), {
    initialValue: null,
  });
  readonly configChangePreview = toSignal(this.configChangeFacade.getPreview$(), { initialValue: null });
  readonly configChangePreviewLoading = toSignal(this.configChangeFacade.getPreviewLoading$(), { initialValue: false });
  readonly configChangePreviewErrorCode = toSignal(this.configChangeFacade.getPreviewErrorCode$(), {
    initialValue: null,
  });
  readonly configChangePreviewFailed = toSignal(
    this.configChangeFacade.getPreviewError$().pipe(map((error) => error != null)),
    { initialValue: false },
  );
  readonly configChangeSubmitting = toSignal(this.configChangeFacade.getSubmitting$(), { initialValue: false });
  readonly configChangeSubmitErrorCode = toSignal(this.configChangeFacade.getSubmitErrorCode$(), {
    initialValue: null,
  });
  readonly configChangeSubmitFailed = toSignal(
    this.configChangeFacade.getSubmitError$().pipe(map((error) => error != null)),
    { initialValue: false },
  );

  onServiceChange(value: 'agenstra-controller' | 'agenstra-manager' | 'decabill-billing'): void {
    this.orderRequestedConfig = { ...this.orderRequestedConfig, service: value };

    if (value === 'agenstra-manager' && this.orderRequestedConfig.authenticationMethod === 'users') {
      this.orderRequestedConfig = { ...this.orderRequestedConfig, authenticationMethod: 'api-key' };
      this.authMethod.set('api-key');
    }

    this.cdr.detectChanges();
  }

  onAuthMethodChange(value: 'users' | 'api-key' | 'keycloak'): void {
    this.orderRequestedConfig = { ...this.orderRequestedConfig, authenticationMethod: value };
    this.authMethod.set(value);
    this.cdr.detectChanges();
  }

  onGitSetupModeChange(value: 'clone' | 'empty'): void {
    this.orderRequestedConfig = {
      ...this.orderRequestedConfig,
      git: { ...this.orderRequestedConfig.git, setupMode: value },
    };
    this.cdr.detectChanges();
  }

  isOrderGitCloneMode(): boolean {
    return (this.orderRequestedConfig.git?.setupMode ?? 'clone') === 'clone';
  }

  orderRequestedConfig: {
    service: 'agenstra-controller' | 'agenstra-manager' | 'decabill-billing' | 'custom';
    authenticationMethod: 'users' | 'api-key' | 'keycloak';
    staticApiKey: string;
    disableSignup: boolean;
    smtp: { host: string; port: number; user: string; password: string; from: string };
    keycloak: { serverUrl: string; authServerUrl: string; realm: string; clientId: string; clientSecret: string };
    hetznerApiToken: string;
    digitaloceanApiToken: string;
    git: {
      setupMode: 'clone' | 'empty';
      repositoryUrl: string;
      username: string;
      token: string;
      password: string;
      privateKey: string;
      commitAuthorName: string;
      commitAuthorEmail: string;
    };
    cursorApiKey: string;
  } = {
    service: 'agenstra-controller',
    authenticationMethod: 'users',
    staticApiKey: '',
    disableSignup: false,
    smtp: {
      host: 'mailhog',
      port: 1025,
      user: '',
      password: '',
      from: 'noreply@localhost',
    },
    keycloak: {
      serverUrl: '',
      authServerUrl: '',
      realm: '',
      clientId: '',
      clientSecret: '',
    },
    hetznerApiToken: '',
    digitaloceanApiToken: '',
    git: {
      setupMode: 'clone',
      repositoryUrl: '',
      username: '',
      token: '',
      password: '',
      privateKey: '',
      commitAuthorName: '',
      commitAuthorEmail: '',
    },
    cursorApiKey: '',
  };
  subscriptionToCancel: SubscriptionResponse | null = null;
  subscriptionToWithdraw: SubscriptionResponse | null = null;
  subscriptionToResume: SubscriptionResponse | null = null;
  backorderToRetry: BackorderResponse | null = null;
  backorderToCancel: BackorderResponse | null = null;

  profileForm: CustomerProfileDto = {};

  planNameByPlanId(plans: ServicePlanResponse[] | null, planId: string): string {
    const plan = plans?.find((p) => p.id === planId);

    return plan?.name ?? planId;
  }

  subscriptionDisplayTitle(sub: SubscriptionResponse, plans: ServicePlanResponse[] | null): string {
    return this.planNameByPlanId(plans, sub.planId);
  }

  subscriptionStatusLabel(status: string | null | undefined): string {
    return getSubscriptionStatusLabel(status);
  }

  subscriptionStatusBadgeClass(status: string | null | undefined): string {
    return getSubscriptionStatusBadgeClass(status);
  }

  provisioningStatusForSubscription(subscriptionId: string): string | undefined {
    return this.provisioningStatusBySubscriptionId()[subscriptionId];
  }

  showProvisioningStatusBadge(subscriptionId: string): boolean {
    const status = this.provisioningStatusForSubscription(subscriptionId);

    return status === 'pending' || status === 'failed';
  }

  provisioningStatusLabel(status: string | null | undefined): string {
    return getProvisioningStatusLabel(status);
  }

  provisioningStatusBadgeClass(status: string | null | undefined): string {
    return getProvisioningStatusBadgeClass(status);
  }

  backorderStatusLabel(status: string | null | undefined): string {
    return getBackorderStatusLabel(status);
  }

  backorderStatusBadgeClass(status: string | null | undefined): string {
    return getBackorderStatusBadgeClass(status);
  }

  profileCompleteLabel(isComplete: boolean): string {
    return getProfileCompleteLabel(isComplete);
  }

  vatIdValidationStatusLabel(status: string | null | undefined): string {
    return getVatIdValidationStatusLabel(status);
  }

  mobilePanelLabel(panel: CustomerPlansMobilePanel): string {
    switch (panel) {
      case 'subscriptions':
        return $localize`:@@featureSubscriptions-mobilePanelSubscriptions:Subscriptions`;
      case 'backorders':
        return $localize`:@@featureSubscriptions-mobilePanelBackorders:Backorders`;
    }
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return '-';

    return this.datePipe.transform(value, 'shortDate') ?? '-';
  }

  formatSubscriptionPeriod(sub: SubscriptionResponse): string {
    if (!sub.currentPeriodStart || !sub.currentPeriodEnd) return '-';

    return `${this.formatDate(sub.currentPeriodStart)} to ${this.formatDate(sub.currentPeriodEnd)}`;
  }

  subscriptionSearchHaystack(sub: SubscriptionResponse): string {
    return [
      sub.number,
      sub.planId,
      this.planNameByPlanId(this.servicePlans(), sub.planId),
      sub.status,
      this.subscriptionStatusLabel(sub.status),
      sub.currentPeriodStart,
      sub.currentPeriodEnd,
      sub.nextBillingAt,
      sub.periodTotalPrice,
    ]
      .filter((value) => value !== null && value !== undefined && value !== '')
      .join(' ');
  }

  backorderSearchHaystack(backorder: BackorderResponse): string {
    return [
      backorder.planId,
      this.planNameByPlanId(this.servicePlans(), backorder.planId),
      backorder.status,
      this.backorderStatusLabel(backorder.status),
      backorder.periodTotalPrice,
    ]
      .filter((value) => value !== null && value !== undefined && value !== '')
      .join(' ');
  }

  onSubscriptionsSearchChange(value: string): void {
    this.subscriptionsSearch.set(value);
  }

  onBackordersSearchChange(value: string): void {
    this.backordersSearch.set(value);
  }

  /** Calculates total price from plan (base + margin). Same formula as backend PricingService. */
  getPlanTotalPrice(plan: ServicePlanResponse, serverType?: ServerType | null): number | null {
    const baseFromType = serverType?.priceMonthly;
    const base =
      baseFromType != null && Number.isFinite(baseFromType) ? baseFromType : this.parsePlanNumber(plan.basePrice);

    if (base <= 0) return null;

    const marginPct = this.parsePlanNumber(plan.marginPercent);
    const marginFix = this.parsePlanNumber(plan.marginFixed);

    return base + base * (marginPct / 100) + marginFix;
  }

  formatOrderPlanPrice(plan: ServicePlanResponse, serverTypeId?: string): string {
    const serverType =
      serverTypeId?.trim() && this.orderServerTypeOptions.length > 0
        ? (this.orderServerTypeOptions.find((st) => st.id === serverTypeId) ?? null)
        : null;

    const total = this.getPlanTotalPrice(plan, serverType);

    if (total === null) return '-';

    return this.formatCurrencyAmount(total);
  }

  formatServerTypeOptionLabel(st: ServerType): string {
    return this.formatCustomerServerTypeOptionLabel(st, this.getCurrentOrderPlan());
  }

  /** Formats plan price for display (e.g. "€4.51" or "-"). */
  formatPlanPrice(plan: ServicePlanResponse): string {
    return this.formatPlanOptionPrice(plan);
  }

  /**
   * Customer-facing server type label: specs plus plan price including margins
   * (same total formula as plan options / pricing preview).
   */
  private formatCustomerServerTypeOptionLabel(st: ServerType, plan: ServicePlanResponse | null): string {
    const baseLabel = formatServerTypeOption(st, { includePrice: false });

    if (!plan) {
      return baseLabel;
    }

    const total = this.getPlanTotalPrice(plan, st);

    if (total === null) {
      return baseLabel;
    }

    const interval = getBillingIntervalLabel(plan.billingIntervalValue, plan.billingIntervalType);

    return `${baseLabel} - ${this.formatCurrencyAmount(total)} / ${interval}`;
  }

  private parsePlanNumber(value: string | number | null | undefined): number {
    if (value === undefined || value === null) return 0;

    const n = typeof value === 'number' ? value : Number(String(value).trim());

    return Number.isFinite(n) ? n : 0;
  }

  formatCurrencyAmount(amount: number): string {
    return `€${amount.toFixed(2)}`;
  }

  formatEntryPeriodPrice(totalPrice: number | null | undefined, plan: ServicePlanResponse | null): string {
    if (totalPrice == null || !Number.isFinite(totalPrice)) {
      return '-';
    }

    const price = this.formatCurrencyAmount(totalPrice);

    if (!plan) {
      return price;
    }

    return `${price} / ${getBillingIntervalLabel(plan.billingIntervalValue, plan.billingIntervalType)}`;
  }

  formatSubscriptionPeriodPrice(sub: SubscriptionResponse, plans: ServicePlanResponse[] | null): string {
    return this.formatEntryPeriodPrice(sub.periodTotalPrice, this.getSelectedPlan(plans, sub.planId));
  }

  subscriptionMeters(sub: SubscriptionResponse): SubscriptionMeterSummary[] {
    return sub.meters ?? [];
  }

  hasSubscriptionMeters(sub: SubscriptionResponse): boolean {
    return this.subscriptionMeters(sub).length > 0;
  }

  formatMeterCharge(amount: number): string {
    return `${amount.toFixed(2)} EUR`;
  }

  formatMeterValue(meter: SubscriptionMeterSummary): string {
    const unit = meter.unitLabel ? ` ${meter.unitLabel}` : '';

    return `${meter.aggregatedValue}${unit}`;
  }

  meterAttachmentLabel(meter: SubscriptionMeterSummary): string {
    if (meter.attachmentType === 'addon') {
      return meter.addonName?.trim() || meter.addonId || $localize`:@@featureSubscriptions-meterAddon:Addon meter`;
    }

    return $localize`:@@featureSubscriptions-meterPlan:Plan meter`;
  }

  formatBackorderPeriodPrice(bo: BackorderResponse, plans: ServicePlanResponse[] | null): string {
    return this.formatEntryPeriodPrice(bo.periodTotalPrice, this.getSelectedPlan(plans, bo.planId));
  }

  /** Option label for plan select: name + price + billing interval. */
  formatPlanOptionLabel(plan: ServicePlanResponse): string {
    const price = this.formatPlanOptionPrice(plan);
    const interval = `${plan.billingIntervalValue} ${plan.billingIntervalType}(s)`;

    return `${plan.name}: ${price} / ${interval}`;
  }

  /**
   * Each plan option uses that plan's own base price.
   * Server-type override applies only to the currently selected plan when it offers Server & region.
   */
  private formatPlanOptionPrice(plan: ServicePlanResponse): string {
    const isSelected = plan.id === this.orderPlanId.trim();
    const useSelectedServerType =
      isSelected &&
      plan.allowCustomerServerTypeSelection === true &&
      this.orderProvisioningServerType.trim().length > 0 &&
      this.orderServerTypeOptions.length > 0;

    return this.formatOrderPlanPrice(plan, useSelectedServerType ? this.orderProvisioningServerType : undefined);
  }

  /** Returns the plan matching planId from the list, or null. */
  getSelectedPlan(plans: ServicePlanResponse[] | null, planId: string): ServicePlanResponse | null {
    if (!plans?.length || !planId?.trim()) return null;

    return plans.find((p) => p.id === planId) ?? null;
  }

  ngOnInit(): void {
    this.subscriptionsFacade.loadSubscriptions();
    this.servicePlansFacade.loadServicePlans();
    this.serviceTypesFacade.loadServiceTypes();
    this.serviceTypesFacade.loadProviderDetails();
    this.backordersFacade.loadBackorders();
    this.customerProfileFacade.loadCustomerProfile();

    this.subscriptionsLoading$
      .pipe(
        filter((loading) => !loading),
        take(1),
      )
      .subscribe(() => this.serverInfoFacade.loadOverviewServerInfo());
  }

  ngAfterViewInit(): void {
    this.registerModalCloseWatchers();

    const queryParamMap = this.route.snapshot.queryParamMap;
    const planParam = queryParamMap.get('plan');

    this.initialPlanIdFromQuery = planParam?.trim() || null;

    const orderParam = queryParamMap.get('order');

    if (orderParam === 'true') {
      this.openOrderPlanModal();
    }

    const profileParam = queryParamMap.get('profile');
    const autoBillingParam = queryParamMap.get('autoBilling');

    if (autoBillingParam === 'setup_success') {
      this.autoBillingSetupFeedback = 'waiting';
      this.startAutoBillingConfirmationPoll();
    } else if (autoBillingParam === 'setup_cancel') {
      this.autoBillingSetupFeedback = 'canceled';
    }

    if (autoBillingParam) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { autoBilling: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

    if (profileParam === 'true') {
      this.openEditProfileModal();
    }
  }

  openOrderPlanModal(preferredPlanId?: string | null): void {
    this.resetOrderFormState();
    this.resetOrderRequestedConfig();

    const effectivePreferredPlanId = (preferredPlanId ?? this.initialPlanIdFromQuery)?.trim();

    this.servicePlans$
      .pipe(
        filter((plans) => (plans?.length ?? 0) > 0),
        take(1),
      )
      .subscribe((plans) => {
        if (effectivePreferredPlanId) {
          const matchingPlan = plans.find((plan) => plan.id === effectivePreferredPlanId);

          if (matchingPlan) {
            this.orderPlanId = matchingPlan.id;
            this.syncOrderProvisioningLocationState();
            this.syncOrderServerTypeState();
            this.syncOrderProvisioningOptions();
            this.syncOrderAddons();
            this.syncOrderPricingPreview();

            return;
          }
        }

        this.orderPlanId = plans[0].id;
        this.syncOrderProvisioningLocationState();
        this.syncOrderServerTypeState();
        this.syncOrderProvisioningOptions();
        this.syncOrderAddons();
        this.syncOrderPricingPreview();
      });
    showBillingModal(this.orderPlanModal);
  }

  onOrderPlanIdChange(): void {
    this.promotionsFacade.clearValidation();
    this.orderWizardStepIndex.set(0);
    this.syncOrderProvisioningLocationState();
    this.syncOrderServerTypeState();
    this.syncOrderProvisioningOptions();
    this.syncOrderAddons();
    this.syncOrderPricingPreview();
  }

  isOrderAddonSelected(addonId: string): boolean {
    return this.orderAddonIds.has(addonId);
  }

  toggleOrderAddon(addonId: string, checked: boolean): void {
    if (checked) {
      this.orderAddonIds.add(addonId);
      const addon = this.orderAddons.find((entry) => entry.id === addonId);

      if (addon?.orderFields?.length) {
        this.orderAddonConfigs = {
          ...this.orderAddonConfigs,
          [addonId]: Object.fromEntries(addon.orderFields.map((field) => [field.key, ''])),
        };
      }
    } else {
      this.orderAddonIds.delete(addonId);
      const nextConfigs = { ...this.orderAddonConfigs };

      delete nextConfigs[addonId];
      this.orderAddonConfigs = nextConfigs;
    }

    this.clampOrderWizardStepIndex();
    this.syncOrderPricingPreview();
  }

  setOrderAddonConfigValue(addonId: string, key: string, value: string): void {
    this.orderAddonConfigs = {
      ...this.orderAddonConfigs,
      [addonId]: {
        ...(this.orderAddonConfigs[addonId] ?? {}),
        [key]: value,
      },
    };
  }

  getOrderAddonConfigValue(addonId: string, key: string): string {
    return this.orderAddonConfigs[addonId]?.[key] ?? '';
  }

  showOrderAddonFields(addon: PlanAddonOptionDto): boolean {
    return this.isOrderAddonSelected(addon.id) && (addon.orderFields?.length ?? 0) > 0;
  }

  selectedOrderAddonsWithConfigFields(): PlanAddonOptionDto[] {
    return this.orderAddons.filter((addon) => this.showOrderAddonFields(addon));
  }

  hasSelectedOrderAddonConfigFields(): boolean {
    return this.selectedOrderAddonsWithConfigFields().length > 0;
  }

  orderAddonConfigCardTitle(addonName: string): string {
    return $localize`:@@featureSubscriptions-addonConfigCardTitle:Addon: ${addonName}:addonName:`;
  }

  selectedOrderAddons(): PlanAddonOptionDto[] {
    return this.orderAddons.filter((addon) => this.orderAddonIds.has(addon.id));
  }

  formatOrderAddonsSummary(): string {
    return this.selectedOrderAddons()
      .map((addon) => addon.name)
      .join(', ');
  }

  onOrderServerTypeChange(): void {
    this.syncOrderPricingPreview();
  }

  onOrderLocationChange(): void {
    this.syncOrderPricingPreview();
  }

  orderHasInfrastructureStep(): boolean {
    const plan = this.getCurrentOrderPlan();

    if (!plan) {
      return false;
    }

    if (plan.allowCustomerServerTypeSelection && normalizeAllowedServerTypeIds(plan.allowedServerTypes).length > 0) {
      return true;
    }

    return plan.allowCustomerLocationSelection;
  }

  private getCurrentOrderPlan(): ServicePlanResponse | null {
    return this.servicePlans().find((entry) => entry.id === this.orderPlanId.trim()) ?? null;
  }

  orderHasProvisioningConfigurationContent(): boolean {
    if (!this.orderPlanId.trim()) {
      return false;
    }

    if (this.orderProvisioningOptionsLoading || this.orderProvisioningOptionsError) {
      return true;
    }

    if (this.orderProvisioningOptions.length === 0) {
      return false;
    }

    if (this.showOrderProvisioningPicker()) {
      return true;
    }

    if (this.showCustomOrderConfiguration(null)) {
      return (
        this.orderCustomOrderFieldsLoading || this.orderCustomOrderFieldsError || this.orderCustomOrderFields.length > 0
      );
    }

    return this.showIntegratedOrderConfiguration(null);
  }

  orderHasConfigurationStep(): boolean {
    return this.orderHasProvisioningConfigurationContent() || this.hasSelectedOrderAddonConfigFields();
  }

  getOrderWizardSteps(): OrderWizardStep[] {
    const steps: OrderWizardStep[] = [
      {
        id: 'plan',
        label: $localize`:@@featureSubscriptions-orderStepPlanAddons:Plan & addons`,
      },
    ];

    if (this.orderHasInfrastructureStep()) {
      steps.push({ id: 'infrastructure', label: 'Server & region' });
    }

    if (this.orderHasConfigurationStep()) {
      steps.push({ id: 'configuration', label: 'Configuration' });
    }

    steps.push({ id: 'summary', label: 'Summary' });

    return steps;
  }

  getActiveOrderWizardStepId(): OrderWizardStepId {
    return this.getOrderWizardSteps()[this.orderWizardStepIndex()]?.id ?? 'plan';
  }

  isOrderWizardStepComplete(stepIndex: number): boolean {
    if (this.orderOrderComplete()) {
      return true;
    }

    return stepIndex < this.orderWizardStepIndex();
  }

  isOrderWizardStepActive(stepIndex: number): boolean {
    return !this.orderOrderComplete() && stepIndex === this.orderWizardStepIndex();
  }

  showOrderWizardBackButton(): boolean {
    return !this.orderOrderComplete() && this.orderWizardStepIndex() > 0;
  }

  showOrderWizardNextButton(): boolean {
    return !this.orderOrderComplete() && this.getActiveOrderWizardStepId() !== 'summary';
  }

  showOrderWizardSubmitButton(): boolean {
    return !this.orderOrderComplete() && this.getActiveOrderWizardStepId() === 'summary';
  }

  canAdvanceOrderWizardStep(): boolean {
    switch (this.getActiveOrderWizardStepId()) {
      case 'plan':
        return Boolean(this.orderPlanId.trim());
      case 'infrastructure':
        return this.isOrderInfrastructureStepReady();
      case 'configuration':
        return this.isOrderProvisioningReady() && this.areOrderAddonConfigsReady();
      case 'summary':
        return false;
      default:
        return false;
    }
  }

  goOrderWizardNext(): void {
    if (!this.canAdvanceOrderWizardStep()) {
      return;
    }

    const maxIndex = this.getOrderWizardSteps().length - 1;

    if (this.orderWizardStepIndex() < maxIndex) {
      this.orderWizardStepIndex.update((index) => index + 1);
      this.scrollOrderPlanModalToTop();
    }
  }

  private clampOrderWizardStepIndex(): void {
    const maxIndex = Math.max(0, this.getOrderWizardSteps().length - 1);

    if (this.orderWizardStepIndex() > maxIndex) {
      this.orderWizardStepIndex.set(maxIndex);
    }
  }

  goOrderWizardBack(): void {
    if (this.orderWizardStepIndex() > 0) {
      this.orderWizardStepIndex.update((index) => index - 1);
      this.scrollOrderPlanModalToTop();
    }
  }

  private scrollOrderPlanModalToTop(): void {
    const modalEl = this.orderPlanModal?.nativeElement;

    if (!modalEl) {
      return;
    }

    queueMicrotask(() => {
      modalEl.scrollTop = 0;
      modalEl.querySelector<HTMLElement>('.modal-body')?.scrollTo({ top: 0 });
      modalEl.querySelector<HTMLElement>('.modal-dialog')?.scrollTo({ top: 0 });
    });
  }

  isOrderInfrastructureStepReady(): boolean {
    if (this.orderServerTypesLoading) {
      return false;
    }

    const plan = this.getCurrentOrderPlan();
    const needsServerType = Boolean(plan?.allowCustomerServerTypeSelection) && this.orderServerTypeOptions.length > 0;
    const needsLocation =
      Boolean(plan?.allowCustomerLocationSelection) &&
      this.orderGeographyFieldKey != null &&
      this.orderLocationOptions.length > 0;

    if (needsServerType && !this.orderProvisioningServerType.trim()) {
      return false;
    }

    if (needsLocation && !this.orderProvisioningLocation.trim()) {
      return false;
    }

    return true;
  }

  onOrderPlanModalHidden(): void {
    if (this.orderOrderComplete()) {
      this.resetOrderFormState();
    }

    this.resetOrderRequestedConfig();
  }

  private resetOrderFormState(): void {
    this.orderPlanId = '';
    this.orderPromotionCode.set('');
    this.promotionsFacade.clearValidation();
    this.orderAutoBackorder = true;
    this.orderAcceptLegal = false;
    this.orderPricingPreview.set(null);
    this.orderAddons = [];
    this.orderAddonIds = new Set();
    this.orderAddonConfigs = {};
    this.orderAddonsLoading = false;
    this.orderPricingLoading = false;
    this.orderWizardStepIndex.set(0);
    this.orderOrderComplete.set(false);
  }

  formatOrderServerTypeSummary(): string {
    const selected = this.orderServerTypeOptions.find((entry) => entry.id === this.orderProvisioningServerType);

    return selected ? this.formatServerTypeOptionLabel(selected) : this.orderProvisioningServerType;
  }

  private syncOrderPricingPreview(): void {
    const planId = this.orderPlanId?.trim();
    const requestId = ++this.orderPricingRequestId;

    if (!planId || this.orderServerTypesLoading) {
      if (!planId) {
        this.orderPricingPreview.set(null);
        this.orderPricingLoading = false;
      }

      return;
    }

    const requestedConfig: Record<string, unknown> = {};

    if (this.orderProvisioningServerType?.trim()) {
      requestedConfig['serverType'] = this.orderProvisioningServerType.trim();
    }

    this.orderPricingLoading = true;

    this.availabilityService.previewPricing({ planId, requestedConfig, addonIds: [...this.orderAddonIds] }).subscribe({
      next: (response) => {
        if (requestId !== this.orderPricingRequestId) {
          return;
        }

        this.orderPricingPreview.set(response);
        this.orderPricingLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (requestId !== this.orderPricingRequestId) {
          return;
        }

        this.orderPricingPreview.set(null);
        this.orderPricingLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  private syncOrderAddons(): void {
    const planId = this.orderPlanId.trim();
    this.orderAddons = [];
    this.orderAddonIds = new Set();
    this.orderAddonConfigs = {};

    if (!planId) {
      this.orderAddonsLoading = false;
      return;
    }

    this.orderAddonsLoading = true;
    this.servicePlansService
      .getOrderAddons(planId)
      .pipe(take(1))
      .subscribe({
        next: (addons) => {
          if (planId !== this.orderPlanId.trim()) return;

          this.orderAddons = addons.map((addon) => ({
            ...addon,
            orderFields: addon.orderFields ?? [],
          }));
          this.orderAddonsLoading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          if (planId !== this.orderPlanId.trim()) return;

          this.orderAddons = [];
          this.orderAddonsLoading = false;
          this.cdr.detectChanges();
        },
      });
  }

  private areOrderAddonConfigsReady(): boolean {
    for (const addonId of this.orderAddonIds) {
      const addon = this.orderAddons.find((entry) => entry.id === addonId);

      if (!addon?.orderFields?.length) {
        continue;
      }

      for (const field of addon.orderFields) {
        if (field.required && !(this.orderAddonConfigs[addonId]?.[field.key] ?? '').trim()) {
          return false;
        }
      }
    }

    return true;
  }

  private buildOrderAddonConfigs(): Record<string, Record<string, string>> | undefined {
    const result: Record<string, Record<string, string>> = {};

    for (const addonId of this.orderAddonIds) {
      const addon = this.orderAddons.find((entry) => entry.id === addonId);

      if (!addon?.orderFields?.length) {
        continue;
      }

      const env: Record<string, string> = {};

      for (const field of addon.orderFields) {
        const value = (this.orderAddonConfigs[addonId]?.[field.key] ?? '').trim();

        if (value || field.required) {
          env[field.key] = value;
        }
      }

      if (Object.keys(env).length > 0) {
        result[addonId] = env;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  showOrderProvisioningPicker(): boolean {
    return this.orderProvisioningOptions.length > 1;
  }

  showCustomOrderConfiguration(_plan: ServicePlanResponse | null | undefined): boolean {
    return this.getSelectedOrderProvisioningOption()?.type === 'custom';
  }

  showIntegratedOrderConfiguration(_plan: ServicePlanResponse | null | undefined): boolean {
    return this.getSelectedOrderProvisioningOption()?.type === 'integrated';
  }

  onOrderProvisioningOptionKeyChange(optionKey: string): void {
    this.orderProvisioningOptionKey = optionKey;
    const option = this.orderProvisioningOptions.find((entry) => entry.optionKey === optionKey);

    if (option) {
      this.applyOrderProvisioningOption(option);
    }
  }

  getSelectedOrderProvisioningOption(): OrderProvisioningOption | null {
    return this.orderProvisioningOptions.find((option) => option.optionKey === this.orderProvisioningOptionKey) ?? null;
  }

  isOrderProvisioningReady(): boolean {
    if (!this.orderPlanId?.trim()) {
      return false;
    }

    if (this.orderProvisioningOptionsLoading || this.orderProvisioningOptionsError) {
      return false;
    }

    if (this.showCustomOrderConfiguration(null)) {
      if (this.orderCustomOrderFieldsLoading || this.orderCustomOrderFieldsError) {
        return false;
      }

      for (const field of this.orderCustomOrderFields) {
        if (field.required && !(this.orderCustomEnv[field.key] ?? '').trim()) {
          return false;
        }
      }
    }

    if (this.orderProvisioningOptions.length > 1 && !this.orderProvisioningOptionKey.trim()) {
      return false;
    }

    return true;
  }

  /** Order fields carrying credentials are masked; the API never returns their values. */
  isSecretOrderField(field: CloudInitConfigOrderField): boolean {
    const key = field.key.toLowerCase();

    return key.includes('password') || key.includes('secret') || key.includes('token');
  }

  showOrderFieldDescription(field: CloudInitConfigOrderField): boolean {
    const description = field.description?.trim();

    if (!description) {
      return false;
    }

    return description.toLowerCase() !== field.label.trim().toLowerCase();
  }

  private syncOrderProvisioningOptions(): void {
    const planId = this.orderPlanId?.trim();
    const requestId = ++this.orderProvisioningRequestId;

    this.orderProvisioningOptions = [];
    this.orderProvisioningOptionKey = '';
    this.orderCustomOrderFields = [];
    this.orderCustomEnv = {};
    this.orderCustomOrderFieldsLoading = false;
    this.orderCustomOrderFieldsError = false;
    this.orderProvisioningOptionsError = false;

    if (!planId) {
      this.orderProvisioningOptionsLoading = false;

      return;
    }

    this.orderProvisioningOptionsLoading = true;

    this.servicePlansService.getOrderProvisioningOptions(planId).subscribe({
      next: (options) => {
        if (requestId !== this.orderProvisioningRequestId) {
          return;
        }

        this.orderProvisioningOptions = options;
        this.orderProvisioningOptionsLoading = false;
        this.orderProvisioningOptionsError = false;

        if (options.length > 0) {
          this.orderProvisioningOptionKey = options[0].optionKey;
          this.applyOrderProvisioningOption(options[0]);
        }

        this.clampOrderWizardStepIndex();
        this.cdr.detectChanges();
      },
      error: () => {
        if (requestId !== this.orderProvisioningRequestId) {
          return;
        }

        this.orderProvisioningOptionsLoading = false;
        this.orderProvisioningOptionsError = true;
        this.clampOrderWizardStepIndex();
        this.cdr.detectChanges();
      },
    });
  }

  private applyOrderProvisioningOption(option: OrderProvisioningOption): void {
    if (option.type === 'custom' && option.cloudInitConfigId?.trim()) {
      this.orderRequestedConfig = { ...this.orderRequestedConfig, service: 'custom' };
      this.loadCustomOrderFields(option.cloudInitConfigId.trim());

      return;
    }

    if (option.type === 'integrated' && option.service) {
      this.orderRequestedConfig = { ...this.orderRequestedConfig, service: option.service };

      if (option.service === 'agenstra-manager' && this.orderRequestedConfig.authenticationMethod === 'users') {
        this.orderRequestedConfig = { ...this.orderRequestedConfig, authenticationMethod: 'api-key' };
        this.authMethod.set('api-key');
      }

      this.orderCustomOrderFields = [];
      this.orderCustomEnv = {};
    }
  }

  private loadCustomOrderFields(configId: string): void {
    const planId = this.orderPlanId?.trim();

    if (!planId) {
      this.orderCustomOrderFields = [];
      this.orderCustomOrderFieldsLoading = false;
      this.orderCustomOrderFieldsError = false;

      return;
    }

    const requestId = ++this.orderCustomFieldsRequestId;

    this.orderCustomOrderFields = [];
    this.orderCustomEnv = {};
    this.orderCustomOrderFieldsLoading = true;
    this.orderCustomOrderFieldsError = false;

    this.servicePlansService.getCloudInitOrderFields(planId, configId).subscribe({
      next: (fields) => {
        if (requestId !== this.orderCustomFieldsRequestId) {
          return;
        }

        this.orderCustomOrderFields = fields;
        this.orderCustomEnv = Object.fromEntries(fields.map((field) => [field.key, '']));
        this.orderCustomOrderFieldsLoading = false;
        this.orderCustomOrderFieldsError = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (requestId !== this.orderCustomFieldsRequestId) {
          return;
        }

        this.orderCustomOrderFields = [];
        this.orderCustomOrderFieldsLoading = false;
        this.orderCustomOrderFieldsError = true;
        this.cdr.detectChanges();
      },
    });
  }

  private attachProvisioningOptionKey(requestedConfig: Record<string, unknown>): void {
    if (this.showOrderProvisioningPicker() && this.orderProvisioningOptionKey.trim()) {
      requestedConfig['provisioningOptionKey'] = this.orderProvisioningOptionKey.trim();
    }
  }

  private getProviderSchemaFullForOrder(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
  ): Record<string, unknown> | null {
    if (
      !serviceTypeId?.trim() ||
      isNoneServiceTypeId(serviceTypeId) ||
      !serviceTypes?.length ||
      !providerDetails?.length
    ) {
      return null;
    }

    const serviceType = serviceTypes.find((st) => st.id === serviceTypeId);

    if (!serviceType?.provider) return null;

    const detail = providerDetails.find((p) => p.id === serviceType.provider);

    return (detail?.configSchema as Record<string, unknown>) ?? null;
  }

  /**
   * Resolves geography field + enum options when the plan allows customer location selection.
   */
  private resolveOrderGeography(
    plan: ServicePlanResponse,
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
  ): { field: 'region' | 'location'; options: string[] } | null {
    if (!plan.allowCustomerLocationSelection) return null;

    const full = this.getProviderSchemaFullForOrder(serviceTypes, providerDetails, plan.serviceTypeId);
    const props = full?.['properties'] as Record<string, { type?: string; enum?: unknown[] }> | undefined;

    if (!props) return null;

    const pick = (key: 'region' | 'location'): { field: 'region' | 'location'; options: string[] } | null => {
      const p = props[key];

      if (!p || String(p.type) !== 'string' || !Array.isArray(p.enum)) return null;

      const options = p.enum.filter((x): x is string => typeof x === 'string');

      return options.length > 0 ? { field: key, options } : null;
    };

    return pick('region') ?? pick('location');
  }

  formatOrderLocationLabel(slug: string): string {
    return formatBillingProviderLocationLabel(slug, this.orderLocationCatalog);
  }

  private syncOrderProvisioningLocationState(): void {
    this.orderGeographyFieldKey = null;
    this.orderLocationOptions = [];
    this.orderProvisioningLocation = '';
    this.orderLocationCatalog = new Map();

    if (!this.orderPlanId?.trim()) return;

    combineLatest([
      this.servicePlans$,
      this.serviceTypesFacade.getServiceTypes$(),
      this.serviceTypesFacade.getProviderDetails$(),
    ])
      .pipe(take(1))
      .subscribe(([plans, serviceTypes, providerDetails]) => {
        const plan = plans.find((p) => p.id === this.orderPlanId);

        if (!plan) return;

        const resolved = this.resolveOrderGeography(plan, serviceTypes ?? [], providerDetails ?? []);

        if (!resolved) return;

        this.orderGeographyFieldKey = resolved.field;
        this.orderLocationOptions = resolved.options;
        const defaults = plan.providerConfigDefaults ?? {};
        const fromPlan = defaults[resolved.field];
        const fromPlanStr = typeof fromPlan === 'string' ? fromPlan : '';

        this.orderProvisioningLocation = resolved.options.includes(fromPlanStr)
          ? fromPlanStr
          : (resolved.options[0] ?? '');

        const serviceType = serviceTypes?.find((st) => st.id === plan.serviceTypeId);

        if (serviceType?.provider) {
          this.serviceTypesService
            .getProviderLocations(serviceType.provider, plan.serviceTypeId ?? undefined)
            .subscribe({
              next: (locations) => {
                this.orderLocationCatalog = providerLocationCatalogFromList(locations);
              },
              error: () => {
                this.orderLocationCatalog = new Map();
              },
            });
        }
      });
  }

  private syncOrderServerTypeState(): void {
    const requestId = ++this.orderServerTypesRequestId;

    this.orderProvisioningServerType = '';
    this.orderServerTypeOptions = [];
    this.orderServerTypesLoading = false;

    if (!this.orderPlanId?.trim()) return;

    combineLatest([
      this.servicePlans$,
      this.serviceTypesFacade.getServiceTypes$(),
      this.serviceTypesFacade.getProviderDetails$(),
    ])
      .pipe(take(1))
      .subscribe(([plans, serviceTypes, providerDetails]) => {
        if (requestId !== this.orderServerTypesRequestId) {
          return;
        }

        const plan = plans.find((p) => p.id === this.orderPlanId);

        if (
          !plan?.allowCustomerServerTypeSelection ||
          normalizeAllowedServerTypeIds(plan.allowedServerTypes).length === 0
        ) {
          return;
        }

        const serviceType = serviceTypes?.find((st) => st.id === plan.serviceTypeId);

        if (!serviceType?.provider) return;

        this.orderServerTypesLoading = true;
        const allowed = new Set(normalizeAllowedServerTypeIds(plan.allowedServerTypes));
        this.serviceTypesService
          .getProviderServerTypes(serviceType.provider, plan.serviceTypeId ?? undefined)
          .subscribe({
            next: (types) => {
              if (requestId !== this.orderServerTypesRequestId) {
                return;
              }

              this.orderServerTypeOptions = types.filter((st) => allowed.has(st.id));
              const defaults = plan.providerConfigDefaults ?? {};
              const fromPlan = defaults['serverType'];
              const fromPlanStr = typeof fromPlan === 'string' ? fromPlan : '';
              const options = this.orderServerTypeOptions.map((st) => st.id);

              this.orderProvisioningServerType = options.includes(fromPlanStr) ? fromPlanStr : (options[0] ?? '');
              this.orderServerTypesLoading = false;
              this.clampOrderWizardStepIndex();
              this.syncOrderPricingPreview();
              this.cdr.detectChanges();
            },
            error: () => {
              if (requestId !== this.orderServerTypesRequestId) {
                return;
              }

              this.orderServerTypeOptions = [];
              this.orderProvisioningServerType = '';
              this.orderServerTypesLoading = false;
              this.clampOrderWizardStepIndex();
              this.syncOrderPricingPreview();
              this.cdr.detectChanges();
            },
          });
      });
  }

  onSubmitOrderPlan(): void {
    if (
      !this.orderPlanId?.trim() ||
      !this.areOrderAddonConfigsReady() ||
      !this.isOrderProvisioningReady() ||
      !this.canSubmitOrderWithPromotion()
    ) {
      return;
    }

    const cfg = this.orderRequestedConfig;

    if (cfg.service === 'custom') {
      const env: Record<string, string> = {};

      for (const field of this.orderCustomOrderFields) {
        const value = (this.orderCustomEnv[field.key] ?? '').trim();

        if (value || field.required) {
          env[field.key] = value;
        }
      }

      const requestedConfig: Record<string, unknown> = {
        service: 'custom',
        env,
      };

      if (this.orderGeographyFieldKey && this.orderProvisioningLocation?.trim()) {
        requestedConfig[this.orderGeographyFieldKey] = this.orderProvisioningLocation.trim();
      }

      if (this.orderProvisioningServerType?.trim()) {
        requestedConfig['serverType'] = this.orderProvisioningServerType.trim();
      }

      this.attachProvisioningOptionKey(requestedConfig);

      const dto: CreateSubscriptionDto = this.withPromotionCode({
        planId: this.orderPlanId.trim(),
        addonIds: [...this.orderAddonIds],
        addonConfigs: this.buildOrderAddonConfigs(),
        requestedConfig,
        autoBackorder: this.orderAutoBackorder,
      });

      this.subscriptionsFacade.createSubscription(dto);

      return;
    }

    const requestedConfig: Record<string, unknown> = {
      service: cfg.service,
      authenticationMethod: cfg.authenticationMethod,
      smtp: { ...cfg.smtp },
    };

    if (cfg.service === 'agenstra-controller' || cfg.service === 'decabill-billing') {
      requestedConfig['disableSignup'] = cfg.disableSignup;
    }

    if (cfg.authenticationMethod === 'api-key' && cfg.staticApiKey?.trim()) {
      requestedConfig['staticApiKey'] = cfg.staticApiKey.trim();
    }

    if (cfg.authenticationMethod === 'keycloak') {
      requestedConfig['keycloak'] = { ...cfg.keycloak };
    }

    if (cfg.service === 'agenstra-controller' || cfg.service === 'decabill-billing') {
      if (cfg.hetznerApiToken?.trim()) {
        requestedConfig['hetznerApiToken'] = cfg.hetznerApiToken.trim();
      }

      if (cfg.digitaloceanApiToken?.trim()) {
        requestedConfig['digitaloceanApiToken'] = cfg.digitaloceanApiToken.trim();
      }
    }

    if (this.orderGeographyFieldKey && this.orderProvisioningLocation?.trim()) {
      requestedConfig[this.orderGeographyFieldKey] = this.orderProvisioningLocation.trim();
    }

    if (this.orderProvisioningServerType?.trim()) {
      requestedConfig['serverType'] = this.orderProvisioningServerType.trim();
    }

    if (cfg.service === 'agenstra-manager') {
      const gitSetupMode = cfg.git?.setupMode ?? 'clone';
      const hasGitCloneFields =
        (cfg.git?.repositoryUrl?.trim() ?? '') !== '' ||
        (cfg.git?.username?.trim() ?? '') !== '' ||
        (cfg.git?.token?.trim() ?? '') !== '' ||
        (cfg.git?.password?.trim() ?? '') !== '' ||
        (cfg.git?.privateKey?.trim() ?? '') !== '' ||
        (cfg.git?.commitAuthorName?.trim() ?? '') !== '' ||
        (cfg.git?.commitAuthorEmail?.trim() ?? '') !== '';

      if (gitSetupMode === 'empty' || hasGitCloneFields) {
        requestedConfig['git'] = {
          setupMode: gitSetupMode,
          ...(gitSetupMode === 'clone'
            ? {
                repositoryUrl: (cfg.git?.repositoryUrl ?? '').trim() || undefined,
                username: (cfg.git?.username ?? '').trim() || undefined,
                token: (cfg.git?.token ?? '').trim() || undefined,
                password: (cfg.git?.password ?? '').trim() || undefined,
                privateKey: (cfg.git?.privateKey ?? '').trim() || undefined,
                commitAuthorName: (cfg.git?.commitAuthorName ?? '').trim() || undefined,
                commitAuthorEmail: (cfg.git?.commitAuthorEmail ?? '').trim() || undefined,
              }
            : {}),
        };
      }

      if (cfg.cursorApiKey?.trim()) {
        requestedConfig['cursorApiKey'] = cfg.cursorApiKey.trim();
      }
    }

    this.attachProvisioningOptionKey(requestedConfig);

    const dto: CreateSubscriptionDto = this.withPromotionCode({
      planId: this.orderPlanId.trim(),
      addonIds: [...this.orderAddonIds],
      addonConfigs: this.buildOrderAddonConfigs(),
      requestedConfig,
      autoBackorder: this.orderAutoBackorder,
    });

    this.subscriptionsFacade.createSubscription(dto);
  }

  onOrderPromotionChange(): void {
    this.promotionsFacade.clearValidation();
  }

  clearOrderPromotionCheck(): void {
    this.promotionsFacade.clearValidation();
    this.orderPromotionCode.set('');
  }

  checkOrderPromotionCode(): void {
    const request = this.orderPromotionValidateRequest();

    if (!request) return;

    this.promotionsFacade.validatePromotion(request);
  }

  private canSubmitOrderWithPromotion(): boolean {
    if (!this.orderPromotionCode().trim()) return true;

    return this.orderPromotionCanProceed() === true;
  }

  private withPromotionCode(dto: CreateSubscriptionDto): CreateSubscriptionDto {
    const code = this.orderPromotionCode().trim();

    if (!code || !this.orderPromotionCanProceed()) return dto;

    const preview = this.orderPromotionValidationPreview();

    return {
      ...dto,
      promotionCode: code,
      promotionBenefitStartsAt: preview?.benefitStartsAt,
    };
  }

  canModifyConfiguration(sub: SubscriptionResponse): boolean {
    if (sub.status !== 'active') {
      return false;
    }

    const provisioningStatus = this.provisioningStatusForSubscription(sub.id);

    // First-time cloud provisioning must finish successfully before mid-life config changes.
    if (provisioningStatus === 'pending' || provisioningStatus === 'failed') {
      return false;
    }

    return true;
  }

  openModifyConfigModal(sub: SubscriptionResponse): void {
    if (!this.canModifyConfiguration(sub)) {
      return;
    }

    this.resetConfigChangeState();
    this.subscriptionToModify = sub;
    this.configChangeFacade.reset();
    this.configChangeFacade.loadEligibility(sub.id);
    this.loadConfigChangeAddons(sub.planId);

    this.configChangeFacade
      .getEligibility$()
      .pipe(
        filter((eligibility): eligibility is ConfigChangeEligibility => eligibility !== null),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((eligibility) => {
        if (this.subscriptionToModify?.id !== sub.id) {
          return;
        }

        this.configChangeServerType = eligibility.currentServerType?.trim() ?? '';
        this.configChangeSelectedAddonIds = new Set(eligibility.activeAddonIds);
        this.loadConfigChangeServerTypes(sub.planId, eligibility.allowedServerTypes);
        this.cdr.detectChanges();
      });

    showBillingModal(this.modifyConfigModal);
  }

  onModifyConfigModalHidden(): void {
    this.resetConfigChangeState();
    this.configChangeFacade.reset();
  }

  private resetConfigChangeState(): void {
    this.subscriptionToModify = null;
    this.configChangeServerType = '';
    this.configChangeServerTypeOptions = [];
    this.configChangeServerTypesLoading = false;
    this.configChangeAddons = [];
    this.configChangeAddonsLoading = false;
    this.configChangeSelectedAddonIds = new Set();
    this.configChangeAddonConfigs = {};
    this.configChangeWizardStepIndex.set(0);
    this.configChangeComplete.set(false);
    this.configChangeServerTypesRequestId++;
    this.configChangeAddonsRequestId++;
  }

  getConfigChangePlan(): ServicePlanResponse | null {
    const planId = this.subscriptionToModify?.planId;

    return planId ? (this.servicePlans().find((plan) => plan.id === planId) ?? null) : null;
  }

  private loadConfigChangeAddons(planId: string): void {
    const requestId = ++this.configChangeAddonsRequestId;

    this.configChangeAddons = [];
    this.configChangeAddonsLoading = true;

    this.servicePlansService
      .getOrderAddons(planId)
      .pipe(take(1))
      .subscribe({
        next: (addons) => {
          if (requestId !== this.configChangeAddonsRequestId) {
            return;
          }

          this.configChangeAddons = addons.map((addon) => ({ ...addon, orderFields: addon.orderFields ?? [] }));
          this.configChangeAddonsLoading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          if (requestId !== this.configChangeAddonsRequestId) {
            return;
          }

          this.configChangeAddons = [];
          this.configChangeAddonsLoading = false;
          this.cdr.detectChanges();
        },
      });
  }

  private loadConfigChangeServerTypes(planId: string, allowedServerTypes: string[]): void {
    const requestId = ++this.configChangeServerTypesRequestId;

    this.configChangeServerTypeOptions = [];

    if (allowedServerTypes.length === 0) {
      this.configChangeServerTypesLoading = false;

      return;
    }

    this.configChangeServerTypesLoading = true;

    combineLatest([this.servicePlans$, this.serviceTypesFacade.getServiceTypes$()])
      .pipe(take(1))
      .subscribe(([plans, serviceTypes]) => {
        const plan = plans.find((entry) => entry.id === planId);
        const serviceType = serviceTypes?.find((entry) => entry.id === plan?.serviceTypeId);

        if (!serviceType?.provider) {
          this.configChangeServerTypesLoading = false;
          this.cdr.detectChanges();

          return;
        }

        const allowed = new Set(allowedServerTypes);

        this.serviceTypesService.getProviderServerTypes(serviceType.provider, serviceType.id).subscribe({
          next: (types) => {
            if (requestId !== this.configChangeServerTypesRequestId) {
              return;
            }

            this.configChangeServerTypeOptions = types.filter((type) => allowed.has(type.id));
            this.configChangeServerTypesLoading = false;
            this.cdr.detectChanges();
          },
          error: () => {
            if (requestId !== this.configChangeServerTypesRequestId) {
              return;
            }

            this.configChangeServerTypeOptions = [];
            this.configChangeServerTypesLoading = false;
            this.cdr.detectChanges();
          },
        });
      });
  }

  configChangeHasServerTypeStep(): boolean {
    const eligibility = this.configChangeEligibility();
    const plan = this.getConfigChangePlan();

    if (!eligibility || !plan?.allowCustomerServerTypeSelection) {
      return false;
    }

    if (!eligibility.supportsServerTypeUpgrade && !eligibility.supportsServerTypeDowngrade) {
      return false;
    }

    return eligibility.allowedServerTypes.length > 0;
  }

  configChangeHasAddonsStep(): boolean {
    const eligibility = this.configChangeEligibility();

    if (!eligibility) {
      return false;
    }

    return eligibility.availableAddonIds.length > 0 || eligibility.activeAddonIds.length > 0;
  }

  getConfigChangeWizardSteps(): ConfigChangeWizardStep[] {
    const steps: ConfigChangeWizardStep[] = [];

    if (this.configChangeHasServerTypeStep()) {
      steps.push({
        id: 'serverType',
        label: $localize`:@@featureSubscriptions-configChangeStepServerType:Server type`,
      });
    }

    if (this.configChangeHasAddonsStep()) {
      steps.push({ id: 'addons', label: $localize`:@@featureSubscriptions-configChangeStepAddons:Addons` });
    }

    steps.push({ id: 'summary', label: $localize`:@@featureSubscriptions-configChangeStepSummary:Summary` });

    return steps;
  }

  getActiveConfigChangeStepId(): ConfigChangeWizardStepId {
    return this.getConfigChangeWizardSteps()[this.configChangeWizardStepIndex()]?.id ?? 'summary';
  }

  isConfigChangeStepActive(stepIndex: number): boolean {
    return !this.configChangeComplete() && stepIndex === this.configChangeWizardStepIndex();
  }

  isConfigChangeStepComplete(stepIndex: number): boolean {
    return this.configChangeComplete() || stepIndex < this.configChangeWizardStepIndex();
  }

  showConfigChangeBackButton(): boolean {
    return !this.configChangeComplete() && this.configChangeWizardStepIndex() > 0;
  }

  showConfigChangeNextButton(): boolean {
    return !this.configChangeComplete() && this.getActiveConfigChangeStepId() !== 'summary';
  }

  showConfigChangeSubmitButton(): boolean {
    return !this.configChangeComplete() && this.getActiveConfigChangeStepId() === 'summary';
  }

  canAdvanceConfigChangeStep(): boolean {
    switch (this.getActiveConfigChangeStepId()) {
      case 'serverType':
        return !this.configChangeServerTypesLoading;
      case 'addons':
        return !this.configChangeAddonsLoading && this.areConfigChangeAddonConfigsReady();
      default:
        return false;
    }
  }

  goConfigChangeNext(): void {
    if (!this.canAdvanceConfigChangeStep()) {
      return;
    }

    const maxIndex = this.getConfigChangeWizardSteps().length - 1;

    if (this.configChangeWizardStepIndex() < maxIndex) {
      this.configChangeWizardStepIndex.update((index) => index + 1);

      if (this.getActiveConfigChangeStepId() === 'summary') {
        this.syncConfigChangePreview();
      }
    }
  }

  goConfigChangeBack(): void {
    if (this.configChangeWizardStepIndex() > 0) {
      this.configChangeWizardStepIndex.update((index) => index - 1);
    }
  }

  configChangeServerTypeOptionLabel(serverType: ServerType): string {
    return this.formatCustomerServerTypeOptionLabel(serverType, this.getConfigChangePlan());
  }

  configChangeCurrentServerTypeLabel(): string {
    const current = this.configChangeEligibility()?.currentServerType?.trim();

    if (!current) {
      return '-';
    }

    const match = this.configChangeServerTypeOptions.find((option) => option.id === current);

    return match ? this.configChangeServerTypeOptionLabel(match) : current;
  }

  onConfigChangeServerTypeChange(): void {
    this.syncConfigChangePreview();
  }

  /** Addons the plan offers that are either active on the subscription or still available. */
  configChangeAddonOptions(): PlanAddonOptionDto[] {
    const eligibility = this.configChangeEligibility();

    if (!eligibility) {
      return [];
    }

    const selectable = new Set([...eligibility.activeAddonIds, ...eligibility.availableAddonIds]);

    return this.configChangeAddons.filter((addon) => selectable.has(addon.id));
  }

  isConfigChangeAddonActive(addonId: string): boolean {
    return this.configChangeEligibility()?.activeAddonIds.includes(addonId) === true;
  }

  isConfigChangeAddonSelected(addonId: string): boolean {
    return this.configChangeSelectedAddonIds.has(addonId);
  }

  isConfigChangeAddonAdded(addonId: string): boolean {
    return this.isConfigChangeAddonSelected(addonId) && !this.isConfigChangeAddonActive(addonId);
  }

  isConfigChangeAddonRemoved(addonId: string): boolean {
    return this.isConfigChangeAddonActive(addonId) && !this.isConfigChangeAddonSelected(addonId);
  }

  toggleConfigChangeAddon(addonId: string, checked: boolean): void {
    if (checked) {
      this.configChangeSelectedAddonIds.add(addonId);

      const addon = this.configChangeAddons.find((entry) => entry.id === addonId);

      if (!this.isConfigChangeAddonActive(addonId) && addon?.orderFields?.length) {
        this.configChangeAddonConfigs = {
          ...this.configChangeAddonConfigs,
          [addonId]: Object.fromEntries(addon.orderFields.map((field) => [field.key, ''])),
        };
      }
    } else {
      this.configChangeSelectedAddonIds.delete(addonId);

      const nextConfigs = { ...this.configChangeAddonConfigs };

      delete nextConfigs[addonId];
      this.configChangeAddonConfigs = nextConfigs;
    }

    this.syncConfigChangePreview();
  }

  showConfigChangeAddonFields(addon: PlanAddonOptionDto): boolean {
    return this.isConfigChangeAddonAdded(addon.id) && (addon.orderFields?.length ?? 0) > 0;
  }

  setConfigChangeAddonConfigValue(addonId: string, key: string, value: string): void {
    this.configChangeAddonConfigs = {
      ...this.configChangeAddonConfigs,
      [addonId]: {
        ...(this.configChangeAddonConfigs[addonId] ?? {}),
        [key]: value,
      },
    };
  }

  getConfigChangeAddonConfigValue(addonId: string, key: string): string {
    return this.configChangeAddonConfigs[addonId]?.[key] ?? '';
  }

  private areConfigChangeAddonConfigsReady(): boolean {
    for (const addon of this.configChangeAddonOptions()) {
      if (!this.isConfigChangeAddonAdded(addon.id)) {
        continue;
      }

      for (const field of addon.orderFields ?? []) {
        if (field.required && !(this.configChangeAddonConfigs[addon.id]?.[field.key] ?? '').trim()) {
          return false;
        }
      }
    }

    return true;
  }

  configChangeAddedAddons(): PlanAddonOptionDto[] {
    return this.configChangeAddonOptions().filter((addon) => this.isConfigChangeAddonAdded(addon.id));
  }

  configChangeRemovedAddons(): PlanAddonOptionDto[] {
    return this.configChangeAddonOptions().filter((addon) => this.isConfigChangeAddonRemoved(addon.id));
  }

  private buildConfigChangeRequest(): ConfigChangeRequest {
    const request: ConfigChangeRequest = {};
    const eligibility = this.configChangeEligibility();
    const targetServerType = this.configChangeServerType.trim();

    if (
      this.configChangeHasServerTypeStep() &&
      targetServerType &&
      targetServerType !== (eligibility?.currentServerType?.trim() ?? '')
    ) {
      request.serverType = targetServerType;
    }

    const addAddonIds = this.configChangeAddedAddons().map((addon) => addon.id);
    const removeAddonIds = this.configChangeRemovedAddons().map((addon) => addon.id);

    if (addAddonIds.length > 0) {
      request.addAddonIds = addAddonIds;

      const addonConfigs: Record<string, Record<string, string>> = {};

      for (const addon of this.configChangeAddedAddons()) {
        const values: Record<string, string> = {};

        for (const field of addon.orderFields ?? []) {
          const value = (this.configChangeAddonConfigs[addon.id]?.[field.key] ?? '').trim();

          if (value || field.required) {
            values[field.key] = value;
          }
        }

        if (Object.keys(values).length > 0) {
          addonConfigs[addon.id] = values;
        }
      }

      if (Object.keys(addonConfigs).length > 0) {
        request.addonConfigs = addonConfigs;
      }
    }

    if (removeAddonIds.length > 0) {
      request.removeAddonIds = removeAddonIds;
    }

    return request;
  }

  hasConfigChanges(): boolean {
    const request = this.buildConfigChangeRequest();

    return Boolean(request.serverType || request.addAddonIds?.length || request.removeAddonIds?.length);
  }

  private syncConfigChangePreview(): void {
    const subscriptionId = this.subscriptionToModify?.id;

    if (!subscriptionId || !this.hasConfigChanges()) {
      this.configChangeFacade.clearPreview();

      return;
    }

    this.configChangeFacade.preview(subscriptionId, this.buildConfigChangeRequest());
  }

  canSubmitConfigChange(): boolean {
    const eligibility = this.configChangeEligibility();

    return (
      eligibility?.canRequestChange === true &&
      this.hasConfigChanges() &&
      this.areConfigChangeAddonConfigsReady() &&
      !this.configChangeSubmitting()
    );
  }

  onSubmitConfigChange(): void {
    const subscriptionId = this.subscriptionToModify?.id;

    if (!subscriptionId || !this.canSubmitConfigChange()) {
      return;
    }

    this.configChangeFacade.submit(subscriptionId, this.buildConfigChangeRequest());
  }

  formatConfigChangeAmount(amount: number | null | undefined, currency?: string | null): string {
    if (amount == null || !Number.isFinite(amount)) {
      return '-';
    }

    const code = currency?.trim().toUpperCase() ?? '';

    if (!/^[A-Z]{3}$/.test(code)) {
      return this.formatCurrencyAmount(amount);
    }

    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount);
  }

  formatConfigChangeEffectiveAt(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }

    return this.datePipe.transform(value, 'medium') ?? '-';
  }

  /**
   * Maps stable backend codes to generic customer-facing messages.
   * Raw API messages are never surfaced; unknown codes fall back to a generic hint.
   */
  configChangeErrorMessage(code: ConfigChangeErrorCode | null | undefined): string {
    switch (code) {
      case 'CONFIG_CHANGE_NOT_ELIGIBLE':
        return $localize`:@@featureSubscriptions-configChangeErrorNotEligible:This subscription cannot be reconfigured right now. Please try again once any pending change has finished.`;
      case 'CONFIG_CHANGE_NOOP':
        return $localize`:@@featureSubscriptions-configChangeErrorNoop:Select at least one change before continuing.`;
      case 'CONFIG_CHANGE_SERVER_TYPE_UNSUPPORTED':
        return $localize`:@@featureSubscriptions-configChangeErrorServerTypeUnsupported:This server type change is not supported for your service.`;
      case 'CONFIG_CHANGE_SERVER_TYPE_LATERAL_UNSUPPORTED':
        return $localize`:@@featureSubscriptions-configChangeErrorServerTypeLateral:The selected server type costs the same as your current one. Choose a larger or a smaller server type.`;
      case 'CONFIG_CHANGE_ADDON_INVALID':
        return $localize`:@@featureSubscriptions-configChangeErrorAddonInvalid:One of the selected addons is not available for this subscription.`;
      case 'CONFIG_CHANGE_ADDON_CONFIG_IMMUTABLE':
        return $localize`:@@featureSubscriptions-configChangeErrorAddonConfigImmutable:The configuration of an addon that is already active cannot be changed here.`;
      case 'CONFIG_CHANGE_FAILED':
        return $localize`:@@featureSubscriptions-configChangeErrorFailed:The configuration change could not be applied. Please try again later.`;
      default:
        return $localize`:@@featureSubscriptions-configChangeErrorGeneric:The configuration change could not be processed. Please try again.`;
    }
  }

  configChangeEligibilityMessage(): string | null {
    if (this.configChangeEligibilityError()) {
      return this.configChangeErrorMessage(null);
    }

    const eligibility = this.configChangeEligibility();

    if (!eligibility || eligibility.canRequestChange) {
      return null;
    }

    return this.configChangeErrorMessage(eligibility.reasonCode ?? 'CONFIG_CHANGE_NOT_ELIGIBLE');
  }

  openCancelConfirm(sub: SubscriptionResponse): void {
    this.subscriptionToCancel = sub;
    showBillingModal(this.cancelSubscriptionModal);
  }

  confirmCancelSubscription(): void {
    if (!this.subscriptionToCancel) return;

    this.subscriptionsFacade.cancelSubscription(this.subscriptionToCancel.id);
  }

  openWithdrawConfirm(sub: SubscriptionResponse): void {
    this.subscriptionToWithdraw = sub;
    showBillingModal(this.withdrawSubscriptionModal);
  }

  confirmWithdrawSubscription(): void {
    if (!this.subscriptionToWithdraw) return;

    this.subscriptionsFacade.withdrawSubscription(this.subscriptionToWithdraw.id);
  }

  openResumeConfirm(sub: SubscriptionResponse): void {
    this.subscriptionToResume = sub;
    showBillingModal(this.resumeConfirmModal);
  }

  confirmResume(): void {
    if (!this.subscriptionToResume) return;

    this.subscriptionsFacade.resumeSubscription(this.subscriptionToResume.id);
  }

  retryBackorder(bo: BackorderResponse): void {
    this.backordersFacade.retryBackorder(bo.id);
  }

  openCancelBackorderConfirm(bo: BackorderResponse): void {
    this.backorderToCancel = bo;
    showBillingModal(this.cancelBackorderModal);
  }

  confirmCancelBackorder(): void {
    if (!this.backorderToCancel) return;

    this.backordersFacade.cancelBackorder(this.backorderToCancel.id);
  }

  openEditProfileModal(): void {
    showBillingModal(this.editProfileModal);

    combineLatest([
      this.customerProfileFacade.getCustomerProfile$(),
      this.customerProfileFacade.getCustomerProfileLoading$(),
    ])
      .pipe(
        filter(([, loading]) => !loading),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(([profile]) => {
        this.profileForm = {
          firstName: profile?.firstName ?? undefined,
          lastName: profile?.lastName ?? undefined,
          company: profile?.company ?? undefined,
          customerType: profile?.customerType ?? 'consumer',
          vatId: profile?.vatId ?? undefined,
          addressLine1: profile?.addressLine1 ?? undefined,
          addressLine2: profile?.addressLine2 ?? undefined,
          postalCode: profile?.postalCode ?? undefined,
          city: profile?.city ?? undefined,
          state: profile?.state ?? undefined,
          country: profile?.country?.trim() || DEFAULT_BILLING_COUNTRY_CODE,
          email: profile?.email ?? undefined,
          phone: profile?.phone ?? undefined,
        };
        this.cdr.detectChanges();
      });
  }

  onSubmitProfile(): void {
    this.customerProfileFacade.updateCustomerProfile(this.profileForm);
  }

  onSetupAutoBilling(): void {
    this.autoBillingSetupFeedback = null;
    this.customerProfileFacade.setupAutoBilling();
  }

  onEnableAutoBilling(): void {
    this.customerProfileFacade.enableAutoBilling();
  }

  onDisableAutoBilling(): void {
    this.customerProfileFacade.disableAutoBilling();
  }

  private startAutoBillingConfirmationPoll(): void {
    this.customerProfileFacade.loadCustomerProfile();

    interval(3000)
      .pipe(
        take(20),
        filter(() => this.autoBillingSetupFeedback === 'waiting'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.customerProfileFacade.loadCustomerProfile();
      });

    this.customerProfile$
      .pipe(
        filter((profile) => Boolean(profile?.hasPaymentMethodOnFile)),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.autoBillingSetupFeedback === 'waiting') {
          this.autoBillingSetupFeedback = 'confirmed';
          this.cdr.detectChanges();
        }
      });
  }

  private registerModalCloseWatchers(): void {
    this.subscriptionsCreating$
      .pipe(
        pairwise(),
        filter(([wasLoading, loading]) => wasLoading && !loading),
        withLatestFrom(this.subscriptionsError$),
        filter(([, error]) => !error),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.orderOrderComplete.set(true);
        this.cdr.detectChanges();
      });
    this.configChangeSubmitting$
      .pipe(
        pairwise(),
        filter(([wasSubmitting, submitting]) => wasSubmitting && !submitting),
        withLatestFrom(this.configChangeFacade.getSubmitError$()),
        filter(([, error]) => !error),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.configChangeComplete.set(true);
        this.subscriptionsFacade.loadSubscriptions();
        this.cdr.detectChanges();
      });
    watchBillingMutationModalClose({
      loading$: this.customerProfileUpdating$,
      error$: this.customerProfileError$,
      modal: () => this.editProfileModal,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.subscriptionsCanceling$,
      error$: this.subscriptionsError$,
      modal: () => this.cancelSubscriptionModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToCancel = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.subscriptionsWithdrawing$,
      error$: this.subscriptionsError$,
      modal: () => this.withdrawSubscriptionModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToWithdraw = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.subscriptionsResuming$,
      error$: this.subscriptionsError$,
      modal: () => this.resumeConfirmModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToResume = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.backordersCanceling$,
      error$: this.backordersError$,
      modal: () => this.cancelBackorderModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.backorderToCancel = null;
      },
    });
  }

  resetOrderRequestedConfig(): void {
    this.orderGeographyFieldKey = null;
    this.orderLocationOptions = [];
    this.orderProvisioningLocation = '';
    this.orderCustomOrderFields = [];
    this.orderCustomEnv = {};
    this.orderProvisioningOptions = [];
    this.orderProvisioningOptionKey = '';
    this.orderProvisioningOptionsLoading = false;
    this.orderProvisioningOptionsError = false;
    this.orderCustomOrderFieldsLoading = false;
    this.orderCustomOrderFieldsError = false;
    this.orderProvisioningRequestId++;
    this.orderCustomFieldsRequestId++;
    this.authMethod.set('users');
    this.orderRequestedConfig = {
      service: 'agenstra-controller',
      authenticationMethod: 'users',
      staticApiKey: '',
      disableSignup: false,
      smtp: {
        host: 'mailhog',
        port: 1025,
        user: '',
        password: '',
        from: 'noreply@localhost',
      },
      keycloak: {
        serverUrl: '',
        authServerUrl: '',
        realm: '',
        clientId: '',
        clientSecret: '',
      },
      hetznerApiToken: '',
      digitaloceanApiToken: '',
      git: {
        setupMode: 'clone',
        repositoryUrl: '',
        username: '',
        token: '',
        password: '',
        privateKey: '',
        commitAuthorName: '',
        commitAuthorEmail: '',
      },
      cursorApiKey: '',
    };
  }
}
