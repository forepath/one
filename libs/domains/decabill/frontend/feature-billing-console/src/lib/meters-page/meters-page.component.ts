import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  MetersFacade,
  type CreateMeterDto,
  type MeterAggregator,
  type MeterResponse,
  type UpdateMeterDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { combineLatest, map } from 'rxjs';

import { getActiveStatusLabel, getActiveStatusTextClass } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

interface MeterForm {
  key: string;
  name: string;
  description: string;
  unitLabel: string;
  aggregator: MeterAggregator;
  defaultUnitPriceNet: number;
  isActive: boolean;
}

@Component({
  selector: 'framework-billing-meters-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './meters-page.component.html',
  styleUrls: ['./meters-page.component.scss'],
})
export class MetersPageComponent implements OnInit {
  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) private editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteConfirmModal', { static: false }) private deleteConfirmModal!: ElementRef<HTMLDivElement>;

  private readonly facade = inject(MetersFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly meters$ = combineLatest([this.facade.getMeters$(), this.searchQuery$]).pipe(
    map(([meters, query]) => {
      const term = query.trim().toLowerCase();

      return term ? meters.filter((meter) => JSON.stringify(meter).toLowerCase().includes(term)) : meters;
    }),
  );
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
  }

  openCreateModal(): void {
    this.createForm = this.defaultForm();
    showBillingModal(this.createModal);
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
      isActive: meter.isActive,
    };
    showBillingModal(this.editModal);
  }

  openDeleteConfirm(meter: MeterResponse): void {
    this.meterToDelete = meter;
    showBillingModal(this.deleteConfirmModal);
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
    switch (aggregator) {
      case 'max':
        return $localize`:@@featureMeters-aggregatorMax:Max`;
      case 'min':
        return $localize`:@@featureMeters-aggregatorMin:Min`;
      case 'avg':
        return $localize`:@@featureMeters-aggregatorAvg:Average`;
      case 'first':
        return $localize`:@@featureMeters-aggregatorFirst:First`;
      case 'last':
        return $localize`:@@featureMeters-aggregatorLast:Last`;
      case 'sum':
        return $localize`:@@featureMeters-aggregatorSum:Sum`;
      case 'sum_positive_deltas':
        return $localize`:@@featureMeters-aggregatorSumPositiveDeltas:Sum of positive deltas`;
      default:
        return aggregator;
    }
  }

  formatUnitPrice(price: number): string {
    return `€${price.toFixed(4)}`;
  }

  private isValid(form: MeterForm): boolean {
    return Boolean(form.key.trim() && form.name.trim() && form.defaultUnitPriceNet >= 0);
  }

  private buildCreateDto(form: MeterForm): CreateMeterDto {
    return {
      key: form.key.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      unitLabel: form.unitLabel.trim() || undefined,
      aggregator: form.aggregator,
      defaultUnitPriceNet: Number(form.defaultUnitPriceNet) || 0,
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
      isActive: true,
    };
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      modal: () => this.createModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = this.defaultForm();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      modal: () => this.editModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.editForm = { ...this.defaultForm(), id: '' };
      },
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      modal: () => this.deleteConfirmModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.meterToDelete = null;
      },
    });
  }
}
