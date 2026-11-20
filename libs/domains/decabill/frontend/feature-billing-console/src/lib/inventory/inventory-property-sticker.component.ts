import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AdminInventoryService,
  type InventoryLabelOwner,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { catchError, of, shareReplay } from 'rxjs';

import { InventoryBarcodeComponent } from './inventory-barcode.component';

/** Owner data is the same for every sticker: one request per page load. */
let owner$: ReturnType<AdminInventoryService['getLabelOwner']> | null = null;

/**
 * Preview of the printed property sticker (70 x 37 mm): "Property of" the billing issuer, the barcode of the unit's
 * serial number (or the article number) and the contact line. Mirrors `inventory-labels.template.html`.
 */
@Component({
  selector: 'framework-inventory-property-sticker',
  standalone: true,
  imports: [InventoryBarcodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="inventory-sticker" data-testid="inventory-property-sticker">
      <span class="inventory-sticker__kicker" i18n="@@featureInventorySticker-propertyOf">Property of</span>
      @if (owner(); as current) {
        <span class="inventory-sticker__owner">{{ current.name || notConfigured }}</span>
        @if (current.address) {
          <span class="inventory-sticker__meta">{{ current.address }}</span>
        }
      } @else {
        <span class="inventory-sticker__owner">…</span>
      }
      <framework-inventory-barcode
        class="inventory-sticker__barcode"
        [value]="serialNumber() || articleNumber()"
        kind="code128"
        [bordered]="false"
        [height]="40"
      />
      <span class="inventory-sticker__meta">{{
        serialNumber() ? articleName() + ', ' + articleNumber() : articleName()
      }}</span>
      @if (owner()?.contact; as contact) {
        <span class="inventory-sticker__meta" i18n="@@featureInventorySticker-contact"
          >If found, please contact {{ contact }}</span
        >
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-block;
      max-width: 100%;
    }

    /* Printed stickers are 70 x 37 mm; the preview keeps the proportions at a readable size. */
    .inventory-sticker {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      width: 17.5rem;
      max-width: 100%;
      min-height: 9.25rem;
      padding: 0.6rem 0.85rem;
      color: #111111;
      background: #ffffff;
      border: var(--bs-border-width) solid var(--bs-border-color);
      border-radius: var(--bs-border-radius);
      line-height: 1.25;
    }

    .inventory-sticker__kicker {
      font-size: 0.6rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #444444;
    }

    .inventory-sticker__owner {
      font-size: 0.85rem;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inventory-sticker__meta {
      font-size: 0.65rem;
      color: #444444;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inventory-sticker__barcode {
      align-self: center;
      margin: 0.2rem 0;
    }
  `,
})
export class InventoryPropertyStickerComponent {
  readonly articleName = input.required<string>();
  readonly articleNumber = input.required<string>();
  /** Serial-tracked units print their serial number instead of the article number. */
  readonly serialNumber = input<string | null>(null);

  private readonly service = inject(AdminInventoryService);

  readonly notConfigured = $localize`:@@featureInventorySticker-noOwner:Company name not configured`;
  readonly owner = toSignal(
    (owner$ ??= this.service.getLabelOwner().pipe(
      catchError(() => of({ name: null, address: null, contact: null } satisfies InventoryLabelOwner)),
      shareReplay({ bufferSize: 1, refCount: false }),
    )),
    { initialValue: null },
  );
}
