import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  MetersFacade,
  ServiceTypesFacade,
  ServiceTypesService,
  normalizeAllowedProviders,
  providersAreCompatible,
  type AttachedMeterResponse,
  type CreateServiceTypeDto,
  type DeclaredMeterDefinition,
  type MeterResponse,
  type ProviderDetail,
  type ProviderEnvDefaultField,
  type ServiceTypeResponse,
  type UpdateServiceTypeDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcConfirmDialogComponent,
  FpcFormSwitchComponent,
  FpcListComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  forkJoin,
  map,
  of,
  skip,
  switchMap,
  take,
} from 'rxjs';

import { getActiveStatusLabel, getActiveStatusTextClass, getProviderDisplayName } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { optionalNumberInputValue } from '../optional-number-input.util';

type ServiceTypeFormMode = 'create' | 'edit';

/** Sentinel value for the persistent None option in the multi-select. */
const NONE_PROVIDER_SENTINEL = '';

@Component({
  selector: 'framework-billing-service-types-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcListItemComponent,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './service-types-page.component.html',
  styleUrls: ['./service-types-page.component.scss'],
})
export class ServiceTypesPageComponent implements OnInit {
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteConfirmModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureServiceTypes-title:Service Providers`;
  readonly addServiceProviderAriaLabel = $localize`:@@featureServiceTypes-add:Add service provider`;
  readonly searchPlaceholder = $localize`:@@featureServiceTypes-searchPlaceholder:Search providers`;

  private readonly facade = inject(ServiceTypesFacade);
  private readonly serviceTypesService = inject(ServiceTypesService);
  private readonly metersFacade = inject(MetersFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly createProviderDefaultsExpanded = signal(false);
  readonly editProviderDefaultsExpanded = signal(false);
  readonly showProviderDefaultsLabel = $localize`:@@featureServiceTypes-showProviderDefaults:Show`;
  readonly hideProviderDefaultsLabel = $localize`:@@featureServiceTypes-hideProviderDefaults:Hide`;
  readonly noneProviderLabel = $localize`:@@featureServiceTypes-noneProvider:None`;
  readonly noneProviderValue = NONE_PROVIDER_SENTINEL;
  readonly editProviderDefaultsTouched = signal(false);
  readonly serviceTypes$ = combineLatest([this.facade.getServiceTypes$(), this.facade.getProviderDetails$()]).pipe(
    map(([serviceTypes, providerDetails]) => ({ serviceTypes, providerDetails })),
  );
  readonly providerDetails$ = this.facade.getProviderDetails$();
  readonly providerDetailsLoading$ = this.facade.getProviderDetailsLoading$();
  readonly loading$ = this.facade.getServiceTypesLoading$();
  readonly loadingAny$ = this.facade.getServiceTypesLoadingAny$();
  readonly error$ = this.facade.getServiceTypesError$();
  readonly creating$ = this.facade.getServiceTypesCreating$();
  readonly updating$ = this.facade.getServiceTypesUpdating$();
  readonly deleting$ = this.facade.getServiceTypesDeleting$();
  readonly activeMeters$ = this.metersFacade
    .getMeters$()
    .pipe(map((meters) => meters.filter((meter) => meter.isActive)));

  /** Multi-select model; includes None sentinel or real provider ids (first = primary). */
  createSelectedProviders: string[] = [NONE_PROVIDER_SENTINEL];
  editSelectedProviders: string[] = [NONE_PROVIDER_SENTINEL];

  createForm: CreateServiceTypeDto & { providerDefaults: Record<string, string> } = {
    key: '',
    name: '',
    description: '',
    provider: null,
    allowedProviders: [],
    disallowStatutoryWithdrawal: false,
    isActive: true,
    providerDefaults: {},
  };
  editForm: UpdateServiceTypeDto & {
    id: string;
    providerDefaults: Record<string, string>;
    providerDefaultsConfigured: Record<string, boolean>;
  } = {
    id: '',
    name: '',
    description: '',
    provider: null,
    allowedProviders: [],
    disallowStatutoryWithdrawal: false,
    isActive: true,
    providerDefaults: {},
    providerDefaultsConfigured: {},
  };
  serviceTypeToDelete: ServiceTypeResponse | null = null;

  createAttachedMeters: AttachedMeterResponse[] = [];
  editAttachedMeters: AttachedMeterResponse[] = [];
  createMeterAttachMeterId = '';
  createMeterAttachUnitPrice: string | number | null = '';
  createMeterAttachIncludedUsage: string | number | null = '';
  editMeterAttachMeterId = '';
  editMeterAttachUnitPrice: string | number | null = '';
  editMeterAttachIncludedUsage: string | number | null = '';
  meterAttachLoading = false;
  meterAttachError: string | null = null;

  ngOnInit(): void {
    this.facade.loadServiceTypes();
    this.facade.loadProviderDetails();
    this.metersFacade.loadMeters();
    this.registerModalCloseWatchers();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadServiceTypes({ search: search.trim() || undefined });
      });
  }

  openCreateModal(): void {
    this.resetCreateForm();
    showBillingModal(this.createModalOpen);
  }

  openEditModal(st: ServiceTypeResponse): void {
    const allowedProviders = this.resolveServiceTypeAllowedProviders(st);

    this.editForm = {
      id: st.id,
      name: st.name,
      description: st.description ?? '',
      provider: allowedProviders[0] ?? null,
      allowedProviders: [...allowedProviders],
      disallowStatutoryWithdrawal: st.disallowStatutoryWithdrawal,
      isActive: st.isActive,
      providerDefaults: {},
      providerDefaultsConfigured: { ...(st.providerDefaultsConfigured ?? {}) },
    };
    this.editSelectedProviders = allowedProviders.length > 0 ? [...allowedProviders] : [NONE_PROVIDER_SENTINEL];
    this.editProviderDefaultsExpanded.set(false);
    this.editProviderDefaultsTouched.set(false);
    this.resetMeterAttachForm('edit');
    this.meterAttachError = null;
    this.loadServiceTypeAttachedMeters(st.id);
    showBillingModal(this.editModalOpen);
  }

  openDeleteConfirm(st: ServiceTypeResponse): void {
    this.serviceTypeToDelete = st;
    showBillingModal(this.deleteConfirmModalOpen);
  }

  providerLabel(providerId: string | null | undefined, providers: ProviderDetail[] | null | undefined): string {
    return getProviderDisplayName(providerId, providers);
  }

  /**
   * List column: None, single primary label, or primary + count of additional providers.
   */
  providersListLabel(st: ServiceTypeResponse, providers: ProviderDetail[] | null | undefined): string {
    const allowed = this.resolveServiceTypeAllowedProviders(st);

    if (allowed.length === 0) {
      return this.noneProviderLabel;
    }

    const primaryLabel = this.providerLabel(allowed[0], providers);

    if (allowed.length === 1) {
      return primaryLabel;
    }

    const extraCount = allowed.length - 1;

    return $localize`:@@featureServiceTypes-providersPrimaryPlusCount:${primaryLabel}:primary: (+${extraCount}:extraCount:)`;
  }

  activeStatusLabel(isActive: boolean): string {
    return getActiveStatusLabel(isActive);
  }

  activeStatusTextClass(isActive: boolean): string {
    return getActiveStatusTextClass(isActive);
  }

  selectedProvidersFor(mode: ServiceTypeFormMode): string[] {
    return mode === 'create' ? this.createSelectedProviders : this.editSelectedProviders;
  }

  primaryProviderId(mode: ServiceTypeFormMode): string | null {
    const allowed = normalizeAllowedProviders(
      mode === 'create' ? this.createForm.allowedProviders : this.editForm.allowedProviders,
    );

    return allowed[0] ?? null;
  }

  compareProviderId = (left: string | null | undefined, right: string | null | undefined): boolean => left === right;

  isProviderOptionDisabled(
    mode: ServiceTypeFormMode,
    provider: ProviderDetail,
    providerDetails: ProviderDetail[] | null | undefined,
  ): boolean {
    const selected = normalizeAllowedProviders(this.selectedProvidersFor(mode));

    if (selected.length === 0) {
      return false;
    }

    const primaryId = selected[0];

    if (provider.id === primaryId) {
      return false;
    }

    const primary = providerDetails?.find((item) => item.id === primaryId);

    if (!primary) {
      return false;
    }

    return !providersAreCompatible(primary, provider);
  }

  onProvidersSelectionChange(
    mode: ServiceTypeFormMode,
    selectedIds: unknown,
    providerDetails: ProviderDetail[] | null | undefined,
  ): void {
    const previous = this.selectedProvidersFor(mode);
    const nextRaw = Array.isArray(selectedIds) ? selectedIds.map(String) : [];
    const hadNone = previous.includes(NONE_PROVIDER_SENTINEL);
    const hasNone = nextRaw.includes(NONE_PROVIDER_SENTINEL);
    const realNext = normalizeAllowedProviders(nextRaw.filter((id) => id !== NONE_PROVIDER_SENTINEL));

    if (hasNone && !hadNone) {
      this.applyProviderSelection(mode, []);

      return;
    }

    if (hasNone && realNext.length === 0) {
      this.applyProviderSelection(mode, []);

      return;
    }

    let allowed = realNext;

    if (allowed.length > 0 && providerDetails?.length) {
      const primary = providerDetails.find((item) => item.id === allowed[0]);

      if (primary) {
        allowed = allowed.filter((id) => {
          const other = providerDetails.find((item) => item.id === id);

          return other != null && providersAreCompatible(primary, other);
        });
      }
    }

    this.applyProviderSelection(mode, allowed);
  }

  private applyProviderSelection(mode: ServiceTypeFormMode, allowedProviders: string[]): void {
    const normalized = normalizeAllowedProviders(allowedProviders);
    const previousPrimary = this.primaryProviderId(mode);
    const nextPrimary = normalized[0] ?? null;
    const selectionChanged =
      previousPrimary !== nextPrimary ||
      JSON.stringify(mode === 'create' ? this.createForm.allowedProviders : this.editForm.allowedProviders) !==
        JSON.stringify(normalized);

    if (mode === 'create') {
      this.createForm.provider = nextPrimary;
      this.createForm.allowedProviders = [...normalized];
      this.createSelectedProviders = normalized.length > 0 ? [...normalized] : [NONE_PROVIDER_SENTINEL];

      if (selectionChanged) {
        this.createForm.providerDefaults = {};
        this.createProviderDefaultsExpanded.set(false);
      }

      return;
    }

    this.editForm.provider = nextPrimary;
    this.editForm.allowedProviders = [...normalized];
    this.editSelectedProviders = normalized.length > 0 ? [...normalized] : [NONE_PROVIDER_SENTINEL];

    if (selectionChanged) {
      this.editForm.providerDefaults = {};
      this.editForm.providerDefaultsConfigured = {};
      this.editProviderDefaultsExpanded.set(false);
      this.editProviderDefaultsTouched.set(true);
    }
  }

  hasProviderDefaultsSection(mode: ServiceTypeFormMode, providerDetails: ProviderDetail[] | null | undefined): boolean {
    return this.getProviderDefaultsGroups(mode, providerDetails).some((group) => group.fields.length > 0);
  }

  /**
   * Env default fields grouped by selected provider (order matches allowedProviders).
   * Used so multi-provider service types show transparent rounded groups with an intro per provider.
   */
  getProviderDefaultsGroups(
    mode: ServiceTypeFormMode,
    providerDetails: ProviderDetail[] | null | undefined,
  ): Array<{ providerId: string; label: string; fields: ProviderEnvDefaultField[] }> {
    const allowed = normalizeAllowedProviders(
      mode === 'create' ? this.createForm.allowedProviders : this.editForm.allowedProviders,
    );

    return allowed
      .map((providerId) => {
        const detail = providerDetails?.find((item) => item.id === providerId);

        return {
          providerId,
          label: detail?.displayName?.trim() || providerId,
          fields: this.getProviderEnvDefaultFields(providerId, providerDetails),
        };
      })
      .filter((group) => group.fields.length > 0);
  }

  getSelectedProvidersEnvDefaultFields(
    mode: ServiceTypeFormMode,
    providerDetails: ProviderDetail[] | null | undefined,
  ): ProviderEnvDefaultField[] {
    const fields: ProviderEnvDefaultField[] = [];
    const seen = new Set<string>();

    for (const group of this.getProviderDefaultsGroups(mode, providerDetails)) {
      for (const field of group.fields) {
        if (seen.has(field.envKey)) {
          continue;
        }

        seen.add(field.envKey);
        fields.push(field);
      }
    }

    return fields;
  }

  getProviderEnvDefaultFields(
    providerId: string | null | undefined,
    providerDetails: ProviderDetail[] | null | undefined,
  ): ProviderEnvDefaultField[] {
    if (!providerId?.trim()) {
      return [];
    }

    const provider = providerDetails?.find((item) => item.id === providerId);

    return provider?.envDefaultFields ?? [];
  }

  getProviderDeclaredMeters(
    providerId: string | null | undefined,
    providerDetails: ProviderDetail[] | null | undefined,
  ): DeclaredMeterDefinition[] {
    if (!providerId?.trim()) {
      return [];
    }

    const provider = providerDetails?.find((item) => item.id === providerId);

    return provider?.meters ?? [];
  }

  getProviderDefaultValue(mode: ServiceTypeFormMode, envKey: string): string {
    const form = mode === 'create' ? this.createForm : this.editForm;

    return form.providerDefaults[envKey] ?? '';
  }

  setProviderDefaultValue(mode: ServiceTypeFormMode, envKey: string, value: string): void {
    const form = mode === 'create' ? this.createForm : this.editForm;

    if (mode === 'edit') {
      this.editProviderDefaultsTouched.set(true);
    }

    form.providerDefaults = {
      ...form.providerDefaults,
      [envKey]: value,
    };
  }

  isProviderDefaultConfigured(mode: ServiceTypeFormMode, envKey: string): boolean {
    if (mode === 'create') {
      return false;
    }

    return this.editForm.providerDefaultsConfigured[envKey] === true;
  }

  private resolveServiceTypeAllowedProviders(st: ServiceTypeResponse): string[] {
    const fromList = normalizeAllowedProviders(st.allowedProviders);

    if (fromList.length > 0) {
      return fromList;
    }

    return normalizeAllowedProviders(st.provider ? [st.provider] : []);
  }

  attachedMetersFor(mode: ServiceTypeFormMode): AttachedMeterResponse[] {
    return mode === 'create' ? this.createAttachedMeters : this.editAttachedMeters;
  }

  availableMetersForAttach(
    meters: MeterResponse[] | null,
    mode: ServiceTypeFormMode,
    providerDetails: ProviderDetail[] | null | undefined,
  ): MeterResponse[] {
    const attachedIds = new Set(this.attachedMetersFor(mode).map((item) => item.meterId));
    const providerId = this.primaryProviderId(mode);
    const declaredKeys =
      mode === 'create'
        ? new Set(this.getProviderDeclaredMeters(providerId, providerDetails).map((item) => item.key))
        : new Set();

    return (meters ?? []).filter((meter) => !attachedIds.has(meter.id) && !declaredKeys.has(meter.key));
  }

  loadServiceTypeAttachedMeters(serviceTypeId: string): void {
    this.meterAttachLoading = true;
    this.meterAttachError = null;
    this.serviceTypesService
      .listServiceTypeMeters(serviceTypeId)
      .pipe(take(1))
      .subscribe({
        next: (meters) => {
          this.editAttachedMeters = meters;
          this.meterAttachLoading = false;
        },
        error: (error: unknown) => {
          this.meterAttachError = this.formatMeterHttpError(error, 'Failed to load service type meters');
          this.meterAttachLoading = false;
        },
      });
  }

  resetMeterAttachForm(mode: ServiceTypeFormMode): void {
    if (mode === 'create') {
      this.createMeterAttachMeterId = '';
      this.createMeterAttachUnitPrice = '';
      this.createMeterAttachIncludedUsage = '';

      return;
    }

    this.editMeterAttachMeterId = '';
    this.editMeterAttachUnitPrice = '';
    this.editMeterAttachIncludedUsage = '';
  }

  attachServiceTypeMeter(mode: ServiceTypeFormMode): void {
    const meterId = mode === 'create' ? this.createMeterAttachMeterId : this.editMeterAttachMeterId;
    const unitPriceRaw = optionalNumberInputValue(
      mode === 'create' ? this.createMeterAttachUnitPrice : this.editMeterAttachUnitPrice,
    );
    const includedUsageRaw = optionalNumberInputValue(
      mode === 'create' ? this.createMeterAttachIncludedUsage : this.editMeterAttachIncludedUsage,
    );

    if (!meterId) {
      return;
    }

    if (mode === 'create') {
      this.meterAttachError = null;
      this.activeMeters$.pipe(take(1)).subscribe((meters) => {
        const meter = meters.find((item) => item.id === meterId);

        if (!meter) {
          this.meterAttachError = 'Selected meter is not available';

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
        this.resetMeterAttachForm('create');
      });

      return;
    }

    if (!this.editForm.id) {
      return;
    }

    this.meterAttachLoading = true;
    this.meterAttachError = null;
    this.serviceTypesService
      .attachServiceTypeMeter(this.editForm.id, {
        meterId,
        unitPriceNet: unitPriceRaw ? Number(unitPriceRaw) : undefined,
        includedUsage: includedUsageRaw ? Number(includedUsageRaw) : undefined,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.resetMeterAttachForm('edit');
          this.loadServiceTypeAttachedMeters(this.editForm.id);
        },
        error: (error: unknown) => {
          this.meterAttachError = this.formatMeterHttpError(error, 'Failed to attach meter');
          this.meterAttachLoading = false;
        },
      });
  }

  updateAttachedServiceTypeMeter(
    mode: ServiceTypeFormMode,
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

    if (!this.editForm.id) {
      return;
    }

    this.meterAttachLoading = true;
    this.meterAttachError = null;
    this.serviceTypesService
      .updateServiceTypeMeter(this.editForm.id, meter.meterId, {
        unitPriceNet: trimmed ? Number(trimmed) : null,
        includedUsage: includedTrimmed ? Number(includedTrimmed) : null,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.loadServiceTypeAttachedMeters(this.editForm.id);
        },
        error: (error: unknown) => {
          this.meterAttachError = this.formatMeterHttpError(error, 'Failed to update meter price');
          this.meterAttachLoading = false;
        },
      });
  }

  detachServiceTypeMeter(mode: ServiceTypeFormMode, meter: AttachedMeterResponse): void {
    if (meter.required) {
      return;
    }

    if (mode === 'create') {
      this.createAttachedMeters = this.createAttachedMeters.filter((item) => item.meterId !== meter.meterId);

      return;
    }

    if (!this.editForm.id) {
      return;
    }

    this.meterAttachLoading = true;
    this.meterAttachError = null;
    this.serviceTypesService
      .detachServiceTypeMeter(this.editForm.id, meter.meterId)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.loadServiceTypeAttachedMeters(this.editForm.id);
        },
        error: (error: unknown) => {
          this.meterAttachError = this.formatMeterHttpError(error, 'Failed to detach meter');
          this.meterAttachLoading = false;
        },
      });
  }

  attachedMeterOverrideInput(meter: AttachedMeterResponse): string {
    return meter.unitPriceNetOverride != null ? String(meter.unitPriceNetOverride) : '';
  }

  attachedMeterIncludedUsageOverrideInput(meter: AttachedMeterResponse): string {
    return meter.includedUsageOverride != null ? String(meter.includedUsageOverride) : '';
  }

  onSubmitCreate(): void {
    if (!this.createForm.key?.trim() || !this.createForm.name?.trim()) return;

    const allowedProviders = normalizeAllowedProviders(this.createForm.allowedProviders);
    const provider = allowedProviders[0] ?? null;
    const providerDefaults = this.buildProviderDefaultsForSubmit('create');

    this.facade.createServiceType({
      key: this.createForm.key.trim(),
      name: this.createForm.name.trim(),
      description: this.createForm.description?.trim() || undefined,
      provider,
      allowedProviders,
      disallowStatutoryWithdrawal: this.createForm.disallowStatutoryWithdrawal ?? false,
      isActive: this.createForm.isActive ?? true,
      ...(Object.keys(providerDefaults).length > 0 ? { providerDefaults } : {}),
    });
  }

  onSubmitEdit(): void {
    if (!this.editForm.id) return;

    const allowedProviders = normalizeAllowedProviders(this.editForm.allowedProviders);
    const provider = allowedProviders[0] ?? null;
    const providerDefaults = this.buildProviderDefaultsForSubmit('edit');

    this.facade.updateServiceType(this.editForm.id, {
      name: this.editForm.name,
      description: this.editForm.description,
      provider,
      allowedProviders,
      disallowStatutoryWithdrawal: this.editForm.disallowStatutoryWithdrawal,
      isActive: this.editForm.isActive,
      ...(this.editProviderDefaultsTouched() ? { providerDefaults } : {}),
    });
  }

  confirmDelete(): void {
    if (!this.serviceTypeToDelete) return;

    this.facade.deleteServiceType(this.serviceTypeToDelete.id);
  }

  private buildProviderDefaultsForSubmit(mode: ServiceTypeFormMode): Record<string, string> {
    const form = mode === 'create' ? this.createForm : this.editForm;
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(form.providerDefaults)) {
      const trimmed = value?.trim() ?? '';

      if (trimmed) {
        result[key] = trimmed;
      }
    }

    return result;
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

  private flushPendingCreateMeters(pendingMeters?: AttachedMeterResponse[]): void {
    const pending = pendingMeters ?? [...this.createAttachedMeters];

    if (pending.length === 0) {
      return;
    }

    this.facade
      .getSelectedServiceType$()
      .pipe(
        take(1),
        switchMap((serviceType) => {
          if (!serviceType) {
            return of(null);
          }

          return forkJoin(
            pending.map((meter) =>
              this.serviceTypesService
                .attachServiceTypeMeter(serviceType.id, {
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
      .subscribe();
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

    return fallback;
  }

  private resetCreateForm(): void {
    this.createForm = {
      key: '',
      name: '',
      description: '',
      provider: null,
      allowedProviders: [],
      disallowStatutoryWithdrawal: false,
      isActive: true,
      providerDefaults: {},
    };
    this.createSelectedProviders = [NONE_PROVIDER_SENTINEL];
    this.createProviderDefaultsExpanded.set(false);
    this.createAttachedMeters = [];
    this.resetMeterAttachForm('create');
    this.meterAttachError = null;
  }

  private resetEditForm(): void {
    this.editForm = {
      id: '',
      name: '',
      description: '',
      provider: null,
      allowedProviders: [],
      disallowStatutoryWithdrawal: false,
      isActive: true,
      providerDefaults: {},
      providerDefaultsConfigured: {},
    };
    this.editSelectedProviders = [NONE_PROVIDER_SENTINEL];
    this.editProviderDefaultsExpanded.set(false);
    this.editProviderDefaultsTouched.set(false);
    this.editAttachedMeters = [];
    this.resetMeterAttachForm('edit');
    this.meterAttachError = null;
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
        this.flushPendingCreateMeters(pendingMeters);
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
        this.serviceTypeToDelete = null;
      },
    });
  }
}
