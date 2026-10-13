import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Full-width grid of `fpc-panel`s (charts, tables) separated by hairlines, the same way
 * `fpc-summary-bar` separates its cards: no outer frame, no gutters, an outer bottom edge when
 * `bordered`. Panels can span several columns. Below the lg breakpoint every panel takes a full
 * row, since charts need the width.
 */
@Component({
  selector: 'fpc-panel-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-panel-grid',
    '[class.fpc-panel-grid--bordered]': 'bordered()',
    '[style.--fpc-panel-grid-columns]': 'resolvedColumns()',
  },
  template: `<div class="fpc-panel-grid__grid"><ng-content /></div>`,
  styleUrl: './panel-grid.component.scss',
})
export class FpcPanelGridComponent {
  readonly columns = input(2);
  readonly bordered = input(true, { transform: booleanAttribute });

  protected readonly resolvedColumns = computed(() => Math.min(12, Math.max(1, Math.round(this.columns()))));
}
