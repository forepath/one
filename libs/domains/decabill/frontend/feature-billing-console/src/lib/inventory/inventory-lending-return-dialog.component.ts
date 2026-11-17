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
  InventoryFacade,
  type InventoryCompartment,
  type InventoryLending,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';

import { watchBillingMutationModalClose } from '../billing-modal';

import { InventoryCompartmentSelectComponent } from './inventory-compartment-select.component';
import { formatInventoryQuantity, inventoryUnitLabel } from './inventory-labels';
import { InventoryLocationChipComponent } from './inventory-location-chip.component';
import { InventoryReferenceSelectComponent } from './inventory-reference-select.component';
import { InventorySerialInputComponent, type InventorySerialSelection } from './inventory-serial-input.component';

/**
 * Returns all or part of a lending into a compartment (document `RTN-…`). The lending's own compartment is the
 * default target; serial-tracked lendings name the units coming back (only units of this lending are accepted).
 */
@Component({
  selector: 'framework-inventory-lending-return-dialog',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    InventoryCompartmentSelectComponent,
    InventoryLocationChipComponent,
    InventoryReferenceSelectComponent,
    InventorySerialInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fpc-modal [(open)]="open" [title]="title" data-testid="inventory-return-dialog">
      @if (lending(); as current) {
        <p class="mb-3">
          <span class="fw-semibold">{{ current.article.name }}</span>
          <span class="ms-2 small text-body-secondary font-monospace">{{ current.article.articleNumber }}</span>
        </p>
        <p class="small text-body-secondary mb-3">
          <span class="font-monospace">{{ current.documentNumber }}</span>
          <span class="ms-2">{{ current.borrower.name }}</span>
          <span class="ms-2">{{ outstandingLabel() }}</span>
        </p>
        @if (error(); as message) {
          <fpc-alert variant="danger" [message]="message" data-testid="inventory-return-error" />
        }
        <fpc-form-field forId="inventoryReturnTarget" i18n-label="@@featureInventoryMove-target" label="To" required>
          @if (target(); as to) {
            <div class="d-flex align-items-center gap-2" data-testid="inventory-return-target">
              <framework-inventory-location-chip
                [warehouseCode]="to.warehouseCode"
                [compartmentCode]="to.code"
                [clearable]="true"
                (cleared)="target.set(null)"
              />
            </div>
          } @else {
            <framework-inventory-compartment-select
              inputId="inventoryReturnTarget"
              [selected]="null"
              (picked)="target.set($event ? toTarget($event) : null)"
            />
          }
        </fpc-form-field>
        @if (current.article.serialTracking) {
          <fpc-form-field
            forId="inventoryReturnSerials"
            i18n-label="@@featureInventoryMove-serials"
            label="Serial numbers"
            required
          >
            <framework-inventory-serial-input
              inputId="inventoryReturnSerials"
              testId="inventory-return-serials"
              [available]="current.outstandingSerialNumbers"
              i18n-availablePlaceholder="@@featureInventoryReturn-pickPlaceholder"
              availablePlaceholder="Search units on loan, or pick all"
              [(value)]="serialText"
              (selectionChange)="serialSelection.set($event)"
            />
          </fpc-form-field>
        } @else {
          <fpc-form-field
            forId="inventoryReturnQuantity"
            i18n-label="@@featureInventoryMove-quantity"
            label="Quantity"
            required
          >
            <fpc-input-group>
              <fpc-form-control
                controlId="inventoryReturnQuantity"
                inputType="number"
                [min]="0.001"
                [max]="current.outstandingQuantity"
                step="any"
                [(ngModel)]="quantity"
                name="inventoryReturnQuantity"
                data-testid="inventory-return-quantity"
              />
              <span class="input-group-text" fpcInputGroupSuffix>{{ unitLabel() }}</span>
            </fpc-input-group>
          </fpc-form-field>
        }
        <fpc-form-field
          forId="inventoryReturnReference"
          i18n-label="@@featureInventoryMove-reference"
          label="Reference"
          i18n-hint="@@featureInventoryMove-referenceSelectHint"
          hint="Search invoices, offers, supplier invoices, subscriptions, projects or customers, or use Other for free text."
        >
          <framework-inventory-reference-select
            inputId="inventoryReturnReference"
            [(value)]="reference"
            data-testid="inventory-return-reference"
          />
        </fpc-form-field>
        <fpc-form-field forId="inventoryReturnNote" i18n-label="@@featureInventoryMove-note" label="Note">
          <fpc-form-control
            controlType="textarea"
            controlId="inventoryReturnNote"
            [(ngModel)]="note"
            name="inventoryReturnNote"
            [maxLength]="2000"
          />
        </fpc-form-field>
      }
      <div *fpcModalFooter class="d-flex justify-content-end gap-2">
        <fpc-button
          variant="primary"
          [disabled]="mutating() || !canSubmit()"
          [loading]="mutating()"
          (clicked)="submit()"
          data-testid="inventory-return-submit"
          i18n="@@featureInventoryMove-submit"
          >Book and create document</fpc-button
        >
      </div>
    </fpc-modal>
  `,
})
export class InventoryLendingReturnDialogComponent {
  readonly open = model(false);
  readonly lending = input<InventoryLending | null>(null);

  private readonly facade = inject(InventoryFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly title = $localize`:@@featureInventoryReturn-title:Return lending`;
  readonly mutating = signal(false);
  readonly error = signal<string | null>(null);
  readonly target = signal<{ id: string; code: string; warehouseCode: string } | null>(null);
  readonly serialText = signal('');
  readonly serialSelection = signal<InventorySerialSelection>({ serialNumbers: [], tokens: [], valid: true });
  quantity: number | null = null;
  reference = '';
  note = '';

  readonly unitLabel = computed(() => inventoryUnitLabel(this.lending()?.article.unit));
  readonly outstandingLabel = computed(() => {
    const lending = this.lending();

    return lending
      ? $localize`:@@featureInventoryReturn-outstanding:${formatInventoryQuantity(lending.outstandingQuantity, lending.article.unit)}:quantity: on loan`
      : '';
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

    effect(() => {
      if (!this.open()) return;

      untracked(() => {
        const lending = this.lending();

        this.facade.clearError();
        this.target.set(
          lending?.source
            ? {
                id: lending.source.compartmentId,
                code: lending.source.compartmentCode,
                warehouseCode: lending.source.warehouseCode,
              }
            : null,
        );
        this.serialText.set('');
        this.quantity = lending && !lending.article.serialTracking ? lending.outstandingQuantity : null;
        this.reference = '';
        this.note = '';
      });
    });
  }

  toTarget(compartment: InventoryCompartment): { id: string; code: string; warehouseCode: string } {
    return { id: compartment.id, code: compartment.code, warehouseCode: compartment.warehouseCode };
  }

  private quantityToReturn(): number {
    const lending = this.lending();

    return lending?.article.serialTracking ? this.serialSelection().serialNumbers.length : Number(this.quantity);
  }

  canSubmit(): boolean {
    const lending = this.lending();
    const quantity = this.quantityToReturn();

    return (
      Boolean(lending && this.target()) &&
      Number.isFinite(quantity) &&
      quantity > 0 &&
      quantity <= (lending?.outstandingQuantity ?? 0) &&
      (!lending?.article.serialTracking || this.serialSelection().valid)
    );
  }

  submit(): void {
    const lending = this.lending();

    if (!lending || !this.canSubmit()) return;

    this.facade.mutate({
      kind: 'returnLending',
      id: lending.id,
      dto: {
        targetCompartmentId: this.target()!.id,
        quantity: this.quantityToReturn(),
        ...(lending.article.serialTracking ? { serialNumbers: this.serialSelection().tokens } : {}),
        reference: this.reference || null,
        note: this.note || null,
      },
    });
  }
}
