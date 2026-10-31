import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Dark top bar (brand + trailing actions). Used by console shells and suitable for docs chrome.
 * Project actions into `[fpcTopBarActions]` (or the default slot). Optional `[fpcTopBarBrand]`
 * replaces the default logo mark.
 *
 * Use `compact` when there is no brand column (end-aligned, padded): tool windows / file-only mode.
 * Phones keep the one full bar (actions tighten below md); console navigation on phones is the same
 * `fpc-sidebar` rail + footer `fpc-sidebar-popover` as on desktop (no bottom bar, no second row).
 *
 * Item contract (order from the right edge inward: Logout, theme, language, density, security,
 * running tasks, draft / state chips, primary Create, search trigger):
 * - actions: `fpc-button variant="link" size="sm" class="fpc-top-bar__action"` (light chrome in both
 *   themes; `active` for the current route; `fpc-top-bar__action--attention` = warning-tone state chip;
 *   a count is an `fpc-badge pill` inside the button). Never raw `.btn` / `btn-link`.
 * - primary actions (Create `+`): `fpc-button variant="primary" size="sm" iconOnly`.
 * - Logout: `fpc-button variant="primary" size="sm" mdSize="md" [title]="…"` (rightmost) with
 *   `<i class="bi bi-box-arrow-right fpc-top-bar__phone-icon" aria-hidden="true"></i>` +
 *   `<span class="fpc-top-bar__label">Logout</span>`: icon-only square below sm, label from sm up.
 *
 * Phones (< 576 px): meta chips collapse to their icon, the language switcher drops its glyph, every
 * `.fpc-top-bar__label` becomes visually hidden (its button turns square, `.fpc-top-bar__phone-icon` shows)
 * and the gaps tighten, so the row fits at 360–390 px without clipping Logout.
 * - meta / context chips: `fpc-badge variant="info" color="secondary" size="sm" class="fpc-top-bar__chip"`.
 * - global search trigger: `button.fpc-top-bar__search` (+ `.fpc-top-bar__search-text`, `kbd.fpc-top-bar__search-key`).
 * Gaps come from the actions container (1 rem ≥ md, .5 rem below); items carry no margins.
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
