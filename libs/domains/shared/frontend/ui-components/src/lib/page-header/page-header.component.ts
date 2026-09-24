import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcPageHeaderDensity = 'default' | 'compact';

/**
 * Console page / panel title strip (`bg-body-tertiary` + bottom border).
 *
 * Slots:
 * - `[fpcPageHeaderBreadcrumbs]` — back link / crumbs above the title row
 * - `[fpcPageHeaderTitle]` — rich title when the `title` input is not enough
 * - `[fpcPageHeaderActions]` — trailing actions (usually `fpc-button`)
 * - default — optional content below the title row
 *
 * Row height is locked via `--fpc-page-header-control-size` (sidebar-aligned). Icon-only
 * `fpc-button size="sm"` inside the header picks up that size so actions stay 1:1.
 * Workspace chips should be `fpc-button` wrapping `fpc-badge` — the button flushes its own
 * padding when it contains a badge (host `p-0` never reaches the inner `.btn`).
 */
@Component({
  selector: 'fpc-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-page-header',
    '[class.fpc-page-header--bordered]': 'bordered()',
    '[class.fpc-page-header--compact]': 'density() === "compact"',
  },
  template: `
    <div class="fpc-page-header__breadcrumbs">
      <ng-content select="[fpcPageHeaderBreadcrumbs]" />
    </div>

    <div class="fpc-page-header__row">
      <div class="fpc-page-header__titles">
        @if (icon()) {
          <i class="bi bi-{{ icon() }} fpc-page-header__icon" aria-hidden="true"></i>
        }
        <div class="fpc-page-header__title-block min-w-0">
          @if (title()) {
            <h1 [class]="titleClasses()">{{ title() }}</h1>
          }
          <ng-content select="[fpcPageHeaderTitle]" />
          @if (subtitle()) {
            <p class="fpc-page-header__subtitle text-body-secondary mb-0">{{ subtitle() }}</p>
          }
        </div>
      </div>

      <div class="fpc-page-header__actions">
        <ng-content select="[fpcPageHeaderActions]" />
      </div>
    </div>

    <ng-content />
  `,
  styleUrl: './page-header.component.scss',
})
export class FpcPageHeaderComponent {
  readonly title = input('');
  readonly subtitle = input<string | null>(null);
  readonly icon = input<string | null>(null);
  readonly bordered = input(true);
  /** `compact` matches lane / panel strips (`px-3 py-2`); default matches page chrome (`p-3`). */
  readonly density = input<FpcPageHeaderDensity>('default');

  protected readonly titleClasses = computed(
    () => `fpc-page-header__title ${this.density() === 'compact' ? 'h6' : 'h5'} mb-0 fw-semibold`,
  );
}
