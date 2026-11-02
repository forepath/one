import { ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, input, viewChild } from '@angular/core';

/**
 * Column of a kanban-style board or console list lane. Five slots, all optional except the body:
 *
 * - `[fpcBoardLaneHeader]` - prefer `<fpc-lane-header flush>` for the title strip
 * - `[fpcBoardLaneSearch]` - lane search strip: an `fpc-search-field` (unbordered here) or an
 *   `fpc-list-toolbar` (search + filters)
 * - `[fpcBoardLaneToolbar]` - pinned lane toolbar under the search (breadcrumbs, segmented view
 *   switch, time range, upload): never put toolbars inside the scrolling body
 * - default content - the scrollable lane body, always a flex column: an `fpc-empty-state` fills and
 *   centres in it; lists / tables / editors sit flush, forms / prose use `padded`
 * - `[fpcBoardLaneFooter]` - pinned footer: pager, totals, batch bar
 *
 * Export as `fpcBoardLane` and bind `[root]="lane.scrollRoot"` for scroll observers when
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

    <div class="fpc-board-lane__toolbar">
      <ng-content select="[fpcBoardLaneToolbar]" />
    </div>

    <div
      #bodyEl
      class="fpc-board-lane__body"
      [class.fpc-board-lane__body--scroll]="scrollBody()"
      [class.fpc-board-lane__body--scroll-x]="scrollBody() && scrollX()"
      [class.fpc-board-lane__body--padded]="padded()"
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
  /**
   * The body scrolls sideways too (one scroll container for both axes): wide tables scroll inside the
   * lane and their sticky head / foot stick to the lane body. Drop `.table-responsive` wrappers then.
   */
  readonly scrollX = input(false, { transform: booleanAttribute });
  /** Forms and prose: the body gets the lane inset (`.75rem 1rem`, compact `.5rem 1rem`). Lists stay flush. */
  readonly padded = input(false, { transform: booleanAttribute });

  private readonly bodyEl = viewChild.required<ElementRef<HTMLElement>>('bodyEl');

  /** Element to pass as an IntersectionObserver root when `scrollBody` is enabled. */
  get scrollRoot(): HTMLElement {
    return this.bodyEl().nativeElement;
  }
}
