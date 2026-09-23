import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Horizontal page columns host. When `marketingHidden` is set, marketing columns collapse and
 * the form column expands — matching identity auth split layouts.
 */
@Component({
  selector: 'fpc-section-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'section__row fpc-section-row',
    '[class.fpc-section-row--nowrap]': 'nowrap()',
    '[class.section__row--marketing-hidden]': 'marketingHidden()',
  },
  template: `<ng-content />`,
  styleUrl: './section-row.component.scss',
})
export class FpcSectionRowComponent {
  /** Keeps columns on one line; board layouts rely on this to stay side by side. */
  readonly nowrap = input(false);
  /** Hides marketing columns and expands the form column (auth layouts). */
  readonly marketingHidden = input(false);
}
