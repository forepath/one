import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
  INVENTORY_ARTICLE_UNITS,
  InventoryFacade,
  type InventoryArticle,
  type InventoryArticleInput,
  type InventoryCompartment,
  type InventoryTaxCategory,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';
import { isValidGtin, normalizeGtin } from '@forepath/shared/shared/util-barcode';

import { BillingAdminSupplierSelectComponent } from '../billing-admin-supplier-select/billing-admin-supplier-select.component';
import { watchBillingMutationModalClose } from '../billing-modal';

import { InventoryBarcodeComponent } from './inventory-barcode.component';
import { InventoryCompartmentSelectComponent } from './inventory-compartment-select.component';
import { inventoryUnitLabel } from './inventory-labels';
import { InventorySerialInputComponent, type InventorySerialSelection } from './inventory-serial-input.component';

interface ArticleForm {
  name: string;
  description: string;
  ean: string;
  unit: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  supplierId: string;
  supplierArticleNumber: string;
  purchasePriceNet: number | null;
  salesPriceNet: number | null;
  currency: string;
  taxCategory: InventoryTaxCategory;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  hsCode: string;
  countryOfOrigin: string;
  isActive: boolean;
  serialTracking: boolean;
}

interface PlacementRow {
  compartment: InventoryCompartment | null;
  quantity: number | null;
  /** Serial-tracked articles: the units put away (quantity = their count). */
  serialText: string;
  serials: InventorySerialSelection;
}

const NO_SERIALS: InventorySerialSelection = { serialNumbers: [], tokens: [], valid: true };

/**
 * Create / edit an article. Creating can map the article to locations right away: quantity 0 maps the location,
 * a quantity puts new goods away (putaway document). Existing articles manage their locations on the detail page.
 */
