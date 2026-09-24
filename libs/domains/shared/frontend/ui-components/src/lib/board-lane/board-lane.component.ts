import { ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, input, viewChild } from '@angular/core';

/**
 * Column of a kanban-style board or console list lane. Four slots, all optional except the body:
 *
 * - `[fpcBoardLaneHeader]` — prefer `<fpc-lane-header flush>` for the title strip
 * - `[fpcBoardLaneSearch]` — lane filter, usually an `fpc-search-field`
 * - default content — the scrollable lane body
 * - `[fpcBoardLaneFooter]` — append footer, totals
 *
 * Export as `fpcBoardLane` and bind `[root]="lane.scrollRoot"` for `fpcInfiniteScroll` when
 * `scrollBody` is true.
 */
@Component({
  selector: 'fpc-board-lane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'fpcBoardLane',
  host: {
    class: 'card border-0 fpc-board-lane',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    <div class="fpc-board-lane__header">
      <ng-content select="[fpcBoardLaneHeader]" />
    </div>

    <div class="fpc-board-lane__search">
      <ng-content select="[fpcBoardLaneSearch]" />
    </div>

    <div
      #bodyEl
      class="fpc-board-lane__body"
      [class.fpc-board-lane__body--scroll]="scrollBody()"
      [class.list-group]="listGroup()"
      [class.list-group-flush]="listGroup()"
    >
      <ng-content />
    </div>

    <footer class="fpc-board-lane__footer">
      <ng-content select="[fpcBoardLaneFooter]" />
    </footer>
  `,
  styleUrl: './board-lane.component.scss',
})
export class FpcBoardLaneComponent {
  readonly ariaLabel = input<string | null>(null);
  /** When true, the body is the scrollport (use `scrollRoot` with infinite scroll). */
  readonly scrollBody = input(true, { transform: booleanAttribute });
  /** Adds Bootstrap list-group classes on the body for direct list-group-item children. */
  readonly listGroup = input(false, { transform: booleanAttribute });

  private readonly bodyEl = viewChild.required<ElementRef<HTMLElement>>('bodyEl');

  /** Element to pass as `fpcInfiniteScroll` `[root]` when `scrollBody` is enabled. */
  get scrollRoot(): HTMLElement {
    return this.bodyEl().nativeElement;
  }
}
