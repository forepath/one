import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  MetersFacade,
  type CreateMeterDto,
  type MeterAggregator,
  type MeterResponse,
  type UpdateMeterDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
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
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';

import { getActiveStatusLabel, getActiveStatusTextClass, getMeterAggregatorLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

interface MeterForm {
  key: string;
  name: string;
  description: string;
  unitLabel: string;
  aggregator: MeterAggregator;
  defaultUnitPriceNet: number;
  defaultIncludedUsage: number;
  isActive: boolean;
}

@Component({
  selector: 'framework-billing-meters-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcFormSwitchComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './meters-page.component.html',
  styleUrls: ['./meters-page.component.scss'],
})
export class MetersPageComponent implements OnInit {
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteConfirmModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureMeters-title:Usage meters`;
  readonly addMeterAriaLabel = $localize`:@@featureMeters-add:Add meter`;
  readonly searchPlaceholder = $localize`:@@featureMeters-searchPlaceholder:Search meters`;

  private readonly facade = inject(MetersFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly meters$ = this.facade.getMeters$();
  readonly meters = toSignal(this.facade.getMeters$(), { initialValue: [] as MeterResponse[] });
  readonly loading$ = this.facade.getMetersLoading$();
  readonly loadingAny$ = this.facade.getMetersLoadingAny$();
  readonly creating$ = this.facade.getMetersCreating$();
  readonly updating$ = this.facade.getMetersUpdating$();
  readonly deleting$ = this.facade.getMetersDeleting$();
  readonly error$ = this.facade.getMetersError$();
  readonly aggregators: MeterAggregator[] = ['max', 'min', 'avg', 'first', 'last', 'sum', 'sum_positive_deltas'];

  createForm = this.defaultForm();
  editForm: MeterForm & { id: string } = { ...this.defaultForm(), id: '' };
  meterToDelete: MeterResponse | null = null;

  ngOnInit(): void {
    this.facade.loadMeters();
    this.registerModalCloseWatchers();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadMeters({ search: search.trim() || undefined });
      });
  }

  openCreateModal(): void {
    this.createForm = this.defaultForm();
    showBillingModal(this.createModalOpen);
  }

  openEditModal(meter: MeterResponse): void {
    this.editForm = {
      id: meter.id,
      key: meter.key,
      name: meter.name,
      description: meter.description ?? '',
      unitLabel: meter.unitLabel ?? '',
      aggregator: meter.aggregator,
      defaultUnitPriceNet: meter.defaultUnitPriceNet,
      defaultIncludedUsage: meter.defaultIncludedUsage ?? 0,
      isActive: meter.isActive,
    };
    showBillingModal(this.editModalOpen);
  }

  openDeleteConfirm(meter: MeterResponse): void {
    this.meterToDelete = meter;
    showBillingModal(this.deleteConfirmModalOpen);
  }

  onSubmitCreate(): void {
    if (!this.isValid(this.createForm)) return;

    this.facade.createMeter(this.buildCreateDto(this.createForm));
  }

  onSubmitEdit(): void {
    if (!this.editForm.id || !this.isValid(this.editForm)) return;

    this.facade.updateMeter(this.editForm.id, this.buildUpdateDto(this.editForm));
  }

  confirmDelete(): void {
    if (this.meterToDelete) this.facade.deleteMeter(this.meterToDelete.id);
  }

  activeStatusLabel(isActive: boolean): string {
    return getActiveStatusLabel(isActive);
  }

  activeStatusTextClass(isActive: boolean): string {
    return getActiveStatusTextClass(isActive);
  }

  aggregatorLabel(aggregator: MeterAggregator): string {
    return getMeterAggregatorLabel(aggregator);
  }

  formatUnitPrice(price: number): string {
    return `€${price.toFixed(4)}`;
  }

  private isValid(form: MeterForm): boolean {
    return Boolean(
      form.key.trim() && form.name.trim() && form.defaultUnitPriceNet >= 0 && form.defaultIncludedUsage >= 0,
    );
  }

  private buildCreateDto(form: MeterForm): CreateMeterDto {
    return {
      key: form.key.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      unitLabel: form.unitLabel.trim() || undefined,
      aggregator: form.aggregator,
      defaultUnitPriceNet: Number(form.defaultUnitPriceNet) || 0,
      defaultIncludedUsage: Number(form.defaultIncludedUsage) || 0,
      isActive: form.isActive,
    };
  }

  private buildUpdateDto(form: MeterForm): UpdateMeterDto {
    return {
      name: form.name.trim(),
      description: form.description.trim() || null,
      unitLabel: form.unitLabel.trim() || null,
      aggregator: form.aggregator,
      defaultUnitPriceNet: Number(form.defaultUnitPriceNet) || 0,
      defaultIncludedUsage: Number(form.defaultIncludedUsage) || 0,
      isActive: form.isActive,
    };
  }

  private defaultForm(): MeterForm {
    return {
      key: '',
      name: '',
      description: '',
      unitLabel: '',
      aggregator: 'max',
      defaultUnitPriceNet: 0,
      defaultIncludedUsage: 0,
      isActive: true,
    };
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = this.defaultForm();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.editForm = { ...this.defaultForm(), id: '' };
      },
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      open: this.deleteConfirmModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.meterToDelete = null;
      },
    });
  }
}
