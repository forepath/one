import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  type BarcodeGeometry,
  code128Geometry,
  gtinBarcodeGeometry,
  isCode128Encodable,
  isValidGtin,
} from '@forepath/shared/shared/util-barcode';

/**
 * Renders an EAN / UPC (`kind="gtin"`) or Code 128 (`kind="code128"`, internal article numbers) barcode as inline
 * SVG bars (no innerHTML). Nothing is drawn for values the symbology cannot encode.
 */
@Component({
  selector: 'framework-inventory-barcode',
  host: { '[class.inventory-barcode--bordered]': 'bordered()' },
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (geometry(); as barcode) {
      <svg
        class="inventory-barcode"
        role="img"
        [attr.aria-label]="ariaLabel()"
        [attr.width]="barcode.modules * moduleWidth()"
        [attr.height]="height() + textHeight()"
        [attr.viewBox]="'0 0 ' + barcode.modules * moduleWidth() + ' ' + (height() + textHeight())"
        data-testid="inventory-barcode"
      >
        <rect [attr.width]="barcode.modules * moduleWidth()" [attr.height]="height() + textHeight()" fill="#ffffff" />
        <g fill="#000000">
          @for (bar of barcode.bars; track $index) {
            <rect
              [attr.x]="bar.x * moduleWidth()"
              y="0"
              [attr.width]="bar.width * moduleWidth()"
              [attr.height]="bar.guard && barcode.symbology !== 'code128' ? height() + 6 : height()"
            />
          }
        </g>
        <text
          [attr.x]="(barcode.modules * moduleWidth()) / 2"
          [attr.y]="height() + textHeight() - 3"
          text-anchor="middle"
          font-family="ui-monospace, Menlo, Consolas, monospace"
          font-size="12"
          fill="#000000"
        >
          {{ barcode.text }}
        </text>
      </svg>
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
        line-height: 0;
      }

      /* Framed like a printed label: white card with the theme border (stays white in dark mode for scanning). */
      :host(.inventory-barcode--bordered) {
        padding: 0.5rem 0.75rem;
        background: #ffffff;
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: var(--bs-border-radius);
      }

      .inventory-barcode {
        max-width: 100%;
        height: auto;
      }
    `,
  ],
})
export class InventoryBarcodeComponent {
  readonly value = input<string | null | undefined>(null);
  readonly kind = input<'gtin' | 'code128'>('code128');
  readonly moduleWidth = input(2);
  readonly height = input(56);
  readonly label = input<string | null>(null);
  /** Framed (white card with border); off inside other frames such as the property sticker preview. */
  readonly bordered = input(true);

  readonly textHeight = computed(() => 18);

  readonly geometry = computed((): BarcodeGeometry | null => {
    const value = this.value()?.trim();

    if (!value) return null;

    if (this.kind() === 'gtin') {
      return isValidGtin(value) ? gtinBarcodeGeometry(value) : null;
    }

    return isCode128Encodable(value) ? code128Geometry(value) : null;
  });

  readonly ariaLabel = computed(() => this.label() ?? `${this.kind() === 'gtin' ? 'EAN' : 'Code 128'} ${this.value()}`);
}
