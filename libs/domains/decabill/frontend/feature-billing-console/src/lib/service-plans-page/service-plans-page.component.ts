import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ServicePlansFacade,
  ServiceTypesFacade,
  ServiceTypesService,
  CloudInitConfigsFacade,
  AddonsFacade,
  AdminBillingService,
  MetersFacade,
  ServicePlansService,
  CONTAINER_MANAGER_ADDON_KEY,
  buildProvisioningOptionsFromKeys,
  collectPlanProductEnvFields,
  formatServerTypeOption,
  formatServerTypeIdLabel,
  normalizeAllowedServerTypeIds,
  normalizeAllowedProviders,
  getNestedSchemaProperty,
  getObjectSchemaPropertyKeys,
  getProductProviderConfigKeys,
  getSchemaPropertyType,
  getServerProviderConfigKeys,
  humanizeConfigFieldKey,
  isObjectSchemaProperty,
  isSensitiveConfigFieldKey,
  planProvisioningOptionKeysFromDefaults,
  computeLineTotalsFromRate,
  rateForTaxCategory,
  type IntegratedProductService,
  type PlanProductEnvField,
  type BillingIntervalType,
  type AddonResponse,
  type AttachedMeterResponse,
  type CloudInitConfigResponse,
  type CreateServicePlanDto,
  type MeterResponse,
  type ProviderDetail,
  type ProviderLocation,
  type ServerType,
  type ServicePlanOrderingHighlight,
  type ServicePlanResponse,
  type ServiceTypeResponse,
  type TaxCategory,
  type TaxPreviewRates,
  type UpdateServicePlanDto,
  isNoneServiceTypeId,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import {
  formatProvisioningLocationLabel,
  providerLocationCatalogFromList,
  type ProviderLocationCatalog,
} from '@forepath/shared/frontend/util-provisioning-geography';
import {
  combineLatest,
  catchError,
  debounceTime,
  distinctUntilChanged,
  forkJoin,
  map,
  of,
  skip,
  switchMap,
  take,
} from 'rxjs';

