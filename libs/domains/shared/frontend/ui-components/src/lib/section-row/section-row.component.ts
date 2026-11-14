import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Horizontal page columns host. */
@Component({
  selector: 'fpc-section-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'section__row fpc-section-row',
    '[class.fpc-section-row--nowrap]': 'nowrap()',
    '[class.fpc-section-row--stacked]': 'stacked()',
  },
  template: `<ng-content />`,
  styleUrl: './section-row.component.scss',
})
export class FpcSectionRowComponent {
  /** Keeps columns on one line; board layouts rely on this to stay side by side. */
  readonly nowrap = input(false);
  /** Below md the columns stack vertically (sidebar + detail layouts without phone lane tabs). */
  readonly stacked = input(false);
}
