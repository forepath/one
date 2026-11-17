import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminInventoryService,
  INVENTORY_PUTAWAY_REASONS,
  INVENTORY_WITHDRAWAL_REASONS,
  InventoryFacade,
  type InventoryCompartment,
  type InventoryMovementReason,
  type InventoryMovementType,
  type InventoryStock,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FPC_DEFAULT_PAGE_SIZE,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { catchError, of } from 'rxjs';

import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import { watchBillingMutationModalClose } from '../billing-modal';

import { InventoryCompartmentSelectComponent } from './inventory-compartment-select.component';
import {
  formatInventoryQuantity,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  INVENTORY_REASON_LABELS,
  inventoryUnitLabel,
} from './inventory-labels';
import { InventoryLocationChipComponent } from './inventory-location-chip.component';
import { InventoryReferenceSelectComponent } from './inventory-reference-select.component';
import { InventorySerialInputComponent, type InventorySerialSelection } from './inventory-serial-input.component';
import { loadInventorySerialsInStock } from './inventory-serial-units.util';

/** The article a move is booked for. */
export interface InventoryMoveArticle {
  id: string;
  articleNumber: string;
  name: string;
  unit: string;
  /** Units carry serial numbers: the move names them (quantity = their count). */
  serialTracking?: boolean;
}

/** Moves this dialog books (returns of lendings have their own dialog). */
export type InventoryMoveMode = Exclude<InventoryMovementType, 'lending_return'>;

/** A known location (preset source / target). */
export interface InventoryMoveLocation {
  compartmentId: string;
  compartmentCode: string;
  warehouseCode: string;
  quantity?: number;
}

/**
 * Putaway / transfer / withdrawal / lending of one article. Serial-tracked articles name their units (singles and
 * ranges); moves out of a compartment only accept units that are in stock there. Source and target come from presets (the clicked placement or
 * compartment), from the suggestion list (other compartments — in any warehouse — that hold the same article, paged,
 * most stock first) or from the compartment typeahead. Every booking creates a numbered document.
 */
@Component({
  selector: 'framework-inventory-move-dialog',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    BillingAdminUserSelectComponent,
    InventoryCompartmentSelectComponent,
    InventoryLocationChipComponent,
    InventoryReferenceSelectComponent,
    InventorySerialInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory-move-dialog.component.html',
})
export class InventoryMoveDialogComponent {
  readonly open = model(false);
  readonly mode = input<InventoryMoveMode>('putaway');
  readonly article = input<InventoryMoveArticle | null>(null);
  readonly presetSource = input<InventoryMoveLocation | null>(null);
  readonly presetTarget = input<InventoryMoveLocation | null>(null);

