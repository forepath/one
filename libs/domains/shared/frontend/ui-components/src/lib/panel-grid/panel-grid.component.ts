import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Full-width grid of `fpc-panel`s (charts, tables) separated by hairlines, the same way
 * `fpc-summary-bar` separates its cards: no outer frame, no gutters, an outer bottom edge when
 * `bordered`. Panels can span several columns. Below the lg breakpoint every panel takes a full
 * row, since charts need the width. With `fill`, the grid takes the remaining height of its flex
 * column parent (e.g. a page's scroll area) and its rows share it, so a panel showing an empty
 * state stretches like a page-level one.
 */
@Component({
  selector: 'fpc-panel-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-panel-grid',
    '[class.fpc-panel-grid--bordered]': 'bordered()',
    '[class.fpc-panel-grid--fill]': 'fill()',
    '[style.--fpc-panel-grid-columns]': 'resolvedColumns()',
    '[style.--fpc-panel-grid-row-height]': 'rowHeight()',
  },
  template: `<div class="fpc-panel-grid__grid"><ng-content /></div>`,
  styleUrl: './panel-grid.component.scss',
})
export class FpcPanelGridComponent {
  readonly columns = input(2);
  readonly bordered = input(true, { transform: booleanAttribute });
  /** Grow into the remaining height of a flex column parent; rows share the extra space. */
  readonly fill = input(false, { transform: booleanAttribute });
  /** Fixed height of the implicit rows (`120px`; panels span rows with `grid-row`), `null`: content height. */
  readonly rowHeight = input<string | null>(null);

  protected readonly resolvedColumns = computed(() => Math.min(12, Math.max(1, Math.round(this.columns()))));
}
