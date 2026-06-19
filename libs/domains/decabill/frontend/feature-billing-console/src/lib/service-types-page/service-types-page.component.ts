import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ServiceTypesFacade,
  type CreateServiceTypeDto,
  type ProviderDetail,
  type ServiceTypeResponse,
  type UpdateServiceTypeDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { map, combineLatest } from 'rxjs';

import {
  getActiveStatusLabel,
  getActiveStatusTextClass,
  getProviderDisplayName,
  getUnavailableLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

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

  createForm: CreateServiceTypeDto = { key: '', name: '', description: '', provider: '', isActive: true };
  editForm: UpdateServiceTypeDto & { id: string } = { id: '', name: '', description: '', provider: '', isActive: true };
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
      isActive: st.isActive,
    };
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

  serviceTypeKeyLabel(key: string | null | undefined): string {
    const trimmed = key?.trim();

    return trimmed || getUnavailableLabel();
  }

  onSubmitCreate(): void {
    if (!this.createForm.key?.trim() || !this.createForm.name?.trim() || !this.createForm.provider?.trim()) return;

    this.facade.createServiceType({
      key: this.createForm.key.trim(),
      name: this.createForm.name.trim(),
      description: this.createForm.description?.trim() || undefined,
      provider: this.createForm.provider.trim(),
      isActive: this.createForm.isActive ?? true,
    });
  }

  onSubmitEdit(): void {
    if (!this.editForm.id) return;

    this.facade.updateServiceType(this.editForm.id, {
      name: this.editForm.name,
      description: this.editForm.description,
      provider: this.editForm.provider,
      isActive: this.editForm.isActive,
    });
  }

  confirmDelete(): void {
    if (!this.serviceTypeToDelete) return;

    this.facade.deleteServiceType(this.serviceTypeToDelete.id);
  }

  private resetCreateForm(): void {
    this.createForm = { key: '', name: '', description: '', provider: '', isActive: true };
  }

  private resetEditForm(): void {
    this.editForm = { id: '', name: '', description: '', provider: '', isActive: true };
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