  private readonly facade = inject(InventoryFacade);
  private readonly service = inject(AdminInventoryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly mutating = signal(false);
  readonly error = signal<string | null>(null);

  readonly source = signal<InventoryMoveLocation | null>(null);
  readonly target = signal<InventoryMoveLocation | null>(null);
  readonly typeaheadTarget = signal<InventoryCompartment | null>(null);
  quantity: number | null = null;
  reason: InventoryMovementReason | '' = '';
  reference = '';
  note = '';

  // Serial numbers (serial-tracked articles).
  readonly serialText = signal('');
  readonly serialSelection = signal<InventorySerialSelection>({ serialNumbers: [], tokens: [], valid: true });
  /** Units in stock at the source (null: any serial number may be entered, i.e. putaway). */
  readonly availableSerials = signal<string[] | null>(null);
  readonly serialTracking = computed(() => this.article()?.serialTracking === true);

  // Lending: borrower account or named employee, optional due date.
  readonly borrowerMode = signal<'account' | 'name'>('account');
  readonly borrowerUserId = signal('');
  borrowerName = '';
  dueDate = '';
  readonly today = new Date().toISOString().slice(0, 10);

  // Suggestions: placements of the article (paged, replace-page).
  readonly suggestionRows = signal<InventoryStock[]>([]);
  readonly suggestionTotal = signal(0);
  readonly suggestionPage = signal(1);
  readonly suggestionPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly suggestionLoading = signal(false);

  readonly needsSource = computed(() => this.mode() !== 'putaway');
  readonly needsTarget = computed(() => this.mode() === 'putaway' || this.mode() === 'transfer');
  readonly lending = computed(() => this.mode() === 'lending');
  /** Pick the source first; the target list follows once a source is set. */
  readonly pickingSource = computed(() => this.needsSource() && !this.source());
  readonly title = computed(() => INVENTORY_MOVEMENT_TYPE_LABELS[this.mode()]);
  readonly reasons = computed(() =>
    this.mode() === 'putaway'
      ? INVENTORY_PUTAWAY_REASONS
      : this.mode() === 'withdrawal'
        ? INVENTORY_WITHDRAWAL_REASONS
        : [],
  );
  readonly maxQuantity = computed(() => (this.needsSource() ? (this.source()?.quantity ?? null) : null));
  readonly unitLabel = computed(() => inventoryUnitLabel(this.article()?.unit));
  readonly reasonLabels = INVENTORY_REASON_LABELS;
  readonly serialHint = computed(() =>
    this.availableSerials() === null
      ? $localize`:@@featureInventoryMove-serialsHintPutaway:One serial number per unit. Ranges count up the last number.`
      : $localize`:@@featureInventoryMove-serialsHintMove:Only units in stock at the source can be moved.`,
  );

  readonly suggestionColumns: FpcTableColumn<InventoryStock>[] = [
    {
      id: 'location',
      label: $localize`:@@featureInventoryMove-colLocation:Compartment`,
      value: (row) => `${row.warehouse.code} / ${row.compartment.code}`,
      required: true,
      mono: true,
    },
    {
      id: 'warehouse',
      label: $localize`:@@featureInventoryMove-colWarehouse:Warehouse`,
      value: (row) => row.warehouse.name,
      priority: 2,
    },
    {
      id: 'quantity',
      label: $localize`:@@featureInventoryMove-colQuantity:On hand`,
      value: (row) => formatInventoryQuantity(row.quantity, row.article.unit),
      align: 'end',
    },
  ];
  readonly suggestionsLabel = computed(() =>
    this.pickingSource()
      ? $localize`:@@featureInventoryMove-sourceSuggestions:Compartments holding this article`
      : $localize`:@@featureInventoryMove-targetSuggestions:Other compartments with this article`,
  );
  /** Target suggestions never offer the source compartment itself. */
  readonly visibleSuggestions = computed(() => {
    const sourceId = this.pickingSource() ? null : this.source()?.compartmentId;

    return sourceId ? this.suggestionRows().filter((row) => row.compartment.id !== sourceId) : this.suggestionRows();
  });
  readonly visibleSuggestionTotal = computed(
    () => this.suggestionTotal() - (this.suggestionRows().length - this.visibleSuggestions().length),
  );
  readonly selectedSuggestionId = computed(() => {
    const id = this.pickingSource() ? null : this.target()?.compartmentId;

    return this.suggestionRows().find((row) => row.compartment.id === id)?.id ?? null;
  });

  constructor() {
    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.open,
      destroyRef: this.destroyRef,
    });
    this.facade.mutating$.pipe(takeUntilDestroyed()).subscribe((mutating) => this.mutating.set(mutating));
    this.facade.mutationError$.pipe(takeUntilDestroyed()).subscribe((error) => this.error.set(error));

    // Opening resets the form to the presets.
    effect(() => {
      if (!this.open()) return;

      untracked(() => {
        this.facade.clearError();
        this.source.set(this.presetSource());
        this.target.set(this.presetTarget());
        this.typeaheadTarget.set(null);
        this.quantity = null;
        this.reason = this.mode() === 'putaway' ? 'receipt' : this.mode() === 'withdrawal' ? 'other' : '';
        this.reference = '';
        this.note = '';
        this.serialText.set('');
        this.availableSerials.set(null);
        this.borrowerMode.set('account');
        this.borrowerUserId.set('');
        this.borrowerName = '';
        this.dueDate = '';
        this.suggestionPage.set(1);
      });
    });

    // Units in stock at the chosen source (serial-tracked moves out of a compartment).
    effect(() => {
      const article = this.article();
      const source = this.source();
      const open = this.open();

      untracked(() => {
        if (!open || !article?.serialTracking || !this.needsSource() || !source) {
          this.availableSerials.set(null);

          return;
        }

        this.loadAvailableSerials(article.id, source.compartmentId);
      });
    });

