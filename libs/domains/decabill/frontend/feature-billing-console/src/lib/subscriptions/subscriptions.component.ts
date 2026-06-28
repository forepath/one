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
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BackordersFacade,
  CustomerProfileFacade,
  ServicePlansFacade,
  ServicePlansService,
  ServiceTypesFacade,
  SubscriptionsFacade,
  type BackorderResponse,
  type CloudInitConfigOrderField,
  type CreateSubscriptionDto,
  type CustomerProfileDto,
  type OrderProvisioningOption,
  type ProviderDetail,
  type ServicePlanResponse,
  type ServiceTypeResponse,
  type SubscriptionResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { combineLatest, filter, take } from 'rxjs';

import {
  getBackorderStatusBadgeClass,
  getBackorderStatusLabel,
  getProfileCompleteLabel,
  getSubscriptionStatusBadgeClass,
  getSubscriptionStatusLabel,
} from '../billing-status-labels';
import { filterItemsBySearch } from '../billing-list-search';
import {
  BILLING_COUNTRY_OPTIONS,
  DEFAULT_BILLING_COUNTRY_CODE,
  type BillingCountryOption,
} from '../billing-country-options';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

type CustomerPlansMobilePanel = 'subscriptions' | 'backorders';

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
  @ViewChild('cancelSubscriptionModal', { static: false }) private cancelSubscriptionModal!: ElementRef<HTMLDivElement>;
  @ViewChild('resumeConfirmModal', { static: false }) private resumeConfirmModal!: ElementRef<HTMLDivElement>;
  @ViewChild('cancelBackorderModal', { static: false }) private cancelBackorderModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editProfileModal', { static: false }) private editProfileModal!: ElementRef<HTMLDivElement>;

  private readonly subscriptionsFacade = inject(SubscriptionsFacade);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly servicePlansService = inject(ServicePlansService);
  private readonly serviceTypesFacade = inject(ServiceTypesFacade);
  private readonly backordersFacade = inject(BackordersFacade);
  private readonly customerProfileFacade = inject(CustomerProfileFacade);
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
  readonly subscriptionsResuming$ = this.subscriptionsFacade.getSubscriptionsResuming$();
  readonly backordersCanceling$ = this.backordersFacade.getBackordersCanceling$();

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
  private readonly destroyRef = inject(DestroyRef);

  private initialPlanIdFromQuery: string | null = null;

  orderPlanId = '';
  orderAutoBackorder = false;
  orderAcceptLegal = false;
  /** Canonical schema key for geography when customer may choose (region or location). */
  orderGeographyFieldKey: 'region' | 'location' | null = null;
  orderLocationOptions: string[] = [];
  orderProvisioningLocation = '';
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
  /** Signal for reactive conditional form fields; kept in sync with orderRequestedConfig.authenticationMethod. */
  authMethod = signal<'users' | 'api-key' | 'keycloak'>('users');

  onServiceChange(value: 'controller' | 'manager'): void {
    this.orderRequestedConfig = { ...this.orderRequestedConfig, service: value };

    if (value === 'manager' && this.orderRequestedConfig.authenticationMethod === 'users') {
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
    service: 'controller' | 'manager' | 'custom';
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
    service: 'controller',
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

  backorderStatusLabel(status: string | null | undefined): string {
    return getBackorderStatusLabel(status);
  }

  backorderStatusBadgeClass(status: string | null | undefined): string {
    return getBackorderStatusBadgeClass(status);
  }

  profileCompleteLabel(isComplete: boolean): string {
    return getProfileCompleteLabel(isComplete);
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
    if (!value) return '—';

    return this.datePipe.transform(value, 'shortDate') ?? '—';
  }

  formatSubscriptionPeriod(sub: SubscriptionResponse): string {
    if (!sub.currentPeriodStart || !sub.currentPeriodEnd) return '—';

    return `${this.formatDate(sub.currentPeriodStart)} – ${this.formatDate(sub.currentPeriodEnd)}`;
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
  getPlanTotalPrice(plan: ServicePlanResponse): number | null {
    const base = this.parsePlanNumber(plan.basePrice);

    if (base <= 0) return null;

    const marginPct = this.parsePlanNumber(plan.marginPercent);
    const marginFix = this.parsePlanNumber(plan.marginFixed);

    return base + base * (marginPct / 100) + marginFix;
  }

  private parsePlanNumber(value: string | number | null | undefined): number {
    if (value === undefined || value === null) return 0;

    const n = typeof value === 'number' ? value : Number(String(value).trim());

    return Number.isFinite(n) ? n : 0;
  }

  /** Formats plan price for display (e.g. "€4.51" or "—"). */
  formatPlanPrice(plan: ServicePlanResponse): string {
    const total = this.getPlanTotalPrice(plan);

    if (total === null) return '—';

    return `€${Number.isInteger(total) ? String(total) : total.toFixed(2)}`;
  }

  /** Option label for plan select: name + price + billing interval. */
  formatPlanOptionLabel(plan: ServicePlanResponse): string {
    const price = this.formatPlanPrice(plan);
    const interval = `${plan.billingIntervalValue} ${plan.billingIntervalType}(s)`;

    return `${plan.name} – ${price} / ${interval}`;
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

    if (profileParam === 'true') {
      this.openEditProfileModal();
    }
  }

  openOrderPlanModal(preferredPlanId?: string | null): void {
    this.orderPlanId = '';
    this.orderAutoBackorder = true;
    this.orderAcceptLegal = false;
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
            this.syncOrderProvisioningOptions();

            return;
          }
        }

        this.orderPlanId = plans[0].id;
        this.syncOrderProvisioningLocationState();
        this.syncOrderProvisioningOptions();
      });
    showBillingModal(this.orderPlanModal);
  }

  onOrderPlanIdChange(): void {
    this.syncOrderProvisioningLocationState();
    this.syncOrderProvisioningOptions();
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
    }

    if (this.orderProvisioningOptions.length > 1 && !this.orderProvisioningOptionKey.trim()) {
      return false;
    }

    return true;
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

        this.cdr.detectChanges();
      },
      error: () => {
        if (requestId !== this.orderProvisioningRequestId) {
          return;
        }

        this.orderProvisioningOptionsLoading = false;
        this.orderProvisioningOptionsError = true;
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

      if (option.service === 'manager' && this.orderRequestedConfig.authenticationMethod === 'users') {
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
    serviceTypeId: string,
  ): Record<string, unknown> | null {
    if (!serviceTypeId?.trim() || !serviceTypes?.length || !providerDetails?.length) return null;

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

  private syncOrderProvisioningLocationState(): void {
    this.orderGeographyFieldKey = null;
    this.orderLocationOptions = [];
    this.orderProvisioningLocation = '';

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
      });
  }

  onSubmitOrderPlan(): void {
    if (!this.orderPlanId?.trim() || !this.isOrderProvisioningReady()) return;

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

      this.attachProvisioningOptionKey(requestedConfig);

      const dto: CreateSubscriptionDto = {
        planId: this.orderPlanId.trim(),
        requestedConfig,
        autoBackorder: this.orderAutoBackorder,
      };

      this.subscriptionsFacade.createSubscription(dto);

      return;
    }

    const requestedConfig: Record<string, unknown> = {
      service: cfg.service,
      authenticationMethod: cfg.authenticationMethod,
      smtp: { ...cfg.smtp },
    };

    if (cfg.service === 'controller') {
      requestedConfig['disableSignup'] = cfg.disableSignup;
    }

    if (cfg.authenticationMethod === 'api-key' && cfg.staticApiKey?.trim()) {
      requestedConfig['staticApiKey'] = cfg.staticApiKey.trim();
    }

    if (cfg.authenticationMethod === 'keycloak') {
      requestedConfig['keycloak'] = { ...cfg.keycloak };
    }

    if (cfg.service === 'controller') {
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

    if (cfg.service === 'manager') {
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

    const dto: CreateSubscriptionDto = {
      planId: this.orderPlanId.trim(),
      requestedConfig,
      autoBackorder: this.orderAutoBackorder,
    };

    this.subscriptionsFacade.createSubscription(dto);
  }

  openCancelConfirm(sub: SubscriptionResponse): void {
    this.subscriptionToCancel = sub;
    showBillingModal(this.cancelSubscriptionModal);
  }

  confirmCancelSubscription(): void {
    if (!this.subscriptionToCancel) return;

    this.subscriptionsFacade.cancelSubscription(this.subscriptionToCancel.id);
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

    this.customerProfileFacade
      .getCustomerProfile$()
      .pipe(take(1))
      .subscribe((profile) => {
        this.profileForm = {
          firstName: profile?.firstName ?? undefined,
          lastName: profile?.lastName ?? undefined,
          company: profile?.company ?? undefined,
          addressLine1: profile?.addressLine1 ?? undefined,
          addressLine2: profile?.addressLine2 ?? undefined,
          postalCode: profile?.postalCode ?? undefined,
          city: profile?.city ?? undefined,
          state: profile?.state ?? undefined,
          country: profile?.country?.trim() || DEFAULT_BILLING_COUNTRY_CODE,
          email: profile?.email ?? undefined,
          phone: profile?.phone ?? undefined,
        };
      });
  }

  onSubmitProfile(): void {
    this.customerProfileFacade.updateCustomerProfile(this.profileForm);
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.subscriptionsCreating$,
      error$: this.subscriptionsError$,
      modal: () => this.orderPlanModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.orderPlanId = '';
        this.orderAutoBackorder = true;
        this.orderAcceptLegal = false;
        this.resetOrderRequestedConfig();
      },
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
      service: 'controller',
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
