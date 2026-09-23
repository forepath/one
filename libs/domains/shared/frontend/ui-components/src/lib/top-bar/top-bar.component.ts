import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Dark top bar (brand + trailing actions). Used by console shells and suitable for docs chrome.
 * Project actions into `[fpcTopBarActions]` (or the default slot). Optional `[fpcTopBarBrand]`
 * replaces the default logo mark.
 *
 * Use `compact` when there is no brand column (end-aligned, padded). Meta chips on the dark bar
 * should use class `fpc-top-bar__chip`. Icon / link actions that must stay light regardless of
 * app theme use `fpc-top-bar__action`.
 */
@Component({
  selector: 'fpc-top-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-top-bar',
    '[class.fpc-top-bar--compact]': 'compact()',
  },
  template: `
    <div class="fpc-top-bar__brand">
      <ng-content select="[fpcTopBarBrand]" />
      @if (showDefaultBrand()) {
        <div class="fpc-top-bar__brand-mark bg-primary">
          <img
            class="fpc-top-bar__brand-icon"
            [src]="brandSrc()"
            [alt]="brandAlt()"
            [attr.aria-label]="brandAlt() || null"
          />
        </div>
      }
    </div>

    <div class="fpc-top-bar__actions">
      <ng-content select="[fpcTopBarActions]" />
      <ng-content />
    </div>
  `,
  styleUrl: './top-bar.component.scss',
})
export class FpcTopBarComponent {
  /** Logo image URL for the default brand mark. */
  readonly brandSrc = input<string | null>(null);
  /** Accessible name for the brand mark. */
  readonly brandAlt = input('');
  /**
   * Compact strip for standalone / file-only mode: no brand column, actions end-aligned with
   * padding. When false, brand sits on the left and actions on the right.
   */
  readonly compact = input(false);

  protected readonly showDefaultBrand = computed(() => !this.compact() && !!this.brandSrc());
}