import {
  getActiveStatusLabel,
  getActiveStatusTextClass,
  getBillingIntervalLabel,
  getProviderDisplayName,
  getUnavailableLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { optionalNumberInputValue } from '../optional-number-input.util';

/** Schema property: type, description, and optional enum for pre-defined values. */
interface ConfigSchemaProperty {
  type?: string;
  description?: string;
  enum?: (string | number)[];
  visible?: boolean;
  scope?: 'server' | 'product' | 'internal';
  productServices?: IntegratedProductService[];
  properties?: Record<string, ConfigSchemaProperty>;
}
/** Schema properties object: key -> property definition. */
type ConfigSchemaProperties = Record<string, ConfigSchemaProperty>;

interface ServerTypeProviderGroup {
  providerId: string;
  label: string;
  types: ServerType[];
}

@Component({
  selector: 'framework-billing-service-plans-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './service-plans-page.component.html',
  styleUrls: ['./service-plans-page.component.scss'],
})
export class ServicePlansPageComponent implements OnInit {
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteConfirmModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureServicePlans-title:Service Plans`;
  readonly addServicePlanAriaLabel = $localize`:@@featureServicePlans-add:Add service plan`;
  readonly searchPlaceholder = $localize`:@@featureServicePlans-searchPlaceholder:Search plans`;
  /** Native multi-selects keep Bootstrap `form-select` (ngValue + compareWith). */
  readonly formSelectClass = 'form-select';

  private readonly plansFacade = inject(ServicePlansFacade);
  private readonly typesFacade = inject(ServiceTypesFacade);
  private readonly cloudInitConfigsFacade = inject(CloudInitConfigsFacade);
  private readonly addonsFacade = inject(AddonsFacade);
  private readonly metersFacade = inject(MetersFacade);
  private readonly servicePlansService = inject(ServicePlansService);
  private readonly serviceTypesService = inject(ServiceTypesService);
  private readonly adminBillingService = inject(AdminBillingService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly createProductDefaultsExpanded = signal(false);
  readonly editProductDefaultsExpanded = signal(false);
  readonly showProductDefaultsLabel = $localize`:@@featureServicePlans-showProductDefaults:Show`;
  readonly hideProductDefaultsLabel = $localize`:@@featureServicePlans-hideProductDefaults:Hide`;
  readonly noneServiceTypeLabel = $localize`:@@featureServicePlans-noneType:None (no deployment)`;
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly servicePlans$ = combineLatest([
    this.plansFacade.getServicePlans$(),
    this.typesFacade.getServiceTypes$(),
  ]).pipe(map(([plans, serviceTypes]) => ({ plans, serviceTypes })));
  readonly serviceTypes$ = this.typesFacade.getServiceTypes$();
  readonly cloudInitConfigs$ = this.cloudInitConfigsFacade.getActiveCloudInitConfigs$();
  readonly activeAddons$ = this.addonsFacade.getActiveAddons$();
  readonly activeMeters$ = this.metersFacade.getActiveMeters$();
  /** Combined service types + provider details for template (single async). */
  readonly typesAndProviders$ = combineLatest([
    this.typesFacade.getServiceTypes$(),
    this.typesFacade.getProviderDetails$(),
  ]).pipe(map(([serviceTypes, providerDetails]) => ({ serviceTypes, providerDetails })));
  readonly loading$ = this.plansFacade.getServicePlansLoading$();
  readonly loadingAny$ = this.plansFacade.getServicePlansLoadingAny$();
  readonly error$ = this.plansFacade.getServicePlansError$();
  readonly creating$ = this.plansFacade.getServicePlansCreating$();
  readonly updating$ = this.plansFacade.getServicePlansUpdating$();
  readonly deleting$ = this.plansFacade.getServicePlansDeleting$();

  readonly billingIntervalTypes: BillingIntervalType[] = ['hour', 'day', 'month', 'year'];
  readonly taxRates = signal<TaxPreviewRates>({ standard: 19, reduced: 7 });
  readonly taxCategoryOptions = computed(() => {
    const rates = this.taxRates();

    return [
      { value: 'standard' as TaxCategory, label: `Standard (${rates.standard}%)` },
      { value: 'reduced' as TaxCategory, label: `Reduced (${rates.reduced}%)` },
    ];
  });

  createForm: CreateServicePlanDto = this.getDefaultCreateForm();
  editForm: UpdateServicePlanDto & { id: string } = this.getDefaultEditForm();
  createProvisioningOptionKeys = new Set<string>();
  editProvisioningOptionKeys = new Set<string>();
  editStaleCustomConfigIds: string[] = [];
  planToDelete: ServicePlanResponse | null = null;
  /** Plan currently being edited; used to resolve provider schema for edit form. */
  editingPlan: ServicePlanResponse | null = null;
  /** Server types for the current provider when config has basePriceFromField (e.g. serverType). */
  currentServerTypes: ServerType[] = [];
  /** When multi-provider + customer server-type selection, groups for optgroup UI. */
  currentServerTypeGroups: ServerTypeProviderGroup[] = [];
  createAllowedServerTypes: string[] = [];
  editAllowedServerTypes: string[] = [];
  createAllowedProviders: string[] = [];
  editAllowedProviders: string[] = [];
  serverTypesLoading = false;
  providerLocationCatalog: ProviderLocationCatalog = new Map();
  providerLocationCatalogs: Record<string, ProviderLocationCatalog> = {};
  providerLocationsLoading = false;
  createAttachedMeters: AttachedMeterResponse[] = [];
  editAttachedMeters: AttachedMeterResponse[] = [];
  createPlanMeterAttachMeterId = '';
  createPlanMeterAttachUnitPrice: string | number | null = '';
  createPlanMeterAttachIncludedUsage: string | number | null = '';
  editPlanMeterAttachMeterId = '';
  editPlanMeterAttachUnitPrice: string | number | null = '';
  editPlanMeterAttachIncludedUsage: string | number | null = '';
  planMeterAttachLoading = false;
  planMeterAttachError: string | null = null;

  serviceTypeNameById(types: ServiceTypeResponse[] | null, id: string | null | undefined): string {
    if (isNoneServiceTypeId(id)) {
      return this.noneServiceTypeLabel;
    }

    if (!types) return getUnavailableLabel();

    const serviceType = types.find((item) => item.id === id);

    return serviceType?.name?.trim() || getUnavailableLabel();
  }

  isNoneServiceType(serviceTypeId: string | null | undefined): boolean {
    return isNoneServiceTypeId(serviceTypeId);
  }

  billingIntervalLabel(plan: ServicePlanResponse): string {
    return getBillingIntervalLabel(plan.billingIntervalValue, plan.billingIntervalType);
  }

  activeStatusLabel(isActive: boolean): string {
    return getActiveStatusLabel(isActive);
  }

  activeStatusTextClass(isActive: boolean): string {
    return getActiveStatusTextClass(isActive);
  }

  private applyDefaultProvisioningOptionKeys(
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
    serviceTypeId: string | null | undefined,
    form: 'create' | 'edit',
  ): void {
    if (!this.supportsProvisioningOptionsSelection(serviceTypes, providerDetails, serviceTypeId, form)) {
      const target = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;

      target.clear();

      return;
    }

    const target = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;

    target.clear();

    if (this.serviceEnumIncludes(serviceTypes, providerDetails, serviceTypeId, 'agenstra-controller', form)) {
      target.add('integrated:agenstra-controller');
    }

    if (this.serviceEnumIncludes(serviceTypes, providerDetails, serviceTypeId, 'agenstra-manager', form)) {
      target.add('integrated:agenstra-manager');
    }

    if (this.serviceEnumIncludes(serviceTypes, providerDetails, serviceTypeId, 'decabill-billing', form)) {
      target.add('integrated:decabill-billing');
    }
  }

  private pruneInvalidProvisioningOptionKeys(
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
    serviceTypeId: string | null | undefined,
    form: 'create' | 'edit',
  ): void {
    const target = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;

    for (const optionKey of [...target]) {
      if (
        optionKey === 'integrated:agenstra-controller' &&
        !this.serviceEnumIncludes(serviceTypes, providerDetails, serviceTypeId, 'agenstra-controller', form)
      ) {
        target.delete(optionKey);
      }

      if (
        optionKey === 'integrated:agenstra-manager' &&
        !this.serviceEnumIncludes(serviceTypes, providerDetails, serviceTypeId, 'agenstra-manager', form)
      ) {
        target.delete(optionKey);
      }

      if (
        optionKey === 'integrated:decabill-billing' &&
        !this.serviceEnumIncludes(serviceTypes, providerDetails, serviceTypeId, 'decabill-billing', form)
      ) {
        target.delete(optionKey);
      }
    }
  }

  private pruneInactiveCustomProvisioningOptionKeys(
    configs: CloudInitConfigResponse[] | null,
    form: 'create' | 'edit',
  ): string[] {
    const activeIds = new Set((configs ?? []).map((cfg) => cfg.id));
    const target = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;
    const removed: string[] = [];

    for (const optionKey of [...target]) {
      if (!optionKey.startsWith('custom:')) {
        continue;
      }

      const configId = optionKey.slice('custom:'.length).trim();

      if (!configId || activeIds.has(configId)) {
        continue;
      }

      target.delete(optionKey);
      removed.push(configId);
    }

    return removed;
  }

  supportsProvisioningOptionsSelection(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): boolean {
    const schema = this.getProviderSchema(serviceTypes, providerDetails, serviceTypeId, form);
    const serviceEnum = this.getProviderConfigEnum(schema, 'service');

    if (!serviceEnum?.length) {
      return false;
    }

    return serviceEnum.some(
      (value) =>
        value === 'agenstra-controller' ||
        value === 'agenstra-manager' ||
        value === 'decabill-billing' ||
        value === 'controller' ||
        value === 'manager' ||
        value === 'custom',
    );
  }

  serviceEnumIncludes(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    value: string,
    form?: 'create' | 'edit',
  ): boolean {
    const schema = this.getProviderSchema(serviceTypes, providerDetails, serviceTypeId, form);
    const serviceEnum = this.getProviderConfigEnum(schema, 'service');

    if (!serviceEnum?.length) {
      return false;
    }

    if (serviceEnum.includes(value)) {
      return true;
    }

    // Accept legacy schema enums until provider rows are updated.
    if (value === 'agenstra-controller') {
      return serviceEnum.includes('controller');
    }

    if (value === 'agenstra-manager') {
      return serviceEnum.includes('manager');
    }

    return false;
  }

  isProvisioningOptionSelected(form: 'create' | 'edit', optionKey: string): boolean {
    return (form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys).has(optionKey);
  }

  toggleProvisioningOption(form: 'create' | 'edit', optionKey: string, checked: boolean): void {
    const target = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;

    if (checked) {
      target.add(optionKey);
    } else {
      target.delete(optionKey);
    }

    this.syncContainerManagerMandatoryForIntegrated(form);
  }

  isAddonSelected(form: 'create' | 'edit', addonId: string): boolean {
    const defaults = form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults;
    const selected = defaults?.['allowedAddonIds'];

    return Array.isArray(selected) && selected.includes(addonId);
  }

  isAddonMandatory(form: 'create' | 'edit', addonId: string): boolean {
    const defaults = form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults;
    const selected = defaults?.['mandatoryAddonIds'];

    return Array.isArray(selected) && selected.includes(addonId);
  }

  toggleAddon(form: 'create' | 'edit', addonId: string, checked: boolean): void {
    if (!checked && this.isAddonMandatory(form, addonId)) {
      return;
    }

    const target = form === 'create' ? this.createForm : this.editForm;
    target.providerConfigDefaults = target.providerConfigDefaults ?? {};
    const current = Array.isArray(target.providerConfigDefaults['allowedAddonIds'])
      ? (target.providerConfigDefaults['allowedAddonIds'] as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const next = checked ? [...new Set([...current, addonId])] : current.filter((id) => id !== addonId);

    if (next.length > 0) {
      target.providerConfigDefaults['allowedAddonIds'] = next;
    } else {
      delete target.providerConfigDefaults['allowedAddonIds'];
    }

    if (!checked) {
      this.toggleMandatoryAddon(form, addonId, false);
    }
  }

  isAddonMandatoryLocked(form: 'create' | 'edit', addon: AddonResponse): boolean {
    if (addon.key !== CONTAINER_MANAGER_ADDON_KEY) {
      return false;
    }

    return this.isIntegratedProvisioningSelected(form);
  }

  toggleMandatoryAddon(form: 'create' | 'edit', addonId: string, checked: boolean): void {
    const target = form === 'create' ? this.createForm : this.editForm;
    target.providerConfigDefaults = target.providerConfigDefaults ?? {};

    if (checked) {
      this.toggleAddon(form, addonId, true);
    } else if (this.isIntegratedProvisioningSelected(form)) {
      let locked = false;

      this.addonsFacade
        .getActiveAddons$()
        .pipe(take(1))
        .subscribe((addons) => {
          const addon = (addons ?? []).find((entry) => entry.id === addonId);

          locked = !!addon && this.isAddonMandatoryLocked(form, addon);
        });

      if (locked) {
        return;
      }
    }

    const current = Array.isArray(target.providerConfigDefaults['mandatoryAddonIds'])
      ? (target.providerConfigDefaults['mandatoryAddonIds'] as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const next = checked ? [...new Set([...current, addonId])] : current.filter((id) => id !== addonId);

    if (next.length > 0) {
      target.providerConfigDefaults['mandatoryAddonIds'] = next;
    } else {
      delete target.providerConfigDefaults['mandatoryAddonIds'];
    }
  }

  private isIntegratedProvisioningSelected(form: 'create' | 'edit'): boolean {
    const optionKeys = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;

    return [...optionKeys].some((key) => key.startsWith('integrated:'));
  }

  private syncContainerManagerMandatoryForIntegrated(form: 'create' | 'edit'): void {
    const optionKeys = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;
    const hasIntegrated = [...optionKeys].some((key) => key.startsWith('integrated:'));

    if (!hasIntegrated) {
      return;
    }

    this.addonsFacade
      .getActiveAddons$()
      .pipe(take(1))
      .subscribe((addons) => {
        const containerManager = (addons ?? []).find((addon) => addon.key === CONTAINER_MANAGER_ADDON_KEY);

        if (!containerManager) {
          return;
        }

        this.toggleAddon(form, containerManager.id, true);
        this.toggleMandatoryAddon(form, containerManager.id, true);
      });
  }

  availableAddonsForServiceType(
    addons: AddonResponse[] | null,
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): AddonResponse[] {
    if (!this.providerSupportsAddons(serviceTypes, providerDetails, serviceTypeId, form)) return [];

    const providerId = this.getProviderId(serviceTypes ?? [], serviceTypeId, form);

    return (addons ?? []).filter(
      (addon) =>
        addon.compatibleProviders.length === 0 ||
        (providerId != null && addon.compatibleProviders.includes(providerId)),
    );
  }

  providerSupportsAddons(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): boolean {
    const providerId = this.getProviderId(serviceTypes ?? [], serviceTypeId, form);

    return providerDetails?.find((provider) => provider.id === providerId)?.supportsAddons === true;
  }

  attachedMetersFor(mode: string): AttachedMeterResponse[] {
    return mode === 'create' ? this.createAttachedMeters : this.editAttachedMeters;
  }

  availableMetersForPlanAttach(meters: MeterResponse[] | null, mode: string): MeterResponse[] {
    const attachedIds = new Set(this.attachedMetersFor(mode).map((item) => item.meterId));

    return (meters ?? []).filter((meter) => !attachedIds.has(meter.id));
  }

  loadPlanAttachedMeters(planId: string): void {
    this.planMeterAttachLoading = true;
    this.planMeterAttachError = null;
    this.servicePlansService
      .listPlanMeters(planId)
      .pipe(take(1))
      .subscribe({
        next: (meters) => {
          this.editAttachedMeters = meters;
          this.planMeterAttachLoading = false;
        },
        error: (error: unknown) => {
          this.planMeterAttachError = this.formatMeterHttpError(error, 'Failed to load plan meters');
          this.planMeterAttachLoading = false;
        },
      });
  }

  resetPlanMeterAttachForm(mode: string): void {
    if (mode === 'create') {
      this.createPlanMeterAttachMeterId = '';
      this.createPlanMeterAttachUnitPrice = '';
      this.createPlanMeterAttachIncludedUsage = '';
      return;
    }

    this.editPlanMeterAttachMeterId = '';
    this.editPlanMeterAttachUnitPrice = '';
    this.editPlanMeterAttachIncludedUsage = '';
  }

  attachPlanMeter(mode: string): void {
    const meterId = mode === 'create' ? this.createPlanMeterAttachMeterId : this.editPlanMeterAttachMeterId;
    const unitPriceRaw = optionalNumberInputValue(
      mode === 'create' ? this.createPlanMeterAttachUnitPrice : this.editPlanMeterAttachUnitPrice,
    );
    const includedUsageRaw = optionalNumberInputValue(
      mode === 'create' ? this.createPlanMeterAttachIncludedUsage : this.editPlanMeterAttachIncludedUsage,
    );

    if (!meterId) return;

    if (mode === 'create') {
      this.planMeterAttachError = null;
      this.activeMeters$.pipe(take(1)).subscribe((meters) => {
        const meter = meters.find((item) => item.id === meterId);

        if (!meter) {
          this.planMeterAttachError = 'Selected meter is not available';
          return;
        }

        const override = unitPriceRaw ? Number(unitPriceRaw) : null;
        const includedOverride = includedUsageRaw ? Number(includedUsageRaw) : null;

        this.createAttachedMeters = [
          ...this.createAttachedMeters,
          this.toPendingAttachedMeter(
            meter,
            Number.isFinite(override as number) ? override : null,
            Number.isFinite(includedOverride as number) ? includedOverride : null,
          ),
        ];
        this.resetPlanMeterAttachForm('create');
      });

      return;
    }

    if (!this.editForm.id) return;

    this.planMeterAttachLoading = true;
    this.planMeterAttachError = null;
    this.servicePlansService
      .attachPlanMeter(this.editForm.id, {
        meterId,
        unitPriceNet: unitPriceRaw ? Number(unitPriceRaw) : undefined,
        includedUsage: includedUsageRaw ? Number(includedUsageRaw) : undefined,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.resetPlanMeterAttachForm('edit');
          this.loadPlanAttachedMeters(this.editForm.id);
          this.plansFacade.loadServicePlans();
        },
        error: (error: unknown) => {
          this.planMeterAttachError = this.formatMeterHttpError(error, 'Failed to attach meter');
          this.planMeterAttachLoading = false;
        },
      });
  }

  updateAttachedPlanMeter(
    mode: string,
    meter: AttachedMeterResponse,
    unitPriceInput: string,
    includedUsageInput: string,
  ): void {
    const trimmed = unitPriceInput.trim();
    const override = trimmed ? Number(trimmed) : null;
    const includedTrimmed = includedUsageInput.trim();
    const includedOverride = includedTrimmed ? Number(includedTrimmed) : null;

    if (mode === 'create') {
      this.createAttachedMeters = this.createAttachedMeters.map((item) =>
        item.meterId === meter.meterId
          ? {
              ...item,
              unitPriceNetOverride: Number.isFinite(override as number) ? override : null,
              effectiveUnitPriceNet:
                Number.isFinite(override as number) && override != null ? override : item.defaultUnitPriceNet,
              includedUsageOverride: Number.isFinite(includedOverride as number) ? includedOverride : null,
              effectiveIncludedUsage:
                Number.isFinite(includedOverride as number) && includedOverride != null
                  ? includedOverride
                  : item.defaultIncludedUsage,
            }
          : item,
      );

      return;
    }

    if (!this.editForm.id) return;

    this.planMeterAttachLoading = true;
    this.planMeterAttachError = null;
    this.servicePlansService
      .updatePlanMeter(this.editForm.id, meter.meterId, {
        unitPriceNet: trimmed ? Number(trimmed) : null,
        includedUsage: includedTrimmed ? Number(includedTrimmed) : null,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.loadPlanAttachedMeters(this.editForm.id);
          this.plansFacade.loadServicePlans();
        },
        error: (error: unknown) => {
          this.planMeterAttachError = this.formatMeterHttpError(error, 'Failed to update meter price');
          this.planMeterAttachLoading = false;
        },
      });
  }

  detachPlanMeter(mode: string, meterId: string): void {
    if (mode === 'create') {
      this.createAttachedMeters = this.createAttachedMeters.filter((item) => item.meterId !== meterId);

      return;
    }

    if (!this.editForm.id) return;

    this.planMeterAttachLoading = true;
    this.planMeterAttachError = null;
    this.servicePlansService
      .detachPlanMeter(this.editForm.id, meterId)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.loadPlanAttachedMeters(this.editForm.id);
          this.plansFacade.loadServicePlans();
        },
        error: (error: unknown) => {
          this.planMeterAttachError = this.formatMeterHttpError(error, 'Failed to detach meter');
          this.planMeterAttachLoading = false;
        },
      });
  }

  attachedMeterOverrideInput(meter: AttachedMeterResponse): string {
    return meter.unitPriceNetOverride != null ? String(meter.unitPriceNetOverride) : '';
  }

  attachedMeterIncludedUsageOverrideInput(meter: AttachedMeterResponse): string {
    return meter.includedUsageOverride != null ? String(meter.includedUsageOverride) : '';
  }

  planMeterCount(plan: ServicePlanResponse): number {
    return plan.meters?.length ?? 0;
  }

  private toPendingAttachedMeter(
    meter: MeterResponse,
    unitPriceNetOverride: number | null,
    includedUsageOverride: number | null,
  ): AttachedMeterResponse {
    return {
      meterId: meter.id,
      key: meter.key,
      name: meter.name,
      description: meter.description ?? null,
      unitLabel: meter.unitLabel ?? null,
      aggregator: meter.aggregator,
      defaultUnitPriceNet: meter.defaultUnitPriceNet,
      unitPriceNetOverride,
      effectiveUnitPriceNet: unitPriceNetOverride != null ? unitPriceNetOverride : meter.defaultUnitPriceNet,
      defaultIncludedUsage: meter.defaultIncludedUsage ?? 0,
      includedUsageOverride,
      effectiveIncludedUsage: includedUsageOverride != null ? includedUsageOverride : (meter.defaultIncludedUsage ?? 0),
      isActive: meter.isActive,
      source: 'manual',
      required: false,
    };
  }

  private flushPendingCreatePlanMeters(pendingMeters?: AttachedMeterResponse[]): void {
    const pending = pendingMeters ?? [...this.createAttachedMeters];

    if (pending.length === 0) {
      return;
    }

    this.plansFacade
      .getSelectedServicePlan$()
      .pipe(
        take(1),
        switchMap((plan) => {
          if (!plan) {
            return of(null);
          }

          return forkJoin(
            pending.map((meter) =>
              this.servicePlansService
                .attachPlanMeter(plan.id, {
                  meterId: meter.meterId,
                  unitPriceNet: meter.unitPriceNetOverride ?? undefined,
                  includedUsage: meter.includedUsageOverride ?? undefined,
                })
                .pipe(catchError(() => of(null))),
            ),
          );
        }),
        take(1),
      )
      .subscribe(() => this.plansFacade.loadServicePlans());
  }

  private formatMeterHttpError(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'error' in error) {
      const body = (error as { error?: unknown }).error;

      if (typeof body === 'string' && body.trim()) {
        return body.trim();
      }

      if (body && typeof body === 'object' && 'message' in body) {
        const message = (body as { message?: unknown }).message;

        if (typeof message === 'string' && message.trim()) {
          return message.trim();
        }

        if (Array.isArray(message) && message.length > 0) {
          return message.map(String).join(', ');
        }
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return fallback;
  }

  private isProvisioningConfigKey(key: string): boolean {
    return (
      key === 'service' || key === 'cloudInitConfigId' || key === 'cloudInitConfigIds' || key === 'provisioningOptions'
    );
  }

  highlightsLabel(plan: ServicePlanResponse): string {
    const count = this.orderingHighlightCount(plan);

    return count === 1
      ? $localize`:@@featureBilling-planHighlightsSingular:1 highlight`
      : $localize`:@@featureBilling-planHighlightsPlural:${count} highlights`;
  }

  planTaxRatePercent(plan: ServicePlanResponse): number {
    return rateForTaxCategory(this.taxRates(), plan.taxCategory ?? 'standard');
  }

  planTaxRateLabel(plan: ServicePlanResponse): string {
    return `${this.planTaxRatePercent(plan)}%`;
  }

  /** Calculates total price from plan (base + margin). Same formula as backend PricingService. */
  getPlanTotalPrice(plan: ServicePlanResponse): number | null {
    return this.getEstimatedPrice(
      plan.basePrice ?? undefined,
      plan.marginPercent ?? undefined,
      plan.marginFixed ?? undefined,
    );
  }

  /** Formats plan price for display in list (e.g. "€4.51" or "—"). */
  formatPlanPrice(plan: ServicePlanResponse): string {
    return this.formatEstimatedPrice(this.getPlanTotalPrice(plan));
  }

  /** Resolve provider config schema (properties) for a service type, or null. */
  getProviderSchema(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): ConfigSchemaProperties | null {
    const providerId = this.getProviderId(serviceTypes, serviceTypeId, form);

    if (!providerId || !providerDetails?.length) return null;

    const detail = providerDetails.find((p) => p.id === providerId);
    const schema = detail?.configSchema as { properties?: ConfigSchemaProperties } | undefined;

    return schema?.properties ?? null;
  }

  /** Resolve full provider config schema for a service type (for basePriceFromField etc.). */
  /**
   * True when the merged provider schema has region or location as string with a non-empty string enum (checkout UX).
   */
  supportsCustomerLocationSelection(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): boolean {
    const full = this.getProviderSchemaFull(serviceTypes, providerDetails, serviceTypeId, form);
    const props = full?.['properties'] as ConfigSchemaProperties | undefined;

    if (!props) return false;

    const ok = (key: 'region' | 'location'): boolean => {
      const p = props[key];

      if (!p || typeof p !== 'object') return false;

      if (String(p.type) !== 'string') return false;

      const e = p.enum;

      return Array.isArray(e) && e.length > 0 && e.every((x) => typeof x === 'string');
    };

    return ok('region') || ok('location');
  }

  supportsCustomerServerTypeSelection(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): boolean {
    return this.getBasePriceFromField(serviceTypes, providerDetails, serviceTypeId, form) === 'serverType';
  }

  getProviderSchemaFull(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): Record<string, unknown> | null {
    const providerId = this.getProviderId(serviceTypes, serviceTypeId, form);

    if (!providerId || !providerDetails?.length) return null;

    const detail = providerDetails.find((p) => p.id === providerId);

    return (detail?.configSchema as Record<string, unknown>) ?? null;
  }

  /** Field name that drives base price when selected (e.g. serverType). When set, UI fetches options from server-types API. */
  getBasePriceFromField(
    serviceTypes: ServiceTypeResponse[] | null,
    providerDetails: ProviderDetail[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): string | null {
    const schema = this.getProviderSchemaFull(serviceTypes, providerDetails, serviceTypeId, form);
    const field = schema?.['basePriceFromField'];

    return typeof field === 'string' && field ? field : null;
  }

  /**
   * Effective cloud provider for plan form UI.
   * Customer selection on → first of plan subset (or type primary).
   * Customer selection off → pinned plan provider (or type primary when only one).
   */
  resolveFormProviderId(
    form: 'create' | 'edit',
    serviceTypes: ServiceTypeResponse[] | null,
    serviceTypeId: string | null | undefined,
  ): string | null {
    const typeAllowed = this.getServiceTypeAllowedProviders(serviceTypes, serviceTypeId);

    if (typeAllowed.length === 0) {
      return null;
    }

    const planAllowed = (form === 'create' ? this.createAllowedProviders : this.editAllowedProviders).filter((id) =>
      typeAllowed.includes(id),
    );

    return planAllowed[0] ?? typeAllowed[0] ?? null;
  }

  /** Provider id for the given service type (primary), or the plan form effective provider when form is set. */
  getProviderId(
    serviceTypes: ServiceTypeResponse[] | null,
    serviceTypeId: string | null | undefined,
    form?: 'create' | 'edit',
  ): string | null {
    if (form) {
      return this.resolveFormProviderId(form, serviceTypes, serviceTypeId);
    }

    const allowed = this.getServiceTypeAllowedProviders(serviceTypes, serviceTypeId);

    return allowed[0] ?? null;
  }

  getServiceTypeAllowedProviders(
    serviceTypes: ServiceTypeResponse[] | null,
    serviceTypeId: string | null | undefined,
  ): string[] {
    if (!serviceTypeId?.trim() || !serviceTypes?.length) {
      return [];
    }

    const serviceType = serviceTypes.find((entry) => entry.id === serviceTypeId);

    if (!serviceType) {
      return [];
    }

    const fromList = normalizeAllowedProviders(serviceType.allowedProviders);

    if (fromList.length > 0) {
      return fromList;
    }

    return normalizeAllowedProviders(serviceType.provider ? [serviceType.provider] : []);
  }

  supportsCustomerProviderSelection(
    serviceTypes: ServiceTypeResponse[] | null,
    serviceTypeId: string | null | undefined,
  ): boolean {
    return this.getServiceTypeAllowedProviders(serviceTypes, serviceTypeId).length >= 2;
  }

  providerLabel(providerId: string, providers: ProviderDetail[] | null | undefined): string {
    return getProviderDisplayName(providerId, providers);
  }

  compareProviderId = (left: string | null | undefined, right: string | null | undefined): boolean => left === right;

  onAllowCustomerProviderSelectionChange(
    form: 'create' | 'edit',
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
  ): void {
    if (form === 'create') {
      const typeAllowed = this.getServiceTypeAllowedProviders(serviceTypes, this.createForm.serviceTypeId);

      if (this.createForm.allowCustomerProviderSelection !== true) {
        const pin = this.createAllowedProviders.find((id) => typeAllowed.includes(id)) ?? typeAllowed[0] ?? null;

        this.onAllowedProvidersChangeCreate(pin ? [pin] : [], serviceTypes, providerDetails);

        return;
      }

      this.onAllowedProvidersChangeCreate([...typeAllowed], serviceTypes, providerDetails);

      return;
    }

    const typeAllowed = this.getServiceTypeAllowedProviders(serviceTypes, this.editingPlan?.serviceTypeId);

    if (this.editForm.allowCustomerProviderSelection !== true) {
      const pin = this.editAllowedProviders.find((id) => typeAllowed.includes(id)) ?? typeAllowed[0] ?? null;

      this.onAllowedProvidersChangeEdit(pin ? [pin] : [], serviceTypes, providerDetails);

      return;
    }

    this.onAllowedProvidersChangeEdit([...typeAllowed], serviceTypes, providerDetails);
  }

  onPinnedProviderChangeCreate(
    providerId: string | null | undefined,
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
  ): void {
    const pin = typeof providerId === 'string' ? providerId.trim() : '';

    this.onAllowedProvidersChangeCreate(pin ? [pin] : [], serviceTypes, providerDetails);
  }

  onPinnedProviderChangeEdit(
    providerId: string | null | undefined,
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
  ): void {
    const pin = typeof providerId === 'string' ? providerId.trim() : '';

    this.onAllowedProvidersChangeEdit(pin ? [pin] : [], serviceTypes, providerDetails);
  }

  pinnedProviderId(selected: string[]): string | null {
    return selected[0] ?? null;
  }

  onAllowedProvidersChangeCreate(
    selectedIds: unknown,
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
  ): void {
    const typeAllowed = new Set(this.getServiceTypeAllowedProviders(serviceTypes, this.createForm.serviceTypeId));
    const normalized = normalizeAllowedProviders(selectedIds).filter((id) => typeAllowed.has(id));

    this.createAllowedProviders = normalized;
    this.createForm.allowedProviders = [...normalized];
    this.refreshPlanProviderDependentUi('create', serviceTypes, providerDetails);
  }

  onAllowedProvidersChangeEdit(
    selectedIds: unknown,
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
  ): void {
    const typeAllowed = new Set(this.getServiceTypeAllowedProviders(serviceTypes, this.editingPlan?.serviceTypeId));
    const normalized = normalizeAllowedProviders(selectedIds).filter((id) => typeAllowed.has(id));

    this.editAllowedProviders = normalized;
    this.editForm.allowedProviders = [...normalized];
    this.refreshPlanProviderDependentUi('edit', serviceTypes, providerDetails);
  }

  /**
   * When the effective plan provider changes, refresh schema-driven defaults, server types, and locations.
   */
  private refreshPlanProviderDependentUi(
    form: 'create' | 'edit',
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
  ): void {
    const serviceTypeId = form === 'create' ? this.createForm.serviceTypeId : this.editingPlan?.serviceTypeId;

    this.syncProviderConfigDefaultsToSchema(form, serviceTypes, providerDetails, serviceTypeId);
    this.reloadServerTypesForForm(form, serviceTypes, providerDetails);
    this.loadProviderLocationsForForm(form, serviceTypes, providerDetails, serviceTypeId);

    if (form === 'create') {
      if (!this.supportsCustomerLocationSelection(serviceTypes, providerDetails, serviceTypeId, 'create')) {
        this.createForm.allowCustomerLocationSelection = false;
      }

      if (!this.supportsCustomerServerTypeSelection(serviceTypes, providerDetails, serviceTypeId, 'create')) {
        this.createForm.allowCustomerServerTypeSelection = false;
        this.createAllowedServerTypes = [];
      }
    } else {
      if (!this.supportsCustomerLocationSelection(serviceTypes, providerDetails, serviceTypeId, 'edit')) {
        this.editForm.allowCustomerLocationSelection = false;
      }

      if (!this.supportsCustomerServerTypeSelection(serviceTypes, providerDetails, serviceTypeId, 'edit')) {
        this.editForm.allowCustomerServerTypeSelection = false;
        this.editAllowedServerTypes = [];
      }
    }

    this.pruneInvalidProvisioningOptionKeys(serviceTypes, providerDetails, serviceTypeId, form);
  }

  /** Align providerConfigDefaults keys/enums with the effective provider schema. */
  private syncProviderConfigDefaultsToSchema(
    form: 'create' | 'edit',
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
    serviceTypeId: string | null | undefined,
  ): void {
    const schema = this.getProviderSchema(serviceTypes, providerDetails, serviceTypeId, form);
    const target = form === 'create' ? this.createForm : this.editForm;

    target.providerConfigDefaults = target.providerConfigDefaults ?? {};

    if (!schema) {
      return;
    }

    const basePriceField = this.getBasePriceFromField(serviceTypes, providerDetails, serviceTypeId, form);
    const schemaKeys = new Set(
      Object.keys(schema).filter((key) => !this.isProvisioningConfigKey(key) && key !== 'env'),
    );
    const preservedKeys = new Set([
      'allowedAddonIds',
      'mandatoryAddonIds',
      'env',
      'serverTypeByProvider',
      'geographyByProvider',
    ]);

    for (const key of Object.keys(target.providerConfigDefaults)) {
      if (preservedKeys.has(key) || this.isProvisioningConfigKey(key)) {
        continue;
      }

      if (!schemaKeys.has(key)) {
        delete target.providerConfigDefaults[key];
      }
    }

    for (const key of schemaKeys) {
      if (key === basePriceField) {
        continue;
      }

      const enumValues = this.getProviderConfigEnum(schema, key);
      const current = target.providerConfigDefaults[key];

      if (enumValues && enumValues.length > 0) {
        if (current === undefined || current === null || !enumValues.includes(current as string | number)) {
          target.providerConfigDefaults[key] = enumValues[0];
        }

        continue;
      }

      if (current !== undefined) {
        continue;
      }

      if (this.isProductObjectField(schema, key)) {
        target.providerConfigDefaults[key] = {};
      } else if (this.getProviderConfigPropertyType(schema, key) === 'boolean') {
        target.providerConfigDefaults[key] = false;
      } else {
        target.providerConfigDefaults[key] = this.getProviderConfigPropertyType(schema, key) === 'number' ? 0 : '';
      }
    }
  }

  private reloadServerTypesForForm(
    form: 'create' | 'edit',
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
  ): void {
    const serviceTypeId = form === 'create' ? this.createForm.serviceTypeId : this.editingPlan?.serviceTypeId;
    const basePriceField = this.getBasePriceFromField(serviceTypes, providerDetails, serviceTypeId, form);

    if (!basePriceField) {
      this.currentServerTypes = [];
      this.currentServerTypeGroups = [];

      return;
    }

    this.loadServerTypesForPlanForm(form, serviceTypes, providerDetails, serviceTypeId);
  }

  getProviderConfigKeys(schema: ConfigSchemaProperties | null): string[] {
    return schema ? Object.keys(schema).filter((key) => !this.isProvisioningConfigKey(key)) : [];
  }

  getServerProviderConfigKeys(schema: ConfigSchemaProperties | null): string[] {
    return getServerProviderConfigKeys(schema, this.getProviderConfigKeys(schema));
  }

  getProductProviderConfigKeysForForm(form: 'create' | 'edit', schema: ConfigSchemaProperties | null): string[] {
    return getProductProviderConfigKeys(
      schema,
      this.getProviderConfigKeys(schema),
      this.getSelectedIntegratedServices(form),
    );
  }

  getSelectedIntegratedServices(form: 'create' | 'edit'): IntegratedProductService[] {
    const optionKeys = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;
    const services: IntegratedProductService[] = [];

    if (optionKeys.has('integrated:agenstra-controller')) {
      services.push('agenstra-controller');
    }

    if (optionKeys.has('integrated:agenstra-manager')) {
      services.push('agenstra-manager');
    }

    if (optionKeys.has('integrated:decabill-billing')) {
      services.push('decabill-billing');
    }

    if (services.length > 0) {
      return services;
    }

    return [];
  }

  getSelectedCustomConfigIds(form: 'create' | 'edit'): string[] {
    const optionKeys = form === 'create' ? this.createProvisioningOptionKeys : this.editProvisioningOptionKeys;

    return [...optionKeys]
      .filter((key) => key.startsWith('custom:'))
      .map((key) => key.slice('custom:'.length).trim())
      .filter((id) => id.length > 0);
  }

  getProductCustomEnvFields(form: 'create' | 'edit', configs: CloudInitConfigResponse[] | null): PlanProductEnvField[] {
    return collectPlanProductEnvFields(configs ?? [], this.getSelectedCustomConfigIds(form));
  }

  hasProductDefaultsSection(
    form: 'create' | 'edit',
    schema: ConfigSchemaProperties | null,
    configs: CloudInitConfigResponse[] | null,
  ): boolean {
    return (
      this.getProductProviderConfigKeysForForm(form, schema).length > 0 ||
      this.getProductCustomEnvFields(form, configs).length > 0
    );
  }

  ensureProductEnvDefaults(form: 'create' | 'edit'): Record<string, string> {
    const defaultsRef =
      form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults;

    if (!defaultsRef) {
      if (form === 'create') {
        this.createForm.providerConfigDefaults = {};
      } else {
        this.editForm.providerConfigDefaults = {};
      }
    }

    const defaults = (
      form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults
    ) as Record<string, unknown>;

    const existingEnv = defaults['env'];

    if (!existingEnv || typeof existingEnv !== 'object' || Array.isArray(existingEnv)) {
      defaults['env'] = {};
    }

    return defaults['env'] as Record<string, string>;
  }

  getProductEnvValue(form: 'create' | 'edit', key: string): string {
    const env = this.ensureProductEnvDefaults(form);

    return env[key] ?? '';
  }

  setProductEnvValue(form: 'create' | 'edit', key: string, value: string): void {
    const env = this.ensureProductEnvDefaults(form);

    env[key] = value;
  }

  getProductConfigFieldLabel(key: string): string {
    return humanizeConfigFieldKey(key);
  }

  isProductObjectField(schema: ConfigSchemaProperties | null, key: string): boolean {
    return isObjectSchemaProperty(schema?.[key]);
  }

  getProductObjectFieldKeys(schema: ConfigSchemaProperties | null, key: string): string[] {
    return getObjectSchemaPropertyKeys(schema?.[key]);
  }

  isSensitiveProductConfigField(key: string): boolean {
    return isSensitiveConfigFieldKey(key);
  }

  private ensureProductNestedDefaults(form: 'create' | 'edit', parentKey: string): Record<string, unknown> {
    const defaultsRef =
      form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults;

    if (!defaultsRef) {
      if (form === 'create') {
        this.createForm.providerConfigDefaults = {};
      } else {
        this.editForm.providerConfigDefaults = {};
      }
    }

    const defaults = (
      form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults
    ) as Record<string, unknown>;

    const existing = defaults[parentKey];

    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      defaults[parentKey] = {};
    }

    return defaults[parentKey] as Record<string, unknown>;
  }

  getProductNestedValue(form: 'create' | 'edit', parentKey: string, nestedKey: string): string | number {
    const nested = this.ensureProductNestedDefaults(form, parentKey);
    const value = nested[nestedKey];

    if (typeof value === 'number') {
      return value;
    }

    return typeof value === 'string' ? value : '';
  }

  setProductNestedValue(form: 'create' | 'edit', parentKey: string, nestedKey: string, value: string | number): void {
    const nested = this.ensureProductNestedDefaults(form, parentKey);
    nested[nestedKey] = value;
  }

  getProductNestedPropertyDescription(
    schema: ConfigSchemaProperties | null,
    parentKey: string,
    nestedKey: string,
  ): string {
    const property = getNestedSchemaProperty(schema?.[parentKey], nestedKey);

    return property?.description?.trim() ?? '';
  }

  getProductNestedPropertyEnum(
    schema: ConfigSchemaProperties | null,
    parentKey: string,
    nestedKey: string,
  ): (string | number)[] | null {
    const property = getNestedSchemaProperty(schema?.[parentKey], nestedKey);

    if (!property?.enum?.length) {
      return null;
    }

    const values = property.enum.filter(
      (value): value is string | number =>
        value !== undefined && value !== null && (typeof value === 'string' || typeof value === 'number'),
    );

    return values.length > 0 ? values : null;
  }

  getProductNestedPropertyType(
    schema: ConfigSchemaProperties | null,
    parentKey: string,
    nestedKey: string,
  ): 'string' | 'number' | 'boolean' {
    const type = getSchemaPropertyType(getNestedSchemaProperty(schema?.[parentKey], nestedKey));

    return type === 'number' || type === 'boolean' ? type : 'string';
  }

  getProviderConfigPropertyType(
    schema: ConfigSchemaProperties | null,
    key: string,
  ): 'string' | 'number' | 'boolean' | 'object' {
    return getSchemaPropertyType(schema?.[key]);
  }

  getProviderConfigPropertyDescription(schema: ConfigSchemaProperties | null, key: string): string {
    const prop = schema?.[key];

    return prop && typeof prop === 'object' && 'description' in prop ? String(prop.description) : '';
  }

  /**
   * Returns predefined enum values for a property if present; otherwise null.
   * When non-null and non-empty, the UI should render a select instead of a text/number input.
   */
  getProviderConfigEnum(schema: ConfigSchemaProperties | null, key: string): (string | number)[] | null {
    const prop = schema?.[key];

    if (!prop || typeof prop !== 'object' || !Array.isArray(prop.enum)) return null;

    const arr = prop.enum.filter((v) => v !== undefined && v !== null);

    return arr.length > 0 ? arr : null;
  }

  isGeographyConfigKey(key: string): boolean {
    return key === 'location' || key === 'region';
  }

  formatProviderConfigEnumLabel(key: string, value: string | number): string {
    if (key === 'serverType' && typeof value === 'string') {
      return formatServerTypeIdLabel(this.currentServerTypes, value);
    }

    if (this.isGeographyConfigKey(key) && typeof value === 'string') {
      return formatProvisioningLocationLabel(value, this.providerLocationCatalog);
    }

    return String(value);
  }

  /** When create form service type changes, init providerConfigDefaults from schema and load server types if needed. */
  onCreateServiceTypeIdChange(serviceTypes: ServiceTypeResponse[], providerDetails: ProviderDetail[]): void {
    if (isNoneServiceTypeId(this.createForm.serviceTypeId)) {
      this.createForm.providerConfigDefaults = {};
      this.createForm.allowCustomerLocationSelection = false;
      this.createForm.allowCustomerServerTypeSelection = false;
      this.createForm.allowCustomerProviderSelection = false;
      this.createForm.autoRecalculatePriceDaily = false;
      this.createAllowedServerTypes = [];
      this.createAllowedProviders = [];
      this.createForm.allowedProviders = [];
      this.createProvisioningOptionKeys.clear();
      this.currentServerTypes = [];
      this.currentServerTypeGroups = [];
      this.providerLocationCatalog = new Map();

      return;
    }

    this.createForm.providerConfigDefaults = this.createForm.providerConfigDefaults ?? {};

    if (!this.providerSupportsAddons(serviceTypes, providerDetails, this.createForm.serviceTypeId, 'create')) {
      delete this.createForm.providerConfigDefaults['allowedAddonIds'];
      delete this.createForm.providerConfigDefaults['mandatoryAddonIds'];
    }

    if (!this.supportsCustomerProviderSelection(serviceTypes, this.createForm.serviceTypeId)) {
      this.createForm.allowCustomerProviderSelection = false;
      this.createAllowedProviders = [];
      this.createForm.allowedProviders = [];
    } else if (this.createForm.allowCustomerProviderSelection !== true) {
      const typeAllowed = this.getServiceTypeAllowedProviders(serviceTypes, this.createForm.serviceTypeId);
      const pin = this.createAllowedProviders.find((id) => typeAllowed.includes(id)) ?? typeAllowed[0] ?? null;

      this.createAllowedProviders = pin ? [pin] : [];
      this.createForm.allowedProviders = [...this.createAllowedProviders];
    } else {
      const typeAllowed = this.getServiceTypeAllowedProviders(serviceTypes, this.createForm.serviceTypeId);

      this.createAllowedProviders = [...typeAllowed];
      this.createForm.allowedProviders = [...typeAllowed];
    }

    this.refreshPlanProviderDependentUi('create', serviceTypes, providerDetails);
    this.applyDefaultProvisioningOptionKeys(serviceTypes, providerDetails, this.createForm.serviceTypeId, 'create');
  }

  private schemaHasGeographyEnum(schema: ConfigSchemaProperties | null): boolean {
    if (!schema) return false;

    return Boolean(this.getProviderConfigEnum(schema, 'location') ?? this.getProviderConfigEnum(schema, 'region'));
  }

  private loadProviderLocations(providerId: string, serviceTypeId?: string | null): void {
    this.providerLocationsLoading = true;
    this.providerLocationCatalog = new Map();
    this.serviceTypesService.getProviderLocations(providerId, serviceTypeId ?? undefined).subscribe({
      next: (locations: ProviderLocation[]) => {
        this.providerLocationCatalog = providerLocationCatalogFromList(locations);
        this.providerLocationsLoading = false;
      },
      error: () => {
        this.providerLocationsLoading = false;
        this.providerLocationCatalog = new Map();
      },
    });
  }

  private providersForServerTypeLoad(
    form: 'create' | 'edit',
    serviceTypes: ServiceTypeResponse[],
    serviceTypeId: string | null | undefined,
  ): string[] {
    const typeAllowed = this.getServiceTypeAllowedProviders(serviceTypes, serviceTypeId);

    if (typeAllowed.length === 0) {
      return [];
    }

    const allowProviderSelection =
      form === 'create'
        ? this.createForm.allowCustomerProviderSelection === true
        : this.editForm.allowCustomerProviderSelection === true;
    const planAllowed = (form === 'create' ? this.createAllowedProviders : this.editAllowedProviders).filter((id) =>
      typeAllowed.includes(id),
    );
    const effectiveProviders = planAllowed.length > 0 ? planAllowed : typeAllowed;

    if (allowProviderSelection) {
      // Load every selectable plan provider so serverTypeByProvider defaults can be edited
      // even when customer server-type selection is off (backend still reads the map at order).
      if (effectiveProviders.length >= 2) {
        return effectiveProviders;
      }

      return effectiveProviders[0] ? [effectiveProviders[0]] : [];
    }

    // Customer selection off: only the pinned (or sole) plan provider.
    const pin = effectiveProviders[0];

    return pin ? [pin] : [];
  }

  private loadServerTypesForPlanForm(
    form: 'create' | 'edit',
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
    serviceTypeId?: string | null,
  ): void {
    const providerIds = this.providersForServerTypeLoad(form, serviceTypes, serviceTypeId);

    if (providerIds.length === 0) {
      this.currentServerTypes = [];
      this.currentServerTypeGroups = [];
      this.serverTypesLoading = false;

      return;
    }

    this.serverTypesLoading = true;
    this.currentServerTypes = [];
    this.currentServerTypeGroups = [];

    forkJoin(
      providerIds.map((providerId) =>
        this.serviceTypesService.getProviderServerTypes(providerId, serviceTypeId ?? undefined).pipe(
          map((types) => ({ providerId, types })),
          catchError(() => of({ providerId, types: [] as ServerType[] })),
        ),
      ),
    ).subscribe({
      next: (groups) => {
        this.currentServerTypeGroups = groups.map((group) => ({
          providerId: group.providerId,
          label: this.providerLabel(group.providerId, providerDetails),
          types: group.types,
        }));
        this.currentServerTypes = groups.flatMap((group) => group.types);
        this.serverTypesLoading = false;
        this.ensureValidDefaultServerType(form);
      },
      error: () => {
        this.serverTypesLoading = false;
        this.currentServerTypes = [];
        this.currentServerTypeGroups = [];
      },
    });
  }

  /** Drop plan default serverType when it is not in the loaded catalog for the effective provider(s). */
  private ensureValidDefaultServerType(form: 'create' | 'edit'): void {
    const defaults = form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults;

    if (!defaults) {
      return;
    }

    if (this.needsPerProviderServerTypeDefaults(form)) {
      const map = this.getServerTypeByProviderMap(form);
      const keep = new Set(this.currentServerTypeGroups.map((group) => group.providerId));

      for (const providerId of Object.keys(map)) {
        if (!keep.has(providerId)) {
          delete map[providerId];
        }
      }

      for (const group of this.currentServerTypeGroups) {
        const current = map[group.providerId];
        const options = this.serverTypesForProviderDefault(form, group);

        if (current && options.some((entry) => entry.id === current)) {
          continue;
        }

        const fallback = options[0]?.id ?? null;

        if (fallback) {
          map[group.providerId] = fallback;
        } else {
          delete map[group.providerId];
        }
      }

      this.writeServerTypeByProviderMap(form, map);
      this.syncTopLevelServerTypeFromByProvider(form);

      return;
    }

    const current = defaults['serverType'];

    if (typeof current !== 'string' || !current.trim()) {
      return;
    }

    if (this.currentServerTypes.some((entry) => entry.id === current)) {
      return;
    }

    const fallback = this.currentServerTypes[0]?.id ?? null;

    defaults['serverType'] = fallback;

    if (fallback) {
      if (form === 'create') {
        this.onServerTypeSelectCreate(fallback);
      } else {
        this.onServerTypeSelectEdit(fallback);
      }
    }
  }

  needsPerProviderServerTypeDefaults(form: 'create' | 'edit'): boolean {
    const allowProviderSelection =
      form === 'create'
        ? this.createForm.allowCustomerProviderSelection === true
        : this.editForm.allowCustomerProviderSelection === true;

    if (!allowProviderSelection) {
      return false;
    }

    const planAllowed = form === 'create' ? this.createAllowedProviders : this.editAllowedProviders;

    return planAllowed.length > 1 || this.currentServerTypeGroups.length > 1;
  }

  getServerTypeByProviderMap(form: 'create' | 'edit'): Record<string, string> {
    const defaults = form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults;
    const raw = defaults?.['serverTypeByProvider'];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const out: Record<string, string> = {};

    for (const [providerId, serverType] of Object.entries(raw as Record<string, unknown>)) {
      const provider = typeof providerId === 'string' ? providerId.trim() : '';
      const typeId = typeof serverType === 'string' ? serverType.trim() : '';

      if (provider && typeId) {
        out[provider] = typeId;
      }
    }

    return out;
  }

  getDefaultServerTypeForProvider(form: 'create' | 'edit', providerId: string): string | null {
    return this.getServerTypeByProviderMap(form)[providerId] ?? null;
  }

  serverTypesForProviderDefault(
    form: 'create' | 'edit',
    group: { providerId: string; types: ServerType[] },
  ): ServerType[] {
    const allowServerTypeSelection =
      form === 'create'
        ? this.createForm.allowCustomerServerTypeSelection === true
        : this.editForm.allowCustomerServerTypeSelection === true;

    if (!allowServerTypeSelection) {
      return group.types;
    }

    const allowed = new Set(form === 'create' ? this.createAllowedServerTypes : this.editAllowedServerTypes);
    const filtered = group.types.filter((entry) => allowed.has(entry.id));

    return filtered.length > 0 ? filtered : group.types;
  }

  onDefaultServerTypeForProviderChange(
    form: 'create' | 'edit',
    providerId: string,
    serverTypeId: string | null | undefined,
  ): void {
    const typeId = typeof serverTypeId === 'string' ? serverTypeId.trim() : '';
    const map = this.getServerTypeByProviderMap(form);

    if (!typeId) {
      delete map[providerId];
    } else {
      map[providerId] = typeId;

      const allowServerTypeSelection =
        form === 'create'
          ? this.createForm.allowCustomerServerTypeSelection === true
          : this.editForm.allowCustomerServerTypeSelection === true;

      if (allowServerTypeSelection) {
        if (form === 'create' && !this.createAllowedServerTypes.includes(typeId)) {
          this.createAllowedServerTypes = [...this.createAllowedServerTypes, typeId];
          this.createForm.allowedServerTypes = [...this.createAllowedServerTypes];
        }

        if (form === 'edit' && !this.editAllowedServerTypes.includes(typeId)) {
          this.editAllowedServerTypes = [...this.editAllowedServerTypes, typeId];
          this.editForm.allowedServerTypes = [...this.editAllowedServerTypes];
        }
      }
    }

    this.writeServerTypeByProviderMap(form, map);
    this.syncTopLevelServerTypeFromByProvider(form);
  }

  private writeServerTypeByProviderMap(form: 'create' | 'edit', map: Record<string, string>): void {
    const target = form === 'create' ? this.createForm : this.editForm;

    target.providerConfigDefaults = target.providerConfigDefaults ?? {};

    if (Object.keys(map).length === 0) {
      delete target.providerConfigDefaults['serverTypeByProvider'];
    } else {
      target.providerConfigDefaults['serverTypeByProvider'] = { ...map };
    }
  }

  private syncTopLevelServerTypeFromByProvider(form: 'create' | 'edit'): void {
    const map = this.getServerTypeByProviderMap(form);
    const planAllowed = form === 'create' ? this.createAllowedProviders : this.editAllowedProviders;
    const providerId = planAllowed[0] ?? this.currentServerTypeGroups[0]?.providerId ?? null;
    const defaultId = (providerId && map[providerId]) || Object.values(map)[0] || null;
    const target = form === 'create' ? this.createForm : this.editForm;

    target.providerConfigDefaults = target.providerConfigDefaults ?? {};

    if (defaultId) {
      target.providerConfigDefaults['serverType'] = defaultId;

      if (form === 'create') {
        this.onServerTypeSelectCreate(defaultId);
      } else {
        this.onServerTypeSelectEdit(defaultId);
      }
    }
  }

  private syncServerTypeByProviderFromAllowed(form: 'create' | 'edit'): void {
    if (!this.needsPerProviderServerTypeDefaults(form)) {
      return;
    }

    const allowed = new Set(form === 'create' ? this.createAllowedServerTypes : this.editAllowedServerTypes);
    const map = this.getServerTypeByProviderMap(form);
    const keep = new Set(this.currentServerTypeGroups.map((group) => group.providerId));

    for (const providerId of Object.keys(map)) {
      if (!keep.has(providerId)) {
        delete map[providerId];
      }
    }

    for (const group of this.currentServerTypeGroups) {
      const selectedInGroup = group.types.map((entry) => entry.id).filter((id) => allowed.has(id));

      if (selectedInGroup.length === 0) {
        delete map[group.providerId];
        continue;
      }

      if (!map[group.providerId] || !selectedInGroup.includes(map[group.providerId])) {
        map[group.providerId] = selectedInGroup[0];
      }
    }

    this.writeServerTypeByProviderMap(form, map);
    this.syncTopLevelServerTypeFromByProvider(form);
  }

  needsPerProviderGeographyDefaults(form: 'create' | 'edit'): boolean {
    const allowProviderSelection =
      form === 'create'
        ? this.createForm.allowCustomerProviderSelection === true
        : this.editForm.allowCustomerProviderSelection === true;

    return allowProviderSelection && this.providersForPlanGeography(form).length > 1;
  }

  providersForPlanGeography(form: 'create' | 'edit'): string[] {
    const planAllowed = form === 'create' ? this.createAllowedProviders : this.editAllowedProviders;

    if (planAllowed.length > 0) {
      return [...planAllowed];
    }

    return this.currentServerTypeGroups.map((group) => group.providerId);
  }

  geographyProviderGroups(
    form: 'create' | 'edit',
    providerDetails: ProviderDetail[] | null | undefined,
  ): Array<{ providerId: string; label: string }> {
    return this.providersForPlanGeography(form).map((providerId) => ({
      providerId,
      label: this.providerLabel(providerId, providerDetails),
    }));
  }

  getGeographyByProviderMap(form: 'create' | 'edit'): Record<string, string> {
    const defaults = form === 'create' ? this.createForm.providerConfigDefaults : this.editForm.providerConfigDefaults;
    const raw = defaults?.['geographyByProvider'];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const out: Record<string, string> = {};

    for (const [providerId, geography] of Object.entries(raw as Record<string, unknown>)) {
      const provider = typeof providerId === 'string' ? providerId.trim() : '';
      const geo = typeof geography === 'string' ? geography.trim() : '';

      if (provider && geo) {
        out[provider] = geo;
      }
    }

    return out;
  }

  getDefaultGeographyForProvider(form: 'create' | 'edit', providerId: string): string | null {
    return this.getGeographyByProviderMap(form)[providerId] ?? null;
  }

  locationsForProvider(providerId: string): ProviderLocation[] {
    const catalog = this.providerLocationCatalogs[providerId] ?? this.providerLocationCatalog;

    return [...catalog.values()];
  }

  onDefaultGeographyForProviderChange(
    form: 'create' | 'edit',
    providerId: string,
    geographyId: string | null | undefined,
  ): void {
    const geo = typeof geographyId === 'string' ? geographyId.trim() : '';
    const map = this.getGeographyByProviderMap(form);

    if (!geo) {
      delete map[providerId];
    } else {
      map[providerId] = geo;
    }

    this.writeGeographyByProviderMap(form, map);
    this.syncTopLevelGeographyFromByProvider(form);
  }

  private writeGeographyByProviderMap(form: 'create' | 'edit', map: Record<string, string>): void {
    const target = form === 'create' ? this.createForm : this.editForm;

    target.providerConfigDefaults = target.providerConfigDefaults ?? {};

    if (Object.keys(map).length === 0) {
      delete target.providerConfigDefaults['geographyByProvider'];
    } else {
      target.providerConfigDefaults['geographyByProvider'] = { ...map };
    }
  }

  private syncTopLevelGeographyFromByProvider(form: 'create' | 'edit'): void {
    const map = this.getGeographyByProviderMap(form);
    const planAllowed = form === 'create' ? this.createAllowedProviders : this.editAllowedProviders;
    const providerId = planAllowed[0] ?? Object.keys(map)[0] ?? null;
    const defaultId = (providerId && map[providerId]) || Object.values(map)[0] || null;
    const target = form === 'create' ? this.createForm : this.editForm;

    target.providerConfigDefaults = target.providerConfigDefaults ?? {};

    if (defaultId) {
      target.providerConfigDefaults['location'] = defaultId;
      target.providerConfigDefaults['region'] = defaultId;
    }
  }

  private ensureValidDefaultGeography(form: 'create' | 'edit'): void {
    if (!this.needsPerProviderGeographyDefaults(form)) {
      return;
    }

    const map = this.getGeographyByProviderMap(form);
    const keep = new Set(this.providersForPlanGeography(form));

    for (const providerId of Object.keys(map)) {
      if (!keep.has(providerId)) {
        delete map[providerId];
      }
    }

    for (const providerId of keep) {
      const current = map[providerId];
      const options = this.locationsForProvider(providerId);

      if (current && options.some((entry) => entry.id === current)) {
        continue;
      }

      const fallback = options[0]?.id ?? null;

      if (fallback) {
        map[providerId] = fallback;
      } else {
        delete map[providerId];
      }
    }

    this.writeGeographyByProviderMap(form, map);
    this.syncTopLevelGeographyFromByProvider(form);
  }

  private loadProviderLocationsForForm(
    form: 'create' | 'edit',
    serviceTypes: ServiceTypeResponse[],
    providerDetails: ProviderDetail[],
    serviceTypeId: string | null | undefined,
  ): void {
    const schema = this.getProviderSchema(serviceTypes, providerDetails, serviceTypeId, form);

    if (!this.schemaHasGeographyEnum(schema)) {
      this.providerLocationCatalog = new Map();
      this.providerLocationCatalogs = {};
      this.providerLocationsLoading = false;

      return;
    }

    const providerIds = this.needsPerProviderGeographyDefaults(form)
      ? this.providersForPlanGeography(form)
      : (() => {
          const single = this.getProviderId(serviceTypes, serviceTypeId, form);

          return single ? [single] : [];
        })();

    if (providerIds.length === 0) {
      this.providerLocationCatalog = new Map();
      this.providerLocationCatalogs = {};
      this.providerLocationsLoading = false;

      return;
    }

    this.providerLocationsLoading = true;
    this.providerLocationCatalog = new Map();
    this.providerLocationCatalogs = {};

    forkJoin(
      providerIds.map((providerId) =>
        this.serviceTypesService.getProviderLocations(providerId, serviceTypeId ?? undefined).pipe(
          map((locations) => ({ providerId, locations })),
          catchError(() => of({ providerId, locations: [] as ProviderLocation[] })),
        ),
      ),
    ).subscribe({
      next: (groups) => {
        const catalogs: Record<string, ProviderLocationCatalog> = {};

        for (const group of groups) {
          catalogs[group.providerId] = providerLocationCatalogFromList(group.locations);
        }

        this.providerLocationCatalogs = catalogs;
        this.providerLocationCatalog = catalogs[providerIds[0]] ?? new Map();
        this.providerLocationsLoading = false;
        this.ensureValidDefaultGeography(form);
      },
      error: () => {
        this.providerLocationsLoading = false;
        this.providerLocationCatalog = new Map();
        this.providerLocationCatalogs = {};
      },
    });
  }

  private loadServerTypes(providerId: string, serviceTypeId?: string | null): void {
    this.serverTypesLoading = true;
    this.currentServerTypes = [];
    this.currentServerTypeGroups = [];
    this.serviceTypesService.getProviderServerTypes(providerId, serviceTypeId ?? undefined).subscribe({
      next: (list) => {
        this.currentServerTypes = list;
        this.currentServerTypeGroups =
          list.length > 0
            ? [
                {
                  providerId,
                  label: providerId,
                  types: list,
                },
              ]
            : [];
        this.serverTypesLoading = false;
      },
      error: () => {
        this.serverTypesLoading = false;
        this.currentServerTypes = [];
        this.currentServerTypeGroups = [];
      },
    });
  }

  /** When user selects a server type in create form, set base price from selection. */
  onServerTypeSelectCreate(serverTypeId: string): void {
    const st = this.currentServerTypes.find((s) => s.id === serverTypeId);

    if (st?.priceMonthly != null) {
      this.createForm.basePrice = String(st.priceMonthly);
    }
  }

  onAllowedServerTypesChangeCreate(selectedIds: unknown): void {
    const normalized = normalizeAllowedServerTypeIds(selectedIds);
    this.createAllowedServerTypes = normalized;
    this.createForm.allowedServerTypes = [...normalized];

    if (this.needsPerProviderServerTypeDefaults('create')) {
      this.syncServerTypeByProviderFromAllowed('create');

      return;
    }

    if (normalized.length === 0) {
      return;
    }

    const defaultId = normalized[0];

    if (!this.createForm.providerConfigDefaults) {
      this.createForm.providerConfigDefaults = {};
    }

    this.createForm.providerConfigDefaults['serverType'] = defaultId;
    this.onServerTypeSelectCreate(defaultId);
  }

  /** When user selects a server type in edit form, set base price from selection. */
  onServerTypeSelectEdit(serverTypeId: string): void {
    const st = this.currentServerTypes.find((s) => s.id === serverTypeId);

    if (st?.priceMonthly != null) {
      this.editForm.basePrice = String(st.priceMonthly);
    }
  }

  onAllowedServerTypesChangeEdit(selectedIds: unknown): void {
    const normalized = normalizeAllowedServerTypeIds(selectedIds);
    this.editAllowedServerTypes = normalized;
    this.editForm.allowedServerTypes = [...normalized];

    if (this.needsPerProviderServerTypeDefaults('edit')) {
      this.syncServerTypeByProviderFromAllowed('edit');

      return;
    }

    if (normalized.length === 0) {
      return;
    }

    const defaultId = normalized[0];

    if (!this.editForm.providerConfigDefaults) {
      this.editForm.providerConfigDefaults = {};
    }

    this.editForm.providerConfigDefaults['serverType'] = defaultId;
    this.onServerTypeSelectEdit(defaultId);
  }

  getServerTypesForEstimates(form: 'create' | 'edit'): ServerType[] {
    const allow =
      form === 'create'
        ? this.createForm.allowCustomerServerTypeSelection === true
        : this.editForm.allowCustomerServerTypeSelection === true;
    const allowed = form === 'create' ? this.createAllowedServerTypes : this.editAllowedServerTypes;

    if (!allow || allowed.length === 0) {
      return [];
    }

    const allowedSet = new Set(allowed);

    return this.currentServerTypes.filter((st) => allowedSet.has(st.id));
  }

  showPerTypePriceEstimates(form: 'create' | 'edit'): boolean {
    return this.getServerTypesForEstimates(form).length > 1;
  }

  getEstimatedPriceForServerType(form: 'create' | 'edit', serverType: ServerType): number | null {
    const basePrice = form === 'create' ? this.createForm.basePrice : this.editForm.basePrice;
    const marginPercent = form === 'create' ? this.createForm.marginPercent : this.editForm.marginPercent;
    const marginFixed = form === 'create' ? this.createForm.marginFixed : this.editForm.marginFixed;
    const base = serverType.priceMonthly != null ? String(serverType.priceMonthly) : basePrice;

    return this.getEstimatedPrice(base, marginPercent, marginFixed);
  }

  onAllowCustomerServerTypeSelectionChange(form: 'create' | 'edit'): void {
    if (form === 'create') {
      if (this.createForm.allowCustomerServerTypeSelection !== true) {
        this.createAllowedServerTypes = [];
        this.createForm.allowedServerTypes = [];
        this.typesAndProviders$.pipe(take(1)).subscribe(({ serviceTypes, providerDetails }) => {
          this.reloadServerTypesForForm('create', serviceTypes, providerDetails);
        });

        return;
      }

      const current = this.createForm.providerConfigDefaults?.['serverType'];

      if (typeof current === 'string' && current.trim()) {
        this.onAllowedServerTypesChangeCreate([current.trim()]);
      }

      this.typesAndProviders$.pipe(take(1)).subscribe(({ serviceTypes, providerDetails }) => {
        this.reloadServerTypesForForm('create', serviceTypes, providerDetails);
      });

      return;
    }

    if (this.editForm.allowCustomerServerTypeSelection !== true) {
      this.editAllowedServerTypes = [];
      this.editForm.allowedServerTypes = [];
      this.typesAndProviders$.pipe(take(1)).subscribe(({ serviceTypes, providerDetails }) => {
        this.reloadServerTypesForForm('edit', serviceTypes, providerDetails);
      });

      return;
    }

    const current = this.editForm.providerConfigDefaults?.['serverType'];

    if (typeof current === 'string' && current.trim()) {
      this.onAllowedServerTypesChangeEdit([current.trim()]);
    }

    this.typesAndProviders$.pipe(take(1)).subscribe(({ serviceTypes, providerDetails }) => {
      this.reloadServerTypesForForm('edit', serviceTypes, providerDetails);
    });
  }

  formatServerTypeOptionLabel(st: ServerType): string {
    return formatServerTypeOption(st);
  }

  compareServerTypeId = (left: string | null | undefined, right: string | null | undefined): boolean => left === right;

  addOrderingHighlight(form: 'create' | 'edit'): void {
    const row: ServicePlanOrderingHighlight = { icon: '', text: '' };

    if (form === 'create') {
      this.createForm.orderingHighlights = [...(this.createForm.orderingHighlights ?? []), row];
    } else {
      this.editForm.orderingHighlights = [...(this.editForm.orderingHighlights ?? []), row];
    }
  }

  removeOrderingHighlight(form: 'create' | 'edit', index: number): void {
    if (form === 'create') {
      const list = [...(this.createForm.orderingHighlights ?? [])];

      list.splice(index, 1);
      this.createForm.orderingHighlights = list;
    } else {
      const list = [...(this.editForm.orderingHighlights ?? [])];

      list.splice(index, 1);
      this.editForm.orderingHighlights = list;
    }
  }

  moveOrderingHighlight(form: 'create' | 'edit', index: number, direction: -1 | 1): void {
    const formRef = form === 'create' ? this.createForm : this.editForm;
    const list = [...(formRef.orderingHighlights ?? [])];
    const next = index + direction;

    if (next < 0 || next >= list.length) return;

    [list[index], list[next]] = [list[next], list[index]];
    formRef.orderingHighlights = list;
  }

  private sanitizeOrderingHighlights(
    highlights: ServicePlanOrderingHighlight[] | undefined,
  ): ServicePlanOrderingHighlight[] {
    if (!highlights?.length) return [];

    return highlights
      .map((h) => ({ icon: h.icon?.trim() ?? '', text: h.text?.trim() ?? '' }))
      .filter((h) => h.icon.length > 0 && h.text.length > 0);
  }

  orderingHighlightCount(plan: ServicePlanResponse): number {
    return plan.orderingHighlights?.length ?? 0;
  }

  private formatPrice(value: number | string): string {
    const n = typeof value === 'number' ? value : Number(value);

    if (Number.isNaN(n)) return String(value);

    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  /** Parses form value to number; returns 0 for empty/invalid. */
  private parseFormNumber(value: string | number | undefined): number {
    if (value === undefined || value === null) return 0;

    const n = typeof value === 'number' ? value : Number(String(value).trim());

    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Estimated total price from base + margin (same formula as backend PricingService).
   * Returns null when base price is missing or invalid.
   */
  getEstimatedPrice(
    basePrice: string | number | undefined,
    marginPercent: string | number | undefined,
    marginFixed: string | number | undefined,
  ): number | null {
    const base = this.parseFormNumber(basePrice);

    if (base <= 0) return null;

    const marginPct = this.parseFormNumber(marginPercent);
    const marginFix = this.parseFormNumber(marginFixed);

    return base + base * (marginPct / 100) + marginFix;
  }

  /** Formats estimated price for display (e.g. "€4.51" or "—"). */
  formatEstimatedPrice(total: number | null): string {
    if (total === null) return '—';

    return `€${this.formatPrice(total)}`;
  }

  getEstimatedPriceBreakdown(
    basePrice: string | number | undefined,
    marginPercent: string | number | undefined,
    marginFixed: string | number | undefined,
    taxCategory: TaxCategory = 'standard',
  ): { net: number; tax: number; gross: number; taxRate: number } | null {
    const net = this.getEstimatedPrice(basePrice, marginPercent, marginFixed);

    if (net === null) return null;

    const taxRate = rateForTaxCategory(this.taxRates(), taxCategory);

    return computeLineTotalsFromRate(1, net, taxRate);
  }

  formatEstimatedPriceBreakdown(
    basePrice: string | number | undefined,
    marginPercent: string | number | undefined,
    marginFixed: string | number | undefined,
    taxCategory: TaxCategory = 'standard',
  ): string {
    const breakdown = this.getEstimatedPriceBreakdown(basePrice, marginPercent, marginFixed, taxCategory);

    if (!breakdown) return '—';

    return `€${this.formatPrice(breakdown.net)} + €${this.formatPrice(breakdown.tax)} VAT (${breakdown.taxRate}%) = €${this.formatPrice(breakdown.gross)}`;
  }

  private getDefaultCreateForm(): CreateServicePlanDto {
    return {
      serviceTypeId: null,
      name: '',
      description: '',
      billingIntervalType: 'month',
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      cancelAtPeriodEnd: true,
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
      minCommitmentDays: 0,
      noticeDays: 0,
      basePrice: undefined,
      marginPercent: undefined,
      marginFixed: undefined,
      providerConfigDefaults: {},
      orderingHighlights: [],
      allowCustomerLocationSelection: false,
      allowCustomerServerTypeSelection: false,
      allowedServerTypes: [],
      allowCustomerProviderSelection: false,
      allowedProviders: [],
      taxCategory: 'standard',
      isActive: true,
    };
  }

  private getDefaultEditForm(): UpdateServicePlanDto & { id: string } {
    return {
      id: '',
      name: '',
      description: '',
      billingIntervalType: 'month',
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      cancelAtPeriodEnd: false,
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
      minCommitmentDays: 0,
      noticeDays: 0,
      basePrice: undefined,
      marginPercent: undefined,
      marginFixed: undefined,
      providerConfigDefaults: {},
      orderingHighlights: [],
      allowCustomerLocationSelection: false,
      allowCustomerServerTypeSelection: false,
      allowedServerTypes: [],
      allowCustomerProviderSelection: false,
      allowedProviders: [],
      taxCategory: 'standard',
      migrateExistingSubscriptions: false,
      isActive: true,
    };
  }

  ngOnInit(): void {
    this.plansFacade.loadServicePlans();
    this.typesFacade.loadServiceTypes();
    this.typesFacade.loadProviderDetails();
    this.cloudInitConfigsFacade.loadCloudInitConfigs();
    this.addonsFacade.loadAddons();
    this.metersFacade.loadMeters();
    this.refreshIssuerTaxRates();
    this.registerModalCloseWatchers();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.plansFacade.loadServicePlans({ search: search.trim() || undefined });
      });
  }

  private refreshIssuerTaxRates(): void {
    this.adminBillingService
      .previewTax({})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => this.taxRates.set(preview.rates),
        error: () => undefined,
      });
  }

  openCreateModal(): void {
    this.resetCreateForm();
    this.metersFacade.loadMeters();
    this.createAttachedMeters = [];
    this.resetPlanMeterAttachForm('create');
    this.planMeterAttachError = null;
    this.currentServerTypes = [];
    this.currentServerTypeGroups = [];
    this.createAllowedServerTypes = [];
    this.createAllowedProviders = [];
    this.serverTypesLoading = false;
    this.providerLocationCatalog = new Map();
    this.providerLocationsLoading = false;
    this.resetProductDefaultsCollapse('create');
    showBillingModal(this.createModalOpen);
  }

  openEditModal(plan: ServicePlanResponse): void {
    this.editingPlan = plan;
    this.metersFacade.loadMeters();
    this.resetPlanMeterAttachForm('edit');
    this.planMeterAttachError = null;
    this.editAttachedMeters = plan.meters ?? [];
    this.loadPlanAttachedMeters(plan.id);
    this.currentServerTypes = [];
    this.currentServerTypeGroups = [];
    this.editAllowedServerTypes = plan.allowCustomerServerTypeSelection
      ? normalizeAllowedServerTypeIds(plan.allowedServerTypes)
      : [];
    this.editAllowedProviders = normalizeAllowedProviders(plan.allowedProviders);
    this.serverTypesLoading = false;
    this.providerLocationCatalog = new Map();
    this.providerLocationsLoading = false;
    this.editProvisioningOptionKeys = new Set(planProvisioningOptionKeysFromDefaults(plan.providerConfigDefaults));
    this.editStaleCustomConfigIds = [];
    this.editForm = {
      id: plan.id,
      name: plan.name,
      description: plan.description ?? '',
      billingIntervalType: plan.billingIntervalType,
      billingIntervalValue: plan.billingIntervalValue,
      billingDayOfMonth: plan.billingDayOfMonth ?? undefined,
      cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
      billInAdvance: plan.billInAdvance === true,
      autoRecalculatePriceDaily: plan.autoRecalculatePriceDaily === true,
      minCommitmentDays: plan.minCommitmentDays,
      noticeDays: plan.noticeDays,
      basePrice: plan.basePrice ?? undefined,
      marginPercent: plan.marginPercent ?? undefined,
      marginFixed: plan.marginFixed ?? undefined,
      providerConfigDefaults:
        plan.providerConfigDefaults && Object.keys(plan.providerConfigDefaults).length > 0
          ? { ...plan.providerConfigDefaults }
          : {},
      orderingHighlights: plan.orderingHighlights?.length
        ? plan.orderingHighlights.map((h) => ({ icon: h.icon, text: h.text }))
        : [],
      allowCustomerLocationSelection: plan.allowCustomerLocationSelection === true,
      allowCustomerServerTypeSelection: plan.allowCustomerServerTypeSelection === true,
      allowedServerTypes: normalizeAllowedServerTypeIds(plan.allowedServerTypes),
      allowCustomerProviderSelection: plan.allowCustomerProviderSelection === true,
      allowedProviders: normalizeAllowedProviders(plan.allowedProviders),
      taxCategory: plan.taxCategory ?? 'standard',
      migrateExistingSubscriptions: false,
      isActive: plan.isActive,
    };
    combineLatest([this.typesAndProviders$, this.cloudInitConfigs$])
      .pipe(take(1))
      .subscribe(([{ serviceTypes, providerDetails }, cloudInitConfigs]) => {
        this.pruneInvalidProvisioningOptionKeys(serviceTypes, providerDetails, plan.serviceTypeId, 'edit');
        this.editStaleCustomConfigIds = this.pruneInactiveCustomProvisioningOptionKeys(cloudInitConfigs, 'edit');

        if (
          plan.allowCustomerProviderSelection !== true &&
          this.supportsCustomerProviderSelection(serviceTypes, plan.serviceTypeId)
        ) {
          const typeAllowed = this.getServiceTypeAllowedProviders(serviceTypes, plan.serviceTypeId);
          const pin = this.editAllowedProviders.find((id) => typeAllowed.includes(id)) ?? typeAllowed[0] ?? null;

          this.editAllowedProviders = pin ? [pin] : [];
          this.editForm.allowedProviders = [...this.editAllowedProviders];
        }

        this.refreshPlanProviderDependentUi('edit', serviceTypes, providerDetails);
      });
    this.resetProductDefaultsCollapse('edit');
    showBillingModal(this.editModalOpen);
  }

  openDeleteConfirm(plan: ServicePlanResponse): void {
    this.planToDelete = plan;
    showBillingModal(this.deleteConfirmModalOpen);
  }

  onSubmitCreate(): void {
    // Null serviceTypeId means no deployment; only name is required.
    if (!this.createForm.name?.trim()) return;

    const isNone = isNoneServiceTypeId(this.createForm.serviceTypeId);
    const serviceTypeId = isNone ? null : this.createForm.serviceTypeId!.trim();

    this.typesAndProviders$.pipe(take(1)).subscribe(({ serviceTypes, providerDetails }) => {
      if (!isNone && serviceTypeId) {
        this.pruneInvalidProvisioningOptionKeys(serviceTypes, providerDetails, serviceTypeId, 'create');
      }

      this.cloudInitConfigs$.pipe(take(1)).subscribe((cloudInitConfigs) => {
        if (!isNone) {
          this.pruneInactiveCustomProvisioningOptionKeys(cloudInitConfigs, 'create');
        }

        const providerConfigDefaults = isNone
          ? {}
          : this.buildProviderConfigDefaultsForSubmit(
              this.createForm.providerConfigDefaults,
              this.createProvisioningOptionKeys,
              'create',
            );
        const orderingHighlights = this.sanitizeOrderingHighlights(this.createForm.orderingHighlights);

        this.plansFacade.createServicePlan({
          serviceTypeId,
          name: this.createForm.name.trim(),
          description: this.createForm.description?.trim() || undefined,
          billingIntervalType: this.createForm.billingIntervalType,
          billingIntervalValue: Number(this.createForm.billingIntervalValue) || 1,
          billingDayOfMonth:
            this.createForm.billingDayOfMonth != null ? Number(this.createForm.billingDayOfMonth) : undefined,
          cancelAtPeriodEnd: this.createForm.cancelAtPeriodEnd ?? true,
          billInAdvance: this.createForm.billInAdvance === true,
          autoRecalculatePriceDaily: isNone ? false : this.createForm.autoRecalculatePriceDaily === true,
          minCommitmentDays: Number(this.createForm.minCommitmentDays) || 0,
          noticeDays: Number(this.createForm.noticeDays) || 0,
          basePrice: this.createForm.basePrice?.trim() || undefined,
          marginPercent: this.createForm.marginPercent?.trim() || undefined,
          marginFixed: this.createForm.marginFixed?.trim() || undefined,
          providerConfigDefaults: Object.keys(providerConfigDefaults).length > 0 ? providerConfigDefaults : undefined,
          orderingHighlights: orderingHighlights.length > 0 ? orderingHighlights : undefined,
          allowCustomerLocationSelection: isNone ? false : this.createForm.allowCustomerLocationSelection === true,
          allowCustomerServerTypeSelection: isNone ? false : this.createForm.allowCustomerServerTypeSelection === true,
          allowedServerTypes:
            !isNone && this.createForm.allowCustomerServerTypeSelection === true
              ? [...this.createAllowedServerTypes]
              : undefined,
          allowCustomerProviderSelection: isNone ? false : this.createForm.allowCustomerProviderSelection === true,
          allowedProviders: isNone
            ? undefined
            : this.supportsCustomerProviderSelection(serviceTypes, this.createForm.serviceTypeId)
              ? [...this.createAllowedProviders]
              : undefined,
          taxCategory: this.createForm.taxCategory ?? 'standard',
          isActive: this.createForm.isActive ?? true,
        });
      });
    });
  }

  onSubmitEdit(): void {
    if (!this.editForm.id) return;

    const isNone = isNoneServiceTypeId(this.editingPlan?.serviceTypeId);

    this.typesAndProviders$.pipe(take(1)).subscribe(({ serviceTypes, providerDetails }) => {
      const serviceTypeId = this.editingPlan?.serviceTypeId?.trim();

      if (serviceTypeId && !isNone) {
        this.pruneInvalidProvisioningOptionKeys(serviceTypes, providerDetails, serviceTypeId, 'edit');
      }

      this.cloudInitConfigs$.pipe(take(1)).subscribe((cloudInitConfigs) => {
        this.editStaleCustomConfigIds = isNone
          ? []
          : this.pruneInactiveCustomProvisioningOptionKeys(cloudInitConfigs, 'edit');

        const providerConfigDefaults = isNone
          ? {}
          : this.buildProviderConfigDefaultsForSubmit(
              this.editForm.providerConfigDefaults,
              this.editProvisioningOptionKeys,
              'edit',
            );
        const orderingHighlights = this.sanitizeOrderingHighlights(this.editForm.orderingHighlights);

        this.plansFacade.updateServicePlan(this.editForm.id, {
          name: this.editForm.name,
          description: this.editForm.description,
          billingIntervalType: this.editForm.billingIntervalType,
          billingIntervalValue: Number(this.editForm.billingIntervalValue) ?? 1,
          billingDayOfMonth:
            this.editForm.billingDayOfMonth != null ? Number(this.editForm.billingDayOfMonth) : undefined,
          cancelAtPeriodEnd: this.editForm.cancelAtPeriodEnd,
          billInAdvance: this.editForm.billInAdvance === true,
          autoRecalculatePriceDaily: isNone ? false : this.editForm.autoRecalculatePriceDaily === true,
          minCommitmentDays: Number(this.editForm.minCommitmentDays) ?? 0,
          noticeDays: Number(this.editForm.noticeDays) ?? 0,
          basePrice: this.editForm.basePrice?.trim() || undefined,
          marginPercent: this.editForm.marginPercent?.trim() || undefined,
          marginFixed: this.editForm.marginFixed?.trim() || undefined,
          providerConfigDefaults: Object.keys(providerConfigDefaults).length > 0 ? providerConfigDefaults : undefined,
          orderingHighlights,
          allowCustomerLocationSelection: isNone ? false : this.editForm.allowCustomerLocationSelection,
          allowCustomerServerTypeSelection: isNone ? false : this.editForm.allowCustomerServerTypeSelection,
          allowedServerTypes:
            !isNone && this.editForm.allowCustomerServerTypeSelection === true ? [...this.editAllowedServerTypes] : [],
          allowCustomerProviderSelection: isNone ? false : this.editForm.allowCustomerProviderSelection,
          allowedProviders: isNone
            ? []
            : this.supportsCustomerProviderSelection(serviceTypes, serviceTypeId)
              ? [...this.editAllowedProviders]
              : [],
          taxCategory: this.editForm.taxCategory ?? 'standard',
          migrateExistingSubscriptions: this.editForm.migrateExistingSubscriptions === true,
          isActive: this.editForm.isActive,
        });
      });
    });
  }

  confirmDelete(): void {
    if (!this.planToDelete) return;

    this.plansFacade.deleteServicePlan(this.planToDelete.id);
  }

  /** Coerce providerConfigDefaults values to number where schema says number. */
  private coerceProviderConfigDefaults(defaults: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!defaults || typeof defaults !== 'object') return {};

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(defaults)) {
      if (this.isProvisioningConfigKey(key)) {
        continue;
      }

      if (key === 'env' && value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = value;

        continue;
      }

      if (key === 'allowedAddonIds' && Array.isArray(value)) {
        const ids = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);

        if (ids.length > 0) result[key] = [...new Set(ids)];

        continue;
      }

      if (key === 'mandatoryAddonIds' && Array.isArray(value)) {
        const ids = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);

        if (ids.length > 0) result[key] = [...new Set(ids)];

        continue;
      }

      if (key === 'serverTypeByProvider' && value && typeof value === 'object' && !Array.isArray(value)) {
        const map: Record<string, string> = {};

        for (const [providerId, serverType] of Object.entries(value as Record<string, unknown>)) {
          const provider = typeof providerId === 'string' ? providerId.trim() : '';
          const typeId = typeof serverType === 'string' ? serverType.trim() : '';

          if (provider && typeId) {
            map[provider] = typeId;
          }
        }

        if (Object.keys(map).length > 0) {
          result[key] = map;
        }

        continue;
      }

      if (key === 'geographyByProvider' && value && typeof value === 'object' && !Array.isArray(value)) {
        const map: Record<string, string> = {};

        for (const [providerId, geography] of Object.entries(value as Record<string, unknown>)) {
          const provider = typeof providerId === 'string' ? providerId.trim() : '';
          const geo = typeof geography === 'string' ? geography.trim() : '';

          if (provider && geo) {
            map[provider] = geo;
          }
        }

        if (Object.keys(map).length > 0) {
          result[key] = map;
        }

        continue;
      }

      if (value === undefined || value === null || value === '') continue;

      const num = Number(value);

      result[key] = Number.isNaN(num) ? value : num;
    }

    return result;
  }

  private buildProviderConfigDefaultsForSubmit(
    defaults: Record<string, unknown> | undefined,
    optionKeys: Set<string>,
    form: 'create' | 'edit',
  ): Record<string, unknown> {
    const result = this.coerceProviderConfigDefaults(defaults);
    const provisioningOptions = buildProvisioningOptionsFromKeys(optionKeys);

    if (provisioningOptions.length > 0) {
      result['provisioningOptions'] = provisioningOptions;
    }

    const allowProviderSelection =
      form === 'create'
        ? this.createForm.allowCustomerProviderSelection === true
        : this.editForm.allowCustomerProviderSelection === true;
    const planAllowed = form === 'create' ? this.createAllowedProviders : this.editAllowedProviders;
    const inheritedProviders =
      this.providersForPlanGeography(form).length > 0
        ? this.providersForPlanGeography(form)
        : this.currentServerTypeGroups.map((group) => group.providerId);
    // Only prune when we know the effective provider set; never wipe maps while catalogs are still loading.
    const keepProviders = new Set(
      planAllowed.length > 0 ? planAllowed : allowProviderSelection ? inheritedProviders : planAllowed,
    );

    if (result['serverTypeByProvider'] && typeof result['serverTypeByProvider'] === 'object') {
      const raw = result['serverTypeByProvider'] as Record<string, unknown>;
      const pruned: Record<string, string> = {};

      for (const [providerId, serverType] of Object.entries(raw)) {
        if (keepProviders.size > 0 && !keepProviders.has(providerId)) {
          continue;
        }

        if (typeof serverType === 'string' && serverType.trim()) {
          pruned[providerId] = serverType.trim();
        }
      }

      if (Object.keys(pruned).length > 0) {
        result['serverTypeByProvider'] = pruned;
      } else {
        delete result['serverTypeByProvider'];
      }
    }

    if (result['geographyByProvider'] && typeof result['geographyByProvider'] === 'object') {
      const raw = result['geographyByProvider'] as Record<string, unknown>;
      const pruned: Record<string, string> = {};

      for (const [providerId, geography] of Object.entries(raw)) {
        if (keepProviders.size > 0 && !keepProviders.has(providerId)) {
          continue;
        }

        if (typeof geography === 'string' && geography.trim()) {
          pruned[providerId] = geography.trim();
        }
      }

      if (Object.keys(pruned).length > 0) {
        result['geographyByProvider'] = pruned;
      } else {
        delete result['geographyByProvider'];
      }
    }

    return result;
  }

  private resetProductDefaultsCollapse(form: 'create' | 'edit'): void {
    if (form === 'create') {
      this.createProductDefaultsExpanded.set(false);
      document.getElementById('createProductDefaults')?.classList.remove('show');
      return;
    }

    this.editProductDefaultsExpanded.set(false);
    document.getElementById('editProductDefaults')?.classList.remove('show');
  }

  private resetCreateForm(): void {
    this.createForm = this.getDefaultCreateForm();
    this.createProvisioningOptionKeys = new Set();
    this.createAttachedMeters = [];
    this.createAllowedProviders = [];
    this.resetPlanMeterAttachForm('create');
    this.planMeterAttachError = null;
  }

  private resetEditForm(): void {
    this.editForm = this.getDefaultEditForm();
    this.editingPlan = null;
    this.editStaleCustomConfigIds = [];
    this.editAttachedMeters = [];
    this.editAllowedProviders = [];
    this.resetPlanMeterAttachForm('edit');
    this.planMeterAttachError = null;
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        const pendingMeters = [...this.createAttachedMeters];
        this.resetCreateForm();
        this.flushPendingCreatePlanMeters(pendingMeters);
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetEditForm(),
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      open: this.deleteConfirmModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.planToDelete = null;
      },
    });
  }
}
