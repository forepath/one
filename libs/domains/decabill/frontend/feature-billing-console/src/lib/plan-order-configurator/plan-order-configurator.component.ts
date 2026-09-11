import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  OnInit,
  Output,
  EventEmitter,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AvailabilityService,
  ServicePlansFacade,
  ServicePlansService,
  ServiceTypesFacade,
  ServiceTypesService,
  mergeMandatoryOrderAddonIds,
  isAddonCompatibleWithProvider,
  normalizeAllowedProviders,
  normalizeAllowedServerTypeIds,
  formatBillingProviderLocationLabel,
  providerLocationCatalogFromList,
  type CloudInitConfigOrderField,
  type OrderProvisioningOption,
  type PlanAddonOptionDto,
  type PricingPreviewResponse,
  type ProviderDetail,
  type ProviderLocationCatalog,
  type ServicePlanResponse,
  type ServiceTypeResponse,
  type ServerType,
  isNoneServiceTypeId,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { combineLatest, filter, take } from 'rxjs';

import { getMeterAggregatorLabel, getProviderDisplayName } from '../billing-status-labels';
import type { OfferFormLineItem } from '../admin-offers-page/admin-offer-form.util';
import {
  buildPlanOrderAddonConfigs,
  buildPlanOrderRequestedConfig,
  createDefaultIntegratedOrderConfig,
  type IntegratedOrderFormConfig,
} from './plan-order-requested-config.util';

@Component({
  selector: 'framework-plan-order-configurator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './plan-order-configurator.component.html',
  styleUrls: ['./plan-order-configurator.component.scss'],
})
export class PlanOrderConfiguratorComponent implements OnInit, OnChanges, AfterViewInit {
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly servicePlansService = inject(ServicePlansService);
  private readonly serviceTypesFacade = inject(ServiceTypesFacade);
  private readonly serviceTypesService = inject(ServiceTypesService);
  private readonly availabilityService = inject(AvailabilityService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  private static readonly PRICE_CARD_WIDTH_PX = 256;
  private static readonly PRICE_CARD_GAP_PX = 16;
  private static readonly DESKTOP_BREAKPOINT = '(min-width: 992px)';

  @ViewChild('floatingPriceCard') private floatingPriceCard?: ElementRef<HTMLElement>;

  readonly showInlinePriceCard = signal(true);

  @Input({ required: true }) prefix!: string;
  @Input({ required: true }) lineIndex!: number;
  @Input({ required: true }) line!: OfferFormLineItem;
  @Input({ required: true }) planId!: string;

  @Output() pricingUpdated = new EventEmitter<void>();

  readonly servicePlans = toSignal(this.servicePlansFacade.getServicePlans$(), {
    initialValue: [] as ServicePlanResponse[],
  });
  readonly providerDetails = toSignal(this.serviceTypesFacade.getProviderDetails$(), {
    initialValue: [] as ProviderDetail[],
  });
  readonly serviceTypes = toSignal(this.serviceTypesFacade.getServiceTypes$(), {
    initialValue: [] as ServiceTypeResponse[],
  });

  addons: PlanAddonOptionDto[] = [];
  addonIds = new Set<string>();
  addonConfigs: Record<string, Record<string, string>> = {};
  addonsLoading = false;

  provisioningProvider = '';
  provisioningServerType = '';
  serverTypeOptions: ServerType[] = [];
  serverTypesLoading = false;

  geographyFieldKey: 'region' | 'location' | null = null;
  locationOptions: string[] = [];
  provisioningLocation = '';
  locationCatalog: ProviderLocationCatalog = new Map();

  provisioningOptions: OrderProvisioningOption[] = [];
  provisioningOptionKey = '';
  provisioningOptionsLoading = false;
  provisioningOptionsError = false;

  customOrderFields: CloudInitConfigOrderField[] = [];
  customEnv: Record<string, string> = {};
  customOrderFieldsLoading = false;
  customOrderFieldsError = false;

  integratedConfig: IntegratedOrderFormConfig = createDefaultIntegratedOrderConfig();
  authMethod = signal<'users' | 'api-key' | 'keycloak'>('users');

  readonly pricingPreview = signal<PricingPreviewResponse | null>(null);
  pricingLoading = false;

  readonly fieldDefaultPlaceholder = 'Uses a pre-configured default if left empty';
  readonly invalidAddonLabel = $localize`:@@featureSubscriptions-orderInvalidAddonLabel:Not available for the selected provider`;

  private provisioningRequestId = 0;
  private customFieldsRequestId = 0;
  private pricingRequestId = 0;
  private serverTypesRequestId = 0;
  private locationRequestId = 0;
  private hydratedPlanId = '';

  ngOnInit(): void {
    if (this.servicePlans().length === 0) {
      this.servicePlansFacade.loadServicePlans();
    }

    this.serviceTypesFacade.loadServiceTypes();
    this.serviceTypesFacade.loadProviderDetails();
    this.bootstrapFromLine();
  }

  ngAfterViewInit(): void {
    this.bindFloatingPriceCardLayout();
    queueMicrotask(() => this.updateFloatingPriceCardLayout());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['planId'] && !changes['planId'].firstChange) {
      this.bootstrapFromLine();
    }

    if (changes['line'] && !changes['line'].firstChange && !changes['planId']) {
      this.bootstrapFromLine();
    }

    if (changes['planId'] || changes['line']) {
      queueMicrotask(() => this.updateFloatingPriceCardLayout());
    }
  }