@Component({
  selector: 'framework-inventory-article-form',
  standalone: true,
  imports: [
    FormsModule,
    BillingAdminSupplierSelectComponent,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    InventoryBarcodeComponent,
    InventoryCompartmentSelectComponent,
    InventorySerialInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory-article-form.component.html',
})
export class InventoryArticleFormComponent {
  readonly open = model(false);
  /** Null creates a new article. */
  readonly article = input<InventoryArticle | null>(null);

  private readonly facade = inject(InventoryFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly units = INVENTORY_ARTICLE_UNITS;
  readonly unitLabel = inventoryUnitLabel;
  readonly mutating = signal(false);
  readonly error = signal<string | null>(null);
  readonly placements = signal<PlacementRow[]>([]);

  form: ArticleForm = this.empty();

  readonly createTitle = $localize`:@@featureInventoryArticleForm-createTitle:New article`;
  readonly editTitle = $localize`:@@featureInventoryArticleForm-editTitle:Edit article`;
  readonly eanError = $localize`:@@featureInventoryArticleForm-eanInvalid:Not a valid EAN / GTIN (check digit).`;

  /** Serial tracking only switches while the article has no stock and nothing is on loan. */
  serialTrackingLocked(): boolean {
    const article = this.article();

    return Boolean(article && (article.totalQuantity > 0 || article.lentQuantity > 0));
  }

  constructor() {
    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.open,
      destroyRef: this.destroyRef,
    });
    this.facade.mutating$.pipe(takeUntilDestroyed()).subscribe((value) => this.mutating.set(value));
    this.facade.mutationError$.pipe(takeUntilDestroyed()).subscribe((value) => this.error.set(value));

    effect(() => {
      if (!this.open()) return;

      const article = this.article();

      untracked(() => {
        this.facade.clearError();
        this.form = article ? this.fromArticle(article) : this.empty();
        this.placements.set([]);
      });
    });
  }

  eanValid(): boolean {
    const ean = normalizeGtin(this.form.ean);

    return !ean || isValidGtin(ean);
  }

  normalizedEan(): string {
    return normalizeGtin(this.form.ean);
  }

  addPlacement(): void {
    this.placements.update((rows) => [
      ...rows,
      { compartment: null, quantity: null, serialText: '', serials: NO_SERIALS },
    ]);
  }

  removePlacement(index: number): void {
    this.placements.update((rows) => rows.filter((_, i) => i !== index));
  }

  setPlacementCompartment(index: number, compartment: InventoryCompartment | null): void {
    this.placements.update((rows) => rows.map((row, i) => (i === index ? { ...row, compartment } : row)));
  }

  setPlacementQuantity(index: number, quantity: number | null): void {
    this.placements.update((rows) => rows.map((row, i) => (i === index ? { ...row, quantity } : row)));
  }

  setPlacementSerialText(index: number, serialText: string): void {
    this.placements.update((rows) => rows.map((row, i) => (i === index ? { ...row, serialText } : row)));
  }

  setPlacementSerials(index: number, serials: InventorySerialSelection): void {
    this.placements.update((rows) => rows.map((row, i) => (i === index ? { ...row, serials } : row)));
  }

  /** Serial numbers entered in more than one placement row. */
  duplicateSerials(): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const row of this.placements()) {
      for (const serial of row.serials.serialNumbers) {
        if (seen.has(serial)) duplicates.add(serial);

        seen.add(serial);
      }
    }

    return [...duplicates];
  }

  canSubmit(): boolean {
    const compartmentIds = this.placements().map((row) => row.compartment?.id);

    return (
      Boolean(this.form.name.trim()) &&
      this.eanValid() &&
      compartmentIds.every(Boolean) &&
      new Set(compartmentIds).size === compartmentIds.length &&
      this.placements().every((row) => row.quantity === null || Number(row.quantity) >= 0) &&
      (!this.form.serialTracking ||
        (this.placements().every((row) => row.serials.valid) && this.duplicateSerials().length === 0))
    );
  }

  submit(): void {
    if (!this.canSubmit()) return;

    const nullable = (value: string) => (value.trim() ? value.trim() : null);
    const number = (value: number | null) => (value === null || (value as unknown) === '' ? null : Number(value));
    const dto: InventoryArticleInput = {
      name: this.form.name.trim(),
      description: nullable(this.form.description),
      ean: nullable(this.normalizedEan()),
      unit: this.form.unit,
      manufacturer: nullable(this.form.manufacturer),
      manufacturerPartNumber: nullable(this.form.manufacturerPartNumber),
      supplierId: this.form.supplierId || null,
      supplierArticleNumber: nullable(this.form.supplierArticleNumber),
      purchasePriceNet: number(this.form.purchasePriceNet),
      salesPriceNet: number(this.form.salesPriceNet),
      currency: this.form.currency.trim().toUpperCase() || 'EUR',
      taxCategory: this.form.taxCategory,
      reorderPoint: number(this.form.reorderPoint),
      reorderQuantity: number(this.form.reorderQuantity),
      weightKg: number(this.form.weightKg),
      lengthCm: number(this.form.lengthCm),
      widthCm: number(this.form.widthCm),
      heightCm: number(this.form.heightCm),
      hsCode: nullable(this.form.hsCode),
      countryOfOrigin: nullable(this.form.countryOfOrigin.toUpperCase()),
      isActive: this.form.isActive,
      serialTracking: this.form.serialTracking,
    };
    const article = this.article();

    if (article) {
      this.facade.mutate({ kind: 'saveArticle', id: article.id, dto });
    } else {
      dto.placements = this.placements().map((row) =>
        this.form.serialTracking
          ? {
              compartmentId: row.compartment!.id,
              quantity: row.serials.serialNumbers.length,
              ...(row.serials.tokens.length > 0 ? { serialNumbers: row.serials.tokens } : {}),
            }
          : { compartmentId: row.compartment!.id, quantity: Number(row.quantity ?? 0) },
      );
      this.facade.mutate({ kind: 'saveArticle', dto });
    }
  }

  private empty(): ArticleForm {
    return {
      name: '',
      description: '',
      ean: '',
      unit: 'piece',
      manufacturer: '',
      manufacturerPartNumber: '',
      supplierId: '',
      supplierArticleNumber: '',
      purchasePriceNet: null,
      salesPriceNet: null,
      currency: 'EUR',
      taxCategory: 'standard',
      reorderPoint: null,
      reorderQuantity: null,
      weightKg: null,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      hsCode: '',
      countryOfOrigin: '',
      isActive: true,
      serialTracking: false,
    };
  }

  private fromArticle(article: InventoryArticle): ArticleForm {
    return {
      name: article.name,
      description: article.description ?? '',
      ean: article.ean ?? '',
      unit: article.unit,
      manufacturer: article.manufacturer ?? '',
      manufacturerPartNumber: article.manufacturerPartNumber ?? '',
      supplierId: article.supplierId ?? '',
      supplierArticleNumber: article.supplierArticleNumber ?? '',
      purchasePriceNet: article.purchasePriceNet,
      salesPriceNet: article.salesPriceNet,
      currency: article.currency,
      taxCategory: article.taxCategory,
      reorderPoint: article.reorderPoint,
      reorderQuantity: article.reorderQuantity,
      weightKg: article.weightKg,
      lengthCm: article.lengthCm,
      widthCm: article.widthCm,
      heightCm: article.heightCm,
      hsCode: article.hsCode ?? '',
      countryOfOrigin: article.countryOfOrigin ?? '',
      isActive: article.isActive,
      serialTracking: article.serialTracking,
    };
  }
}
