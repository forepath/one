import { HttpErrorResponse } from '@angular/common/http';
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
  type InventoryLabelKind,
  type InventoryLabelLayout,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';
import { catchError, from, of, switchMap } from 'rxjs';

import { INVENTORY_LABEL_KIND_LABELS, saveInventoryBlob } from './inventory-labels';

const KINDS: InventoryLabelKind[] = ['article_number', 'ean', 'property'];

/**
 * Prints labels of the selected articles or serial-tracked units as one PDF: article number, EAN and
 * property stickers (company data from the billing issuer). Synchronous export, at most 1000 labels.
 */
@Component({
  selector: 'framework-inventory-label-print-dialog',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fpc-modal [(open)]="open" [title]="title" data-testid="inventory-label-dialog">
      <p class="small text-body-secondary mb-3">{{ selectionLabel() }}</p>
      @if (error(); as message) {
        <fpc-alert variant="danger" [message]="message" data-testid="inventory-label-error" />
      }
      <fpc-form-field i18n-label="@@featureInventoryLabels-kinds" label="Labels" required>
        @for (kind of kinds; track kind) {
          <div class="form-check">
            <input
              class="form-check-input"
              type="checkbox"
              [id]="'inventoryLabelKind-' + kind"
              [checked]="selectedKinds().includes(kind)"
              (change)="toggle(kind)"
              [attr.data-testid]="'inventory-label-kind-' + kind"
            />
            <label class="form-check-label" [for]="'inventoryLabelKind-' + kind">{{ kindLabels[kind] }}</label>
          </div>
        }
      </fpc-form-field>
      <p class="small text-body-secondary" i18n="@@featureInventoryLabels-kindsHint">
        Property stickers name the company from the billing settings. Serial-tracked articles get one sticker per unit
        in stock or on loan; articles without an EAN get no EAN label.
      </p>
      <div class="row g-3">
        <div class="col-sm-8">
          <fpc-form-field forId="inventoryLabelLayout" i18n-label="@@featureInventoryLabels-layout" label="Layout">
            <fpc-form-control
              controlType="select"
              controlId="inventoryLabelLayout"
              [(ngModel)]="layout"
              name="inventoryLabelLayout"
              data-testid="inventory-label-layout"
            >
              <option value="sheet" i18n="@@featureInventoryLabels-layoutSheet">A4 sheet, 24 labels to cut out</option>
              <option value="single" i18n="@@featureInventoryLabels-layoutSingle">
                One label per page (label printer, 70 × 37 mm)
              </option>
            </fpc-form-control>
          </fpc-form-field>
        </div>
        <div class="col-sm-4">
          <fpc-form-field forId="inventoryLabelCopies" i18n-label="@@featureInventoryLabels-copies" label="Copies">
            <fpc-form-control
              controlId="inventoryLabelCopies"
              inputType="number"
              [min]="1"
              [max]="20"
              step="1"
              [(ngModel)]="copies"
              name="inventoryLabelCopies"
              data-testid="inventory-label-copies"
            />
          </fpc-form-field>
        </div>
      </div>
      <div *fpcModalFooter class="d-flex justify-content-end gap-2">
        <fpc-button
          variant="primary"
          [disabled]="printing() || !canPrint()"
          [loading]="printing()"
          (clicked)="print()"
          data-testid="inventory-label-print"
        >
          <i class="bi bi-printer me-1" aria-hidden="true"></i
          ><ng-container i18n="@@featureInventoryLabels-print">Create PDF</ng-container>
        </fpc-button>
      </div>
    </fpc-modal>
  `,
})
export class InventoryLabelPrintDialogComponent {
  readonly open = model(false);
  readonly articleIds = input<readonly string[]>([]);
  readonly serialUnitIds = input<readonly string[]>([]);
  /** Preselected kinds when the dialog opens. */
  readonly defaultKinds = input<readonly InventoryLabelKind[]>(['article_number']);

  private readonly service = inject(AdminInventoryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly title = $localize`:@@featureInventoryLabels-title:Print labels`;
  readonly kinds = KINDS;
  readonly kindLabels = INVENTORY_LABEL_KIND_LABELS;
  readonly selectedKinds = signal<InventoryLabelKind[]>([]);
  readonly printing = signal(false);
  readonly error = signal<string | null>(null);
  layout: InventoryLabelLayout = 'sheet';
  copies = 1;

  readonly selectionLabel = computed(() => {
    const articles = this.articleIds().length;
    const units = this.serialUnitIds().length;

    return units > 0
      ? $localize`:@@featureInventoryLabels-units:${units}:count: serial numbers selected`
      : $localize`:@@featureInventoryLabels-articles:${articles}:count: articles selected`;
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;

      untracked(() => {
        this.selectedKinds.set([...this.defaultKinds()]);
        this.error.set(null);
        this.copies = 1;
      });
    });
  }

  toggle(kind: InventoryLabelKind): void {
    this.selectedKinds.update((kinds) =>
      kinds.includes(kind)
        ? kinds.filter((entry) => entry !== kind)
        : KINDS.filter((entry) => [...kinds, kind].includes(entry)),
    );
  }

  canPrint(): boolean {
    const copies = Number(this.copies);

    return (
      this.selectedKinds().length > 0 &&
      this.articleIds().length + this.serialUnitIds().length > 0 &&
      Number.isInteger(copies) &&
      copies >= 1 &&
      copies <= 20
    );
  }

  print(): void {
    if (!this.canPrint()) return;

    this.printing.set(true);
    this.error.set(null);
    this.service
      .printLabels({
        kinds: this.selectedKinds(),
        ...(this.articleIds().length > 0 ? { articleIds: [...this.articleIds()] } : {}),
        ...(this.serialUnitIds().length > 0 ? { serialUnitIds: [...this.serialUnitIds()] } : {}),
        copies: Number(this.copies),
        layout: this.layout,
      })
      .pipe(
        catchError((error: unknown) =>
          // Error bodies of blob requests arrive as blobs: read the API message.
          from(labelErrorMessage(error)).pipe(
            switchMap((message) => {
              this.error.set(message);

              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((blob) => {
        this.printing.set(false);

        if (blob) {
          saveInventoryBlob(blob, `labels-${new Date().toISOString().slice(0, 10)}.pdf`);
          this.open.set(false);
        }
      });
  }
}

async function labelErrorMessage(error: unknown): Promise<string> {
  if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
    try {
      const body = JSON.parse(await error.error.text()) as { message?: string | string[] };

      if (Array.isArray(body.message)) return body.message.join(', ');

      if (body.message) return body.message;
    } catch {
      // Not JSON: fall through.
    }
  }

  return $localize`:@@featureInventoryLabels-failed:The labels could not be created.`;
}