  onPlanIdChange(): void {
    this.resetTransientState();
    this.syncProviderState();
    this.syncLocationState();
    this.syncServerTypeState();
    this.syncProvisioningOptions();
    this.syncAddons();
    this.syncLineState();
    this.syncPricingPreview();
  }

  selectedPlan(): ServicePlanResponse | null {
    return this.servicePlans().find((plan) => plan.id === this.line.planId.trim()) ?? null;
  }

  hasProviderSelection(): boolean {
    return this.selectedPlan()?.allowCustomerProviderSelection === true;
  }

  providerOptions(): string[] {
    const plan = this.selectedPlan();

    if (!plan?.allowCustomerProviderSelection) {
      return [];
    }

    return this.resolvePlanAllowedProviders(plan);
  }

  providerLabel(providerId: string): string {
    return getProviderDisplayName(providerId, this.providerDetails());
  }

  hasInfrastructureSection(): boolean {
    const plan = this.selectedPlan();

    if (!plan) {
      return false;
    }

    if (this.hasProviderSelection()) {
      return true;
    }

    if (plan.allowCustomerServerTypeSelection && normalizeAllowedServerTypeIds(plan.allowedServerTypes).length > 0) {
      return true;
    }

    return plan.allowCustomerLocationSelection;
  }

  hasConfigurationSection(): boolean {
    if (!this.line.planId.trim()) {
      return false;
    }

    if (this.provisioningOptionsLoading || this.provisioningOptionsError) {
      return true;
    }

    if (this.provisioningOptions.length === 0) {
      return this.selectedAddonsWithConfigFields().length > 0;
    }

    if (this.showProvisioningPicker()) {
      return true;
    }

    if (this.showCustomConfiguration()) {
      return this.customOrderFieldsLoading || this.customOrderFieldsError || this.customOrderFields.length > 0;
    }

    return this.showIntegratedConfiguration();
  }

  showProvisioningPicker(): boolean {
    return this.provisioningOptions.length > 1;
  }

  showCustomConfiguration(): boolean {
    return this.getSelectedProvisioningOption()?.type === 'custom';
  }

  showIntegratedConfiguration(): boolean {
    return this.getSelectedProvisioningOption()?.type === 'integrated';
  }

  getSelectedProvisioningOption(): OrderProvisioningOption | null {
    return this.provisioningOptions.find((option) => option.optionKey === this.provisioningOptionKey) ?? null;
  }

  isAddonSelected(addonId: string): boolean {
    return this.addonIds.has(addonId);
  }

  isAddonMandatory(addonId: string): boolean {
    return this.addons.find((addon) => addon.id === addonId)?.mandatory === true;
  }

  isAddonInvalid(addonId: string): boolean {
    const addon = this.addons.find((entry) => entry.id === addonId);

    if (!addon || !this.isAddonSelected(addonId)) {
      return false;
    }

    const provider = this.hasProviderSelection() ? this.provisioningProvider : '';

    return !isAddonCompatibleWithProvider(addon, provider);
  }

  toggleAddon(addonId: string, checked: boolean): void {
    if (!checked && this.isAddonMandatory(addonId)) {
      return;
    }

    if (checked) {
      this.addonIds.add(addonId);
      const addon = this.addons.find((entry) => entry.id === addonId);

      if (addon?.orderFields?.length) {
        this.addonConfigs = {
          ...this.addonConfigs,
          [addonId]: Object.fromEntries(addon.orderFields.map((field) => [field.key, ''])),
        };
      }
    } else {
      this.addonIds.delete(addonId);
      const nextConfigs = { ...this.addonConfigs };

      delete nextConfigs[addonId];
      this.addonConfigs = nextConfigs;
    }

    this.syncLineState();
    this.syncPricingPreview();
  }

  getAddonConfigValue(addonId: string, key: string): string {
    return this.addonConfigs[addonId]?.[key] ?? '';
  }

  setAddonConfigValue(addonId: string, key: string, value: string): void {
    this.addonConfigs = {
      ...this.addonConfigs,
      [addonId]: {
        ...(this.addonConfigs[addonId] ?? {}),
        [key]: value,
      },
    };
    this.syncLineState();
  }

