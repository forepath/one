import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ServiceTypesFacade,
  type CreateServiceTypeDto,
  type ProviderDetail,
  type ProviderEnvDefaultField,
  type ServiceTypeResponse,
  type UpdateServiceTypeDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { map, combineLatest } from 'rxjs';

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
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly createProviderDefaultsExpanded = signal(false);
  readonly editProviderDefaultsExpanded = signal(false);
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

  ngOnInit(): void {
    this.facade.loadServiceTypes();
    this.facade.loadProviderDetails();
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
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      modal: () => this.createModal,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetCreateForm(),
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
