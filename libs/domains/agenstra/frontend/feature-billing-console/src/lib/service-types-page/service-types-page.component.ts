import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ServiceTypesFacade,
  type CreateServiceTypeDto,
  type ServiceTypeResponse,
  type UpdateServiceTypeDto,
} from '@forepath/agenstra/frontend/data-access-billing-console';
import { filter, pairwise } from 'rxjs';

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

  readonly serviceTypes$ = this.facade.getServiceTypes$();
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
    this.facade
      .getServiceTypesCreating$()
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.createModal);
        this.resetCreateForm();
      });
    this.facade
      .getServiceTypesUpdating$()
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.editModal);
        this.resetEditForm();
      });
    this.facade
      .getServiceTypesDeleting$()
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev === true && curr === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.deleteConfirmModal);
        this.serviceTypeToDelete = null;
      });
  }

  openCreateModal(): void {
    this.resetCreateForm();
    this.showModal(this.createModal);
  }

  openEditModal(st: ServiceTypeResponse): void {
    this.editForm = {
      id: st.id,
      name: st.name,
      description: st.description ?? '',
      provider: st.provider,
      isActive: st.isActive,
    };
    this.showModal(this.editModal);
  }

  openDeleteConfirm(st: ServiceTypeResponse): void {
    this.serviceTypeToDelete = st;
    this.showModal(this.deleteConfirmModal);
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
    if (this.serviceTypeToDelete) {
      this.facade.deleteServiceType(this.serviceTypeToDelete.id);
    }
  }

  private resetCreateForm(): void {
    this.createForm = { key: '', name: '', description: '', provider: '', isActive: true };
  }

  private resetEditForm(): void {
    this.editForm = { id: '', name: '', description: '', provider: '', isActive: true };
  }

  private showModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (
        window as unknown as {
          bootstrap?: { Modal?: { getOrCreateInstance: (el: HTMLElement) => { show: () => void } } };
        }
      ).bootstrap?.Modal?.getOrCreateInstance(modalElement.nativeElement);

      if (modal) modal.show();
    }
  }

  private hideModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (
        window as unknown as {
          bootstrap?: { Modal?: { getInstance: (el: HTMLElement) => { hide: () => void } | null } };
        }
      ).bootstrap?.Modal?.getInstance(modalElement.nativeElement);

      if (modal) modal.hide();
    }
  }
}
