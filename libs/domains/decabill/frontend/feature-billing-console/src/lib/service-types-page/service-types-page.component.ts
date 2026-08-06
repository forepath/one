import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  MetersFacade,
  ServiceTypesFacade,
  ServiceTypesService,
  type AttachedMeterResponse,
  type CreateServiceTypeDto,
  type DeclaredMeterDefinition,
  type MeterResponse,
  type ProviderDetail,
  type ProviderEnvDefaultField,
  type ServiceTypeResponse,
  type UpdateServiceTypeDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { catchError, combineLatest, forkJoin, map, of, switchMap, take } from 'rxjs';

import { getActiveStatusLabel, getActiveStatusTextClass, getProviderDisplayName } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

type ServiceTypeFormMode = 'create' | 'edit';

@Component({
  selector: 'framework-billing-service-types-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './service-types-page.component.html',
  styleUrls: ['./service-types-page.component.scss'],
})
export class ServiceTypesPageComponent implements OnInit {
  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) private editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteConfirmModal', { static: false }) private deleteConfirmModal!: ElementRef<HTMLDivElement>;

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
  readonly editProviderDefaultsTouched = signal(false);
  readonly serviceTypes$ = combineLatest([
    this.facade.getServiceTypes$(),
    this.facade.getProviderDetails$(),
    this.searchQuery$,
  ]).pipe(
    map(([serviceTypes, providerDetails, searchQuery]) => {
      const filtered = !searchQuery.trim()
        ? serviceTypes
        : serviceTypes.filter((item) => JSON.stringify(item).toLowerCase().includes(searchQuery.trim().toLowerCase()));

      return { serviceTypes: filtered, providerDetails };
    }),
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

  createForm: CreateServiceTypeDto & { providerDefaults: Record<string, string> } = {
    key: '',
    name: '',
    description: '',
    provider: '',
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
    provider: '',
    disallowStatutoryWithdrawal: false,
    isActive: true,
    providerDefaults: {},
    providerDefaultsConfigured: {},
  };
  serviceTypeToDelete: ServiceTypeResponse | null = null;

  createAttachedMeters: AttachedMeterResponse[] = [];
  editAttachedMeters: AttachedMeterResponse[] = [];
  createMeterAttachMeterId = '';
  createMeterAttachUnitPrice = '';
  editMeterAttachMeterId = '';
  editMeterAttachUnitPrice = '';
  meterAttachLoading = false;
  meterAttachError: string | null = null;

  ngOnInit(): void {
    this.facade.loadServiceTypes();
    this.facade.loadProviderDetails();
    this.metersFacade.loadMeters();
    this.registerModalCloseWatchers();
  }

  openCreateModal(): void {
    this.resetCreateForm();
    showBillingModal(this.createModal);
  }

  openEditModal(st: ServiceTypeResponse): void {
    this.editForm = {
      id: st.id,
      name: st.name,
      description: st.description ?? '',
      provider: st.provider,
      disallowStatutoryWithdrawal: st.disallowStatutoryWithdrawal,
      isActive: st.isActive,
      providerDefaults: {},
      providerDefaultsConfigured: { ...(st.providerDefaultsConfigured ?? {}) },
    };
    this.editProviderDefaultsExpanded.set(false);
    this.editProviderDefaultsTouched.set(false);
    this.resetMeterAttachForm('edit');
    this.meterAttachError = null;
    this.loadServiceTypeAttachedMeters(st.id);
    showBillingModal(this.editModal);
  }

  openDeleteConfirm(st: ServiceTypeResponse): void {
    this.serviceTypeToDelete = st;
    showBillingModal(this.deleteConfirmModal);
  }

  providerLabel(providerId: string, providers: ProviderDetail[] | null | undefined): string {
    return getProviderDisplayName(providerId, providers);
  }

  activeStatusLabel(isActive: boolean): string {
    return getActiveStatusLabel(isActive);
  }

  activeStatusTextClass(isActive: boolean): string {
    return getActiveStatusTextClass(isActive);
  }

  hasProviderDefaultsSection(
    providerId: string | undefined,
    providerDetails: ProviderDetail[] | null | undefined,
  ): boolean {
    if (!providerId?.trim()) {
      return false;
    }

    return this.getProviderEnvDefaultFields(providerId, providerDetails).length > 0;
  }

  getProviderEnvDefaultFields(
    providerId: string | undefined,
    providerDetails: ProviderDetail[] | null | undefined,
  ): ProviderEnvDefaultField[] {
    if (!providerId?.trim()) {
      return [];
    }

    const provider = providerDetails?.find((item) => item.id === providerId);

    return provider?.envDefaultFields ?? [];
  }

  getProviderDeclaredMeters(
    providerId: string | undefined,
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

  onCreateProviderChange(): void {
    this.createForm.providerDefaults = {};
    this.createProviderDefaultsExpanded.set(false);
  }

  onEditProviderChange(): void {
    this.editForm.providerDefaults = {};
    this.editForm.providerDefaultsConfigured = {};
    this.editProviderDefaultsExpanded.set(false);
    this.editProviderDefaultsTouched.set(true);
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
    const providerId = mode === 'create' ? this.createForm.provider : this.editForm.provider;
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

      return;
    }

    this.editMeterAttachMeterId = '';
    this.editMeterAttachUnitPrice = '';
  }

  attachServiceTypeMeter(mode: ServiceTypeFormMode): void {
    const meterId = mode === 'create' ? this.createMeterAttachMeterId : this.editMeterAttachMeterId;
    const unitPriceRaw =
      mode === 'create' ? this.createMeterAttachUnitPrice.trim() : this.editMeterAttachUnitPrice.trim();

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

        this.createAttachedMeters = [
          ...this.createAttachedMeters,
          this.toPendingAttachedMeter(meter, Number.isFinite(override as number) ? override : null),
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
  ): void {
    const trimmed = unitPriceInput.trim();
    const override = trimmed ? Number(trimmed) : null;

    if (mode === 'create') {
      this.createAttachedMeters = this.createAttachedMeters.map((item) =>
        item.meterId === meter.meterId
          ? {
              ...item,
              unitPriceNetOverride: Number.isFinite(override as number) ? override : null,
              effectiveUnitPriceNet:
                Number.isFinite(override as number) && override != null ? override : item.defaultUnitPriceNet,
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

  onSubmitCreate(): void {
    if (!this.createForm.key?.trim() || !this.createForm.name?.trim() || !this.createForm.provider?.trim()) return;

    const providerDefaults = this.buildProviderDefaultsForSubmit('create');

    this.facade.createServiceType({
      key: this.createForm.key.trim(),
      name: this.createForm.name.trim(),
      description: this.createForm.description?.trim() || undefined,
      provider: this.createForm.provider.trim(),
      disallowStatutoryWithdrawal: this.createForm.disallowStatutoryWithdrawal ?? false,
      isActive: this.createForm.isActive ?? true,
      ...(Object.keys(providerDefaults).length > 0 ? { providerDefaults } : {}),
    });
  }

  onSubmitEdit(): void {
    if (!this.editForm.id) return;

    const providerDefaults = this.buildProviderDefaultsForSubmit('edit');

    this.facade.updateServiceType(this.editForm.id, {
      name: this.editForm.name,
      description: this.editForm.description,
      provider: this.editForm.provider,
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

  private toPendingAttachedMeter(meter: MeterResponse, unitPriceNetOverride: number | null): AttachedMeterResponse {
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
      provider: '',
      disallowStatutoryWithdrawal: false,
      isActive: true,
      providerDefaults: {},
    };
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
      provider: '',
      disallowStatutoryWithdrawal: false,
      isActive: true,
      providerDefaults: {},
      providerDefaultsConfigured: {},
    };
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
      modal: () => this.createModal,
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
      modal: () => this.editModal,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetEditForm(),
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      modal: () => this.deleteConfirmModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.serviceTypeToDelete = null;
      },
    });
  }
}
