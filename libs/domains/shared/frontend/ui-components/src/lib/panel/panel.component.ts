import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { FpcLaneHeaderComponent } from '../lane-header/lane-header.component';

/**
 * One section of an `fpc-panel-grid`: a chart, table or other statistic. The title bar is the
 * regular `fpc-lane-header` (project trailing controls such as a search field with
 * `fpcPanelActions`). The body is padded for charts; use `flush` for edge-to-edge tables. Content
 * marked `fpcPanelFooter` renders in a bottom row (e.g. pagination).
 */
@Component({
  selector: 'fpc-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcLaneHeaderComponent],
  host: {
    class: 'fpc-panel',
    '[class.fpc-panel--flush]': 'flush()',
    '[class.fpc-panel--scroll]': 'scroll()',
    '[style.--fpc-panel-span]': 'resolvedSpan()',
  },
  template: `
    @if (title()) {
      <fpc-lane-header class="fpc-panel__header" [title]="title()" flush>
        <ng-container ngProjectAs="[fpcLaneHeaderActions]"><ng-content select="[fpcPanelActions]" /></ng-container>
      </fpc-lane-header>
    }
    <div class="fpc-panel__body"><ng-content /></div>
    <div class="fpc-panel__footer"><ng-content select="[fpcPanelFooter]" /></div>
  `,
  styleUrl: './panel.component.scss',
})
export class FpcPanelComponent {
  readonly title = input('');
  /** Columns to span inside `fpc-panel-grid` (lg and up). */
  readonly span = input(1);
  /** Drop body padding, e.g. for tables that should reach the panel edges. */
  readonly flush = input(false, { transform: booleanAttribute });
  /**
   * The body is the panel's scroll container in both axes (wide tables scroll sideways inside it, their
   * sticky head / foot stick to it). Height: the panel's flex share (`flex-grow-1 min-h-0` on the host)
   * or `--fpc-panel-scroll-max-height`; drop `.table-responsive` wrappers.
   */
  readonly scroll = input(false, { transform: booleanAttribute });

  protected readonly resolvedSpan = computed(() => Math.min(12, Math.max(1, Math.round(this.span()))));
}