    effect(() => {
      const article = this.article();
      const open = this.open();
      const page = this.suggestionPage();
      const pageSize = this.suggestionPageSize();
      const sourceStep = this.pickingSource();

      if (!open || !article) return;

      untracked(() => this.loadSuggestions(article.id, page, pageSize, sourceStep));
    });
  }

  private loadSuggestions(articleId: string, page: number, pageSize: number, sourceStep: boolean): void {
    this.suggestionLoading.set(true);
    this.service
      .listArticleStock(articleId, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        // Sources must hold stock; targets may be any mapped location (also quantity 0).
        withStockOnly: sourceStep || this.mode() === 'withdrawal' || undefined,
      })
      .pipe(
        catchError(() => of({ items: [] as InventoryStock[], total: 0 })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.suggestionRows.set(response.items);
        this.suggestionTotal.set(response.total);
        this.suggestionLoading.set(false);
      });
  }

  private loadAvailableSerials(articleId: string, compartmentId: string): void {
    this.availableSerials.set([]);
    loadInventorySerialsInStock(this.service, articleId, compartmentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((serials) => this.availableSerials.set(serials));
  }

  /** Serial-tracked moves count their units. */
  effectiveQuantity(): number {
    return this.serialTracking() ? this.serialSelection().serialNumbers.length : Number(this.quantity);
  }

  locationOf(row: InventoryStock): InventoryMoveLocation {
    return {
      compartmentId: row.compartment.id,
      compartmentCode: row.compartment.code,
      warehouseCode: row.warehouse.code,
      quantity: row.quantity,
    };
  }

  onSuggestion(row: InventoryStock): void {
    if (this.pickingSource()) {
      this.source.set(this.locationOf(row));
      this.suggestionPage.set(1);

      return;
    }

    if (row.compartment.id === this.source()?.compartmentId) return;

    this.typeaheadTarget.set(null);
    this.target.set(this.locationOf(row));
  }

  onTypeaheadTarget(compartment: InventoryCompartment | null): void {
    this.target.set(
      compartment
        ? { compartmentId: compartment.id, compartmentCode: compartment.code, warehouseCode: compartment.warehouseCode }
        : null,
    );
  }

  changeSource(): void {
    this.source.set(null);
    this.suggestionPage.set(1);
  }

  formatQuantity(value: number | undefined): string {
    return formatInventoryQuantity(value ?? 0, this.article()?.unit);
  }

  canSubmit(): boolean {
    const quantity = this.effectiveQuantity();
    const max = this.maxQuantity();
    const serialsOk = !this.serialTracking() || (this.serialSelection().valid && quantity > 0);
    const borrowerOk =
      !this.lending() ||
      (this.borrowerMode() === 'account' ? Boolean(this.borrowerUserId()) : this.borrowerName.trim().length > 0);

    return (
      Boolean(this.article()) &&
      serialsOk &&
      borrowerOk &&
      (!this.lending() || !this.dueDate || this.dueDate >= this.today) &&
      Number.isFinite(quantity) &&
      quantity > 0 &&
      (max === null || quantity <= max) &&
      (!this.needsSource() || Boolean(this.source())) &&
      (!this.needsTarget() || Boolean(this.target())) &&
      !(this.source() && this.target() && this.source()!.compartmentId === this.target()!.compartmentId)
    );
  }

  submit(): void {
    const article = this.article();

    if (!article || !this.canSubmit()) return;

    const quantity = this.effectiveQuantity();
    const common = {
      articleId: article.id,
      quantity,
      ...(this.serialTracking() ? { serialNumbers: this.serialSelection().tokens } : {}),
      reference: this.reference || null,
      note: this.note || null,
    };

    switch (this.mode()) {
      case 'putaway':
        this.facade.mutate({
          kind: 'putaway',
          dto: {
            ...common,
            targetCompartmentId: this.target()!.compartmentId,
            reason: (this.reason || 'receipt') as InventoryMovementReason,
          },
        });
        break;
      case 'transfer':
        this.facade.mutate({
          kind: 'transfer',
          dto: {
            ...common,
            sourceCompartmentId: this.source()!.compartmentId,
            targetCompartmentId: this.target()!.compartmentId,
          },
        });
        break;
      case 'lending':
        this.facade.mutate({
          kind: 'lend',
          dto: {
            ...common,
            sourceCompartmentId: this.source()!.compartmentId,
            ...(this.borrowerMode() === 'account'
              ? { borrowerUserId: this.borrowerUserId() }
              : { borrowerName: this.borrowerName.trim() }),
            dueDate: this.dueDate || null,
          },
        });
        break;
      default:
        this.facade.mutate({
          kind: 'withdraw',
          dto: {
            ...common,
            sourceCompartmentId: this.source()!.compartmentId,
            reason: (this.reason || 'other') as InventoryMovementReason,
          },
        });
    }
  }
}