  selectedAddonsWithConfigFields(): PlanAddonOptionDto[] {
    return this.addons.filter((addon) => this.isAddonSelected(addon.id) && (addon.orderFields?.length ?? 0) > 0);
  }

  onProviderChange(): void {
    const plan = this.selectedPlan();
    const willReloadServerTypes =
      plan?.allowCustomerServerTypeSelection === true &&
      normalizeAllowedServerTypeIds(plan.allowedServerTypes).length > 0;

    this.syncServerTypeState();
    this.syncLocationState();

    if (!willReloadServerTypes) {
      this.syncPricingPreview();
    }

    this.syncLineState();
  }

  onServerTypeChange(): void {
    this.syncLineState();
    this.syncPricingPreview();
  }

  onLocationChange(): void {
    this.syncLineState();
    this.syncPricingPreview();
  }

  onProvisioningOptionKeyChange(optionKey: string): void {
    this.provisioningOptionKey = optionKey;
    const option = this.provisioningOptions.find((entry) => entry.optionKey === optionKey);

    if (option) {
      this.applyProvisioningOption(option);
    }

    this.syncLineState();
    this.syncPricingPreview();
  }

  onIntegratedFieldChange(): void {
    this.syncLineState();
    this.syncPricingPreview();
  }

  onServiceChange(value: IntegratedOrderFormConfig['service']): void {
    this.integratedConfig = { ...this.integratedConfig, service: value };

    if (value === 'agenstra-manager' && this.integratedConfig.authenticationMethod === 'users') {
      this.integratedConfig = { ...this.integratedConfig, authenticationMethod: 'api-key' };
      this.authMethod.set('api-key');
    }

    this.syncLineState();
    this.syncPricingPreview();
  }

  onAuthMethodChange(value: IntegratedOrderFormConfig['authenticationMethod']): void {
    this.integratedConfig = { ...this.integratedConfig, authenticationMethod: value };
    this.authMethod.set(value);
    this.syncLineState();
  }

  onGitSetupModeChange(value: 'clone' | 'empty'): void {
    this.integratedConfig = {
      ...this.integratedConfig,
      git: { ...this.integratedConfig.git, setupMode: value },
    };
    this.syncLineState();
  }

  isGitCloneMode(): boolean {
    return (this.integratedConfig.git.setupMode ?? 'clone') === 'clone';
  }

  isSecretOrderField(field: CloudInitConfigOrderField): boolean {
    const key = field.key.toLowerCase();

    return key.includes('password') || key.includes('secret') || key.includes('token');
  }

  showFieldDescription(field: CloudInitConfigOrderField): boolean {
    const description = field.description?.trim();

    if (!description) {
      return false;
    }

    return description.toLowerCase() !== field.label.trim().toLowerCase();
  }

  formatCurrencyAmount(amount: number): string {
    return `€${amount.toFixed(2)}`;
  }

  formatServerTypeOptionLabel(st: ServerType): string {
    const price =
      st.priceMonthly != null && Number.isFinite(st.priceMonthly)
        ? ` - ${this.formatCurrencyAmount(st.priceMonthly)}`
        : '';

    return `${st.name}${price}`;
  }

  formatLocationLabel(slug: string): string {
    return formatBillingProviderLocationLabel(slug, this.locationCatalog);
  }

  meterAggregatorLabel(aggregator: string): string {
    return getMeterAggregatorLabel(aggregator);
  }

  formatMeterPrice(meter: { effectiveUnitPriceNet: number; unitLabel?: string | null }): string {
    const price = this.formatCurrencyAmount(meter.effectiveUnitPriceNet);
    const unit = meter.unitLabel?.trim();

    return unit ? `${price} / ${unit}` : price;
  }

  fieldId(suffix: string): string {
    return `${this.prefix}PlanOrder${this.lineIndex}${suffix}`;
  }

  private bootstrapFromLine(): void {
    const planId = this.planId.trim();

    if (!planId) {
      this.resetTransientState();

      return;
    }

    if (this.hydratedPlanId !== planId) {
      this.hydrateFromLine();
      this.hydratedPlanId = planId;
    }

    this.onPlanIdChange();
  }

  private hydrateFromLine(): void {
    this.addonIds = new Set(this.line.addonIds ?? []);
    this.addonConfigs = structuredClone(this.line.addonConfigs ?? {});

    const config = this.line.requestedConfig ?? {};
    const service = config['service'];

    if (service === 'custom') {
      this.integratedConfig = { ...createDefaultIntegratedOrderConfig(), service: 'custom' };
      const env = config['env'];

      if (env && typeof env === 'object' && !Array.isArray(env)) {
        this.customEnv = Object.fromEntries(
          Object.entries(env as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]),
        );
      }
    } else if (service === 'agenstra-controller' || service === 'agenstra-manager' || service === 'decabill-billing') {
      this.integratedConfig = this.mergeIntegratedConfigFromSnapshot(config);
    } else {
      this.integratedConfig = createDefaultIntegratedOrderConfig();
    }

