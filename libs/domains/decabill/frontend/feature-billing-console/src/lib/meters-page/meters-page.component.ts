import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  MetersFacade,
  MetersService,
  type CreateMeterDto,
  type MeterAggregator,
  type MeterResponse,
  type UpdateMeterDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, firstValueFrom, skip } from 'rxjs';

import { getMeterAggregatorLabel } from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { DB_DL_CANCEL, DB_DL_DELETE, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { activeState } from '../shared/table-states';
import { formatBillingMoney } from '../billing-format';

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
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
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
  private readonly metersService = inject(MetersService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly meters = toSignal(this.facade.getMeters$(), { initialValue: [] as MeterResponse[] });
  readonly loading$ = this.facade.getMetersLoading$();
  readonly loadingAny$ = this.facade.getMetersLoadingAny$();
  readonly creating$ = this.facade.getMetersCreating$();
  readonly updating$ = this.facade.getMetersUpdating$();
  readonly deleting$ = this.facade.getMetersDeleting$();
  readonly error$ = this.facade.getMetersError$();
  readonly aggregators: MeterAggregator[] = ['max', 'min', 'avg', 'first', 'last', 'sum', 'sum_positive_deltas'];

  readonly columns: FpcTableColumn<MeterResponse>[] = [
    {
      id: 'status',
      label: $localize`:@@featureMeters-colStatus:Status`,
      type: 'state',
      state: (meter) => activeState(meter.isActive),
    },
    {
      id: 'name',
      label: $localize`:@@featureMeters-name:Name`,
      value: (meter) => meter.name,
      required: true,
      priority: 1,
    },
    {
      id: 'key',
      label: $localize`:@@featureMeters-key:Key`,
      value: (meter) => meter.key,
      mono: true,
      priority: 2,
    },
    {
      id: 'aggregator',
      label: $localize`:@@featureMeters-aggregator:Aggregator`,
      value: (meter) => getMeterAggregatorLabel(meter.aggregator),
      priority: 2,
    },
    {
      id: 'unit',
      label: $localize`:@@featureMeters-unitLabel:Unit label`,
      value: (meter) => meter.unitLabel ?? '',
      priority: 3,
    },
    {
      id: 'price',
      label: $localize`:@@featureMeters-defaultUnitPriceNet:Default unit price (net)`,
      value: (meter) => this.formatUnitPrice(meter.defaultUnitPriceNet),
      align: 'end',
      priority: 1,
    },
    {
      id: 'included',
      label: $localize`:@@featureMeters-defaultIncludedUsage:Default included usage`,
      value: (meter) => (meter.defaultIncludedUsage > 0 ? meter.defaultIncludedUsage : ''),
      align: 'end',
      priority: 3,
    },
  ];

  readonly editLabel = $localize`:@@featureMeters-edit:Edit meter`;
  readonly deleteLabel = DB_DL_DELETE;
  readonly cancelLabel = DB_DL_CANCEL;
  readonly activateLabel = $localize`:@@featureMeters-bulkActivate:Activate`;
  readonly deactivateLabel = $localize`:@@featureMeters-bulkDeactivate:Deactivate`;
  readonly bulkDeleteTitle = $localize`:@@featureMeters-bulkDeleteTitle:Delete meters?`;

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly selectedMeters = computed(() => {
    const ids = new Set(this.selected());

    return this.meters().filter((meter) => ids.has(meter.id));
  });
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureMeters-bulkDeleteMessage:${this.selectedMeters().length}:count: selected meters will be deleted. This action cannot be undone.`,
  );
  readonly rowMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: this.editLabel, icon: 'pencil' },
    { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
    dbCopyIdItem(),
  ];

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

  onRowAction(meter: MeterResponse, action: string): void {
    if (action === 'edit') this.openEditModal(meter);
    else if (action === 'delete') this.openDeleteConfirm(meter);
    else if (action === 'copy-id') fpcCopyText(meter.id);
  }

  /** Bulk Activate / Deactivate: one `POST /meters/:id` per meter whose state changes (same call as Edit). */
  async setActiveSelected(isActive: boolean): Promise<void> {
    const meters = this.selectedMeters().filter((meter) => meter.isActive !== isActive);

    if (meters.length === 0) return;

    const result = await fpcRunBulk(meters, (meter) =>
      firstValueFrom(this.metersService.updateMeter(meter.id, { isActive })),
    );

    this.finishBulk(dbBulkSummary(result, (meter) => meter.name));
  }

  /** Bulk Delete: one `DELETE /meters/:id` per meter. */
  async deleteSelected(): Promise<void> {
    const meters = this.selectedMeters();

    if (meters.length === 0) return;

    const result = await fpcRunBulk(meters, (meter) => firstValueFrom(this.metersService.deleteMeter(meter.id)));

    this.finishBulk(dbBulkSummary(result, (meter) => meter.name));
  }

  private finishBulk(result: DbBulkResult): void {
    this.bulkResult.set(result);
    this.selected.set([]);
    this.facade.loadMeters({ search: this.searchQuery().trim() || undefined });
  }

  aggregatorLabel(aggregator: MeterAggregator): string {
    return getMeterAggregatorLabel(aggregator);
  }

  formatUnitPrice(price: number): string {
    return formatBillingMoney(price, undefined, { unitPrice: true });
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
