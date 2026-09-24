import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

export type FpcLaneHeaderVisibility = 'always' | 'md-up';

/**
 * Compact card / lane subheader (`card-header` + `py-2 small fw-semibold`).
 *
 * Use for column lane titles ("Pending offers", "Cloud instances") and nested card
 * section titles ("Line items"). Distinct from `fpc-page-header` (page chrome).
 *
 * Slots:
 * - `[fpcLaneHeaderTitle]` — rich title when the `title` input is not enough
 * - `[fpcLaneHeaderActions]` — trailing actions (usually `fpc-button`)
 */
@Component({
  selector: 'fpc-lane-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-lane-header card-header',
    '[class.fpc-lane-header--md-up]': "visibility() === 'md-up'",
    '[class.fpc-lane-header--flush]': 'flush()',
  },
  template: `
    <div class="fpc-lane-header__row">
      <div class="fpc-lane-header__title min-w-0">
        @if (title()) {
          <span class="fpc-lane-header__title-text">{{ title() }}</span>
        }
        <ng-content select="[fpcLaneHeaderTitle]" />
      </div>

      <div class="fpc-lane-header__actions">
        <ng-content select="[fpcLaneHeaderActions]" />
      </div>
    </div>
  `,
  styleUrl: './lane-header.component.scss',
})
export class FpcLaneHeaderComponent {
  readonly title = input('');
  /**
   * `md-up` hides the header below the Bootstrap `md` breakpoint (mobile column
   * switchers already show the active lane).
   */
  readonly visibility = input<FpcLaneHeaderVisibility>('always');
  /** Drop card-header side borders / radius when the lane card is already flush. */
  readonly flush = input(false, { transform: booleanAttribute });
}
