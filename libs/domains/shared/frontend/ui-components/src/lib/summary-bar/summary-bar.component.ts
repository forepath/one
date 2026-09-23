import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Metric strip above a page body. The bar owns cell separators: right edges (kept when the last
 * row is incomplete) and full-width bottoms on completed rows. The outer bottom edge is drawn when
 * `bordered`.
 */
@Component({
  selector: 'fpc-summary-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
  },
  template: `<div class="fpc-summary-bar__grid"><ng-content /></div>`,
  styleUrl: './summary-bar.component.scss',
})
export class FpcSummaryBarComponent {
  readonly columns = input(4);
  readonly bordered = input(true);

  protected readonly hostClasses = computed(() => {
    const cols = Math.min(12, Math.max(1, Math.round(this.columns())));
    const classes = ['fpc-summary-bar', `fpc-summary-bar--cols-${cols}`];

    if (this.bordered()) {
      classes.push('fpc-summary-bar--bordered');
    }

    return classes.join(' ');
  });
}