    this.authMethod.set(this.integratedConfig.authenticationMethod);
    this.provisioningProvider = typeof config['provider'] === 'string' ? config['provider'] : '';
    this.provisioningServerType = typeof config['serverType'] === 'string' ? config['serverType'] : '';

    if (typeof config['region'] === 'string' && config['region'].trim()) {
      this.geographyFieldKey = 'region';
      this.provisioningLocation = config['region'];
    } else if (typeof config['location'] === 'string' && config['location'].trim()) {
      this.geographyFieldKey = 'location';
      this.provisioningLocation = config['location'];
    }

    this.provisioningOptionKey =
      typeof config['provisioningOptionKey'] === 'string' ? config['provisioningOptionKey'] : '';
  }

  private mergeIntegratedConfigFromSnapshot(config: Record<string, unknown>): IntegratedOrderFormConfig {
    const defaults = createDefaultIntegratedOrderConfig();
    const smtp = config['smtp'];
    const keycloak = config['keycloak'];
    const git = config['git'];

    return {
      ...defaults,
      service: config['service'] as IntegratedOrderFormConfig['service'],
      authenticationMethod:
        (config['authenticationMethod'] as IntegratedOrderFormConfig['authenticationMethod']) ??
        defaults.authenticationMethod,
      staticApiKey: typeof config['staticApiKey'] === 'string' ? config['staticApiKey'] : defaults.staticApiKey,
      disableSignup: config['disableSignup'] === true,
      smtp:
        smtp && typeof smtp === 'object' && !Array.isArray(smtp)
          ? { ...defaults.smtp, ...(smtp as Partial<IntegratedOrderFormConfig['smtp']>) }
          : defaults.smtp,
      keycloak:
        keycloak && typeof keycloak === 'object' && !Array.isArray(keycloak)
          ? { ...defaults.keycloak, ...(keycloak as Partial<IntegratedOrderFormConfig['keycloak']>) }
          : defaults.keycloak,
      hetznerApiToken:
        typeof config['hetznerApiToken'] === 'string' ? config['hetznerApiToken'] : defaults.hetznerApiToken,
      digitaloceanApiToken:
        typeof config['digitaloceanApiToken'] === 'string'
          ? config['digitaloceanApiToken']
          : defaults.digitaloceanApiToken,
      git:
        git && typeof git === 'object' && !Array.isArray(git)
          ? { ...defaults.git, ...(git as Partial<IntegratedOrderFormConfig['git']>) }
          : defaults.git,
      cursorApiKey: typeof config['cursorApiKey'] === 'string' ? config['cursorApiKey'] : defaults.cursorApiKey,
    };
  }

  private resetTransientState(): void {
    this.addons = [];
    this.addonIds = new Set();
    this.addonConfigs = {};
    this.addonsLoading = false;
    this.provisioningProvider = '';
    this.provisioningServerType = '';
    this.serverTypeOptions = [];
    this.serverTypesLoading = false;
    this.geographyFieldKey = null;
    this.locationOptions = [];
    this.provisioningLocation = '';
    this.locationCatalog = new Map();
    this.provisioningOptions = [];
    this.provisioningOptionKey = '';
    this.provisioningOptionsLoading = false;
    this.provisioningOptionsError = false;
    this.customOrderFields = [];
    this.customEnv = {};
    this.customOrderFieldsLoading = false;
    this.customOrderFieldsError = false;
    this.integratedConfig = createDefaultIntegratedOrderConfig();
    this.authMethod.set('users');
    this.setPricingPreview(null);
    this.pricingLoading = false;
  }

  private setPricingPreview(value: PricingPreviewResponse | null): void {
    this.pricingPreview.set(value);
    this.pricingUpdated.emit();
  }

  private syncLineState(): void {
    this.line.addonIds = mergeMandatoryOrderAddonIds(this.addonIds, this.addons);
    this.line.requestedConfig = buildPlanOrderRequestedConfig({
      integrated: this.integratedConfig,
      customOrderFields: this.customOrderFields,
      customEnv: this.customEnv,
      provisioningOptionKey: this.provisioningOptionKey,
      showProvisioningPicker: this.showProvisioningPicker(),
      provisioningProvider: this.provisioningProvider,
      hasProviderSelection: this.hasProviderSelection(),
      geographyFieldKey: this.geographyFieldKey,
      provisioningLocation: this.provisioningLocation,
      provisioningServerType: this.provisioningServerType,
    });
    this.line.addonConfigs = buildPlanOrderAddonConfigs(this.addonIds, this.addons, this.addonConfigs) ?? {};
  }

  private syncAddons(): void {
    const planId = this.line.planId.trim();
    this.addons = [];

    if (!planId) {
      this.addonsLoading = false;

      return;
    }

    this.addonsLoading = true;
    this.servicePlansService
      .getOrderAddons(planId)
      .pipe(take(1))
      .subscribe({
        next: (addons) => {
          if (planId !== this.line.planId.trim()) {
            return;
          }

          this.addons = addons.map((addon) => ({
            ...addon,
            orderFields: addon.orderFields ?? [],
            mandatory: addon.mandatory === true,
            compatibleProviders: addon.compatibleProviders ?? [],
          }));
          this.addonIds = new Set(mergeMandatoryOrderAddonIds(this.addonIds, this.addons));
          this.addonsLoading = false;
          this.syncLineState();
          this.syncPricingPreview();
          this.cdr.detectChanges();
        },
        error: () => {
          if (planId !== this.line.planId.trim()) {
            return;
          }

          this.addons = [];
          this.addonsLoading = false;
          this.cdr.detectChanges();
        },
      });
  }

  private syncProvisioningOptions(): void {
    const planId = this.line.planId.trim();
    const requestId = ++this.provisioningRequestId;

    this.provisioningOptions = [];
    this.customOrderFields = [];
    this.customEnv = {};
    this.customOrderFieldsLoading = false;
    this.customOrderFieldsError = false;
    this.provisioningOptionsError = false;

    if (!planId) {
      this.provisioningOptionsLoading = false;

      return;
    }

    this.provisioningOptionsLoading = true;

    this.servicePlansService.getOrderProvisioningOptions(planId).subscribe({
      next: (options) => {
        if (requestId !== this.provisioningRequestId) {
          return;
        }

        this.provisioningOptions = options;
        this.provisioningOptionsLoading = false;
        this.provisioningOptionsError = false;

        if (options.length > 0) {
          const existing = options.find((option) => option.optionKey === this.provisioningOptionKey);
          const selected = existing ?? options[0];

          this.provisioningOptionKey = selected.optionKey;
          this.applyProvisioningOption(selected);
        }

        this.syncLineState();
        this.syncPricingPreview();
        this.cdr.detectChanges();
      },
      error: () => {
        if (requestId !== this.provisioningRequestId) {
          return;
        }

        this.provisioningOptionsLoading = false;
        this.provisioningOptionsError = true;
        this.cdr.detectChanges();
      },
    });
  }

  private applyProvisioningOption(option: OrderProvisioningOption): void {
    if (option.type === 'custom' && option.cloudInitConfigId?.trim()) {
      this.integratedConfig = { ...this.integratedConfig, service: 'custom' };
      this.loadCustomOrderFields(option.cloudInitConfigId.trim());

      return;
    }

    if (option.type === 'integrated' && option.service) {
      this.integratedConfig = {
        ...this.integratedConfig,
        service: option.service,
      };

      if (option.service === 'agenstra-manager' && this.integratedConfig.authenticationMethod === 'users') {
        this.integratedConfig = { ...this.integratedConfig, authenticationMethod: 'api-key' };
        this.authMethod.set('api-key');
      }

      this.customOrderFields = [];
      this.customEnv = {};
    }
  }

  private loadCustomOrderFields(configId: string): void {
    const planId = this.line.planId.trim();

    if (!planId) {
      return;
    }

    const requestId = ++this.customFieldsRequestId;

    this.customOrderFields = [];
    this.customEnv = {};
    this.customOrderFieldsLoading = true;
    this.customOrderFieldsError = false;

    this.servicePlansService.getCloudInitOrderFields(planId, configId).subscribe({
      next: (fields) => {
        if (requestId !== this.customFieldsRequestId) {
          return;
        }

        this.customOrderFields = fields;
        this.customEnv = Object.fromEntries(fields.map((field) => [field.key, this.customEnv[field.key] ?? '']));
        this.customOrderFieldsLoading = false;
        this.customOrderFieldsError = false;
        this.syncLineState();
        this.cdr.detectChanges();
      },
      error: () => {
        if (requestId !== this.customFieldsRequestId) {
          return;
        }

        this.customOrderFields = [];
        this.customOrderFieldsLoading = false;
        this.customOrderFieldsError = true;
        this.cdr.detectChanges();
      },
    });
  }

  private syncProviderState(): void {
    const plan = this.selectedPlan();

    if (!plan?.allowCustomerProviderSelection) {
      this.provisioningProvider = '';

      return;
    }

    const allowed = this.resolvePlanAllowedProviders(plan);

    if (allowed.length === 0) {
      this.provisioningProvider = '';

      return;
    }

    if (!allowed.includes(this.provisioningProvider.trim())) {
      this.provisioningProvider = allowed[0];
    }
  }

  private syncLocationState(): void {
    const planId = this.planId.trim();

    if (!planId) {
      return;
    }

    const requestId = ++this.locationRequestId;

    combineLatest([
      this.servicePlansFacade.getServicePlans$(),
      this.serviceTypesFacade.getServiceTypes$(),
      this.serviceTypesFacade.getProviderDetails$(),
      this.serviceTypesFacade.getServiceTypesLoading$(),
      this.serviceTypesFacade.getProviderDetailsLoading$(),
    ])
      .pipe(
        filter(
          ([, , , serviceTypesLoading, providerDetailsLoading]) => !serviceTypesLoading && !providerDetailsLoading,
        ),
        take(1),
      )
      .subscribe(([plans, serviceTypes, providerDetails]) => {
        if (requestId !== this.locationRequestId || planId !== this.planId.trim()) {
          return;
        }

        this.syncProviderState();

        const plan = plans.find((entry) => entry.id === planId);

        if (!plan) {
          this.geographyFieldKey = null;
          this.locationOptions = [];
          this.provisioningLocation = '';
          this.cdr.detectChanges();

          return;
        }

        const providerId = this.resolveOrderProviderId(plan, serviceTypes ?? []);
        const resolved = this.resolveOrderGeography(plan, serviceTypes ?? [], providerDetails ?? [], providerId);

        if (!resolved) {
          this.geographyFieldKey = null;
          this.locationOptions = [];
          this.provisioningLocation = '';
          this.cdr.detectChanges();

          return;
        }

        this.geographyFieldKey = resolved.field;
        this.locationOptions = resolved.options;

        if (!resolved.options.includes(this.provisioningLocation.trim())) {
          const defaults = plan.providerConfigDefaults ?? {};
          const fromPlan = this.resolvePlanDefaultGeography(defaults, providerId, resolved.field);

          this.provisioningLocation = resolved.options.includes(fromPlan) ? fromPlan : (resolved.options[0] ?? '');
        }

        if (providerId) {
          this.serviceTypesService.getProviderLocations(providerId, plan.serviceTypeId ?? undefined).subscribe({
            next: (locations) => {
              if (requestId !== this.locationRequestId) {
                return;
              }

              this.locationCatalog = providerLocationCatalogFromList(locations);
              this.cdr.detectChanges();
            },
            error: () => {
              if (requestId !== this.locationRequestId) {
                return;
              }

              this.locationCatalog = new Map();
              this.cdr.detectChanges();
            },
          });
        }

        this.syncLineState();
        this.cdr.detectChanges();
      });
  }

  private syncServerTypeState(): void {
    const requestId = ++this.serverTypesRequestId;
    const planId = this.line.planId.trim();

    this.serverTypeOptions = [];
    this.serverTypesLoading = false;

    if (!planId) {
      this.provisioningServerType = '';

      return;
    }

    combineLatest([
      this.servicePlansFacade.getServicePlans$(),
      this.serviceTypesFacade.getServiceTypes$(),
      this.serviceTypesFacade.getServiceTypesLoading$(),
    ])
      .pipe(
        filter(([, , serviceTypesLoading]) => !serviceTypesLoading),
        take(1),
      )
      .subscribe(([plans, serviceTypes]) => {
        if (requestId !== this.serverTypesRequestId || planId !== this.planId.trim()) {
          return;
        }

        this.syncProviderState();

        const plan = plans.find((entry) => entry.id === planId);

        if (
          !plan?.allowCustomerServerTypeSelection ||
          normalizeAllowedServerTypeIds(plan.allowedServerTypes).length === 0
        ) {
          this.provisioningServerType = '';

          return;
        }

        const providerId = this.resolveOrderProviderId(plan, serviceTypes ?? []);

        if (!providerId) {
          return;
        }

        this.serverTypesLoading = true;
        const allowed = new Set(normalizeAllowedServerTypeIds(plan.allowedServerTypes));

        this.serviceTypesService.getProviderServerTypes(providerId, plan.serviceTypeId ?? undefined).subscribe({
          next: (types) => {
            if (requestId !== this.serverTypesRequestId) {
              return;
            }

            this.serverTypeOptions = types.filter((entry) => allowed.has(entry.id));
            const defaults = plan.providerConfigDefaults ?? {};
            const fromPlan = this.resolvePlanDefaultServerType(defaults, providerId);
            const options = this.serverTypeOptions.map((entry) => entry.id);

            if (!options.includes(this.provisioningServerType.trim())) {
              this.provisioningServerType = options.includes(fromPlan) ? fromPlan : (options[0] ?? '');
            }

            this.serverTypesLoading = false;
            this.syncLineState();
            this.syncPricingPreview();
            this.cdr.detectChanges();
          },
          error: () => {
            if (requestId !== this.serverTypesRequestId) {
              return;
            }

            this.serverTypeOptions = [];
            this.provisioningServerType = '';
            this.serverTypesLoading = false;
            this.syncLineState();
            this.syncPricingPreview();
            this.cdr.detectChanges();
          },
        });
      });
  }

  private syncPricingPreview(): void {
    const planId = this.line.planId.trim();
    const requestId = ++this.pricingRequestId;

    if (!planId || this.serverTypesLoading) {
      if (!planId) {
        this.setPricingPreview(null);
        this.pricingLoading = false;
      }

      return;
    }

    this.syncLineState();
    this.pricingLoading = true;

    this.availabilityService
      .previewPricing({
        planId,
        requestedConfig: this.line.requestedConfig,
        addonIds: this.line.addonIds,
      })
      .subscribe({
        next: (response) => {
          if (requestId !== this.pricingRequestId) {
            return;
          }

          this.setPricingPreview(response);
          this.pricingLoading = false;
          this.updateFloatingPriceCardLayout();
          this.cdr.detectChanges();
        },
        error: () => {
          if (requestId !== this.pricingRequestId) {
            return;
          }

          this.setPricingPreview(null);
          this.pricingLoading = false;
          this.updateFloatingPriceCardLayout();
          this.cdr.detectChanges();
        },
      });
  }

  private resolvePlanAllowedProviders(plan: ServicePlanResponse): string[] {
    const serviceType = this.serviceTypes().find((entry) => entry.id === plan.serviceTypeId);
    const planAllowedRaw = normalizeAllowedProviders(plan.allowedProviders);

    if (!serviceType) {
      return planAllowedRaw;
    }

    const typeAllowed = this.resolveServiceTypeAllowedProviders(serviceType);
    const planAllowed = planAllowedRaw.filter((id) => typeAllowed.includes(id));

    if (plan.allowCustomerProviderSelection === true) {
      return planAllowed.length > 0 ? planAllowed : typeAllowed;
    }

    if (planAllowed.length > 0) {
      return planAllowed;
    }

    return typeAllowed[0] ? [typeAllowed[0]] : [];
  }

  private resolveServiceTypeAllowedProviders(serviceType: ServiceTypeResponse): string[] {
    const fromList = normalizeAllowedProviders(serviceType.allowedProviders);

    if (fromList.length > 0) {
      return fromList;
    }

    const primary = serviceType.provider?.trim();

    return primary ? [primary] : [];
  }

  private resolveOrderProviderId(plan: ServicePlanResponse, serviceTypes: ServiceTypeResponse[]): string | null {
    const allowed = this.resolvePlanAllowedProviders(plan);

    if (plan.allowCustomerProviderSelection === true && allowed.length > 0) {
      const chosen = this.provisioningProvider.trim();

      return allowed.includes(chosen) ? chosen : allowed[0];
    }

    return allowed[0] ?? null;
  }

  private resolvePlanDefaultServerType(
    defaults: Record<string, unknown>,
    providerId: string | null | undefined,
  ): string {
    const provider = providerId?.trim() ?? '';
    const byProvider = defaults['serverTypeByProvider'];

    if (provider && byProvider && typeof byProvider === 'object' && !Array.isArray(byProvider)) {
      const mapped = (byProvider as Record<string, unknown>)[provider];

      if (typeof mapped === 'string' && mapped.trim()) {
        return mapped.trim();
      }
    }

    const legacy = defaults['serverType'];

    return typeof legacy === 'string' ? legacy.trim() : '';
  }

  private resolvePlanDefaultGeography(
    defaults: Record<string, unknown>,
    providerId: string | null | undefined,
    field: 'region' | 'location',
  ): string {
    const provider = providerId?.trim() ?? '';
    const byProvider = defaults['geographyByProvider'];

    if (provider && byProvider && typeof byProvider === 'object' && !Array.isArray(byProvider)) {
      const mapped = (byProvider as Record<string, unknown>)[provider];

      if (typeof mapped === 'string' && mapped.trim()) {
        return mapped.trim();
      }
    }

    const fromField = defaults[field];

    return typeof fromField === 'string' ? fromField.trim() : '';
  }

  private resolveOrderGeography(
    plan: ServicePlanResponse,
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
    providerId?: string | null,
  ): { field: 'region' | 'location'; options: string[] } | null {
    if (!plan.allowCustomerLocationSelection) {
      return null;
    }

    const full = this.getProviderSchemaFull(serviceTypes, providerDetails, plan.serviceTypeId, providerId);
    const props = full?.['properties'] as Record<string, { type?: string; enum?: unknown[] }> | undefined;

    if (!props) {
      return null;
    }

    const pick = (key: 'region' | 'location'): { field: 'region' | 'location'; options: string[] } | null => {
      const property = props[key];

      if (!property || String(property.type) !== 'string' || !Array.isArray(property.enum)) {
        return null;
      }

      const options = property.enum.filter((value): value is string => typeof value === 'string');

      return options.length > 0 ? { field: key, options } : null;
    };

    return pick('region') ?? pick('location');
  }

  private getProviderSchemaFull(
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
    serviceTypeId: string | null | undefined,
    providerId?: string | null,
  ): Record<string, unknown> | null {
    if (
      !serviceTypeId?.trim() ||
      isNoneServiceTypeId(serviceTypeId) ||
      !serviceTypes.length ||
      !providerDetails.length
    ) {
      return null;
    }

    const serviceType = serviceTypes.find((entry) => entry.id === serviceTypeId);

    if (!serviceType) {
      return null;
    }

    const effectiveProviderId =
      providerId?.trim() ||
      normalizeAllowedProviders(serviceType.allowedProviders)[0] ||
      serviceType.provider?.trim() ||
      null;

    if (!effectiveProviderId) {
      return null;
    }

    const detail = providerDetails.find((entry) => entry.id === effectiveProviderId);

    return (detail?.configSchema as Record<string, unknown>) ?? null;
  }

  private bindFloatingPriceCardLayout(): void {
    const modal = this.host.nativeElement.closest('.modal');
    const modalContent = this.host.nativeElement.closest('.modal-content');
    const lineCard = this.host.nativeElement.closest('.admin-offer-line-card');
    const scrollTargets = this.collectModalScrollTargets();

    const update = (): void => {
      this.updateFloatingPriceCardLayout();
    };

    for (const scrollTarget of scrollTargets) {
      scrollTarget.addEventListener('scroll', update, { passive: true });
    }

    window.addEventListener('resize', update, { passive: true });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);

      if (modalContent) {
        observer.observe(modalContent);
      }

      for (const scrollTarget of scrollTargets) {
        observer.observe(scrollTarget);
      }

      if (lineCard) {
        observer.observe(lineCard);
      }

      this.destroyRef.onDestroy(() => observer.disconnect());
    }

    modal?.addEventListener('shown.bs.modal', update);

    this.destroyRef.onDestroy(() => {
      for (const scrollTarget of scrollTargets) {
        scrollTarget.removeEventListener('scroll', update);
      }

      window.removeEventListener('resize', update);
      modal?.removeEventListener('shown.bs.modal', update);
    });
  }

  private collectModalScrollTargets(): HTMLElement[] {
    const modal = this.host.nativeElement.closest('.modal') as HTMLElement | null;

    if (!modal) {
      return [];
    }

    const candidates = [modal, modal.querySelector('.modal-dialog'), modal.querySelector('.modal-body')].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );

    return candidates.filter((element, index, all) => all.indexOf(element) === index);
  }

  private updateFloatingPriceCardLayout(): void {
    const floating = this.floatingPriceCard?.nativeElement;
    const modalContent = this.host.nativeElement.closest('.modal-content') as HTMLElement | null;
    const modalBody = this.host.nativeElement.closest('.modal-body') as HTMLElement | null;
    const lineCard = this.host.nativeElement.closest('.admin-offer-line-card') as HTMLElement | null;

    if (!floating || !modalContent || !modalBody || !lineCard || !this.planId.trim()) {
      this.showInlinePriceCard.set(true);
      this.clearFloatingPriceCardStyles(floating);

      return;
    }

    const isDesktop = window.matchMedia(PlanOrderConfiguratorComponent.DESKTOP_BREAKPOINT).matches;
    const contentRect = modalContent.getBoundingClientRect();
    const bodyRect = modalBody.getBoundingClientRect();
    const lineRect = lineCard.getBoundingClientRect();
    const cardWidth = PlanOrderConfiguratorComponent.PRICE_CARD_WIDTH_PX;
    const gap = PlanOrderConfiguratorComponent.PRICE_CARD_GAP_PX;
    const hasRoom = contentRect.right + gap + cardWidth <= window.innerWidth - gap;
    const lineVisible = lineRect.bottom > bodyRect.top && lineRect.top < bodyRect.bottom;
    const useInline = !isDesktop || !hasRoom || bodyRect.height <= 0 || !lineVisible;

    this.showInlinePriceCard.set(useInline);

    if (useInline) {
      this.clearFloatingPriceCardStyles(floating);

      return;
    }

    const top = Math.max(lineRect.top, bodyRect.top + gap);
    const bottomLimit = Math.min(lineRect.bottom, bodyRect.bottom - gap);
    const maxHeight = Math.max(Math.min(bottomLimit - top, bodyRect.bottom - top - gap), 160);

    floating.style.position = 'fixed';
    floating.style.left = `${contentRect.right + gap}px`;
    floating.style.top = `${top}px`;
    floating.style.width = `${cardWidth}px`;
    floating.style.maxHeight = `${maxHeight}px`;
    floating.style.overflowY = 'auto';
    floating.style.zIndex = `${1060 + this.lineIndex}`;
  }

  private clearFloatingPriceCardStyles(floating?: HTMLElement): void {
    if (!floating) {
      return;
    }

    floating.style.position = '';
    floating.style.left = '';
    floating.style.top = '';
    floating.style.width = '';
    floating.style.maxHeight = '';
    floating.style.overflowY = '';
    floating.style.zIndex = '';
  }
}
