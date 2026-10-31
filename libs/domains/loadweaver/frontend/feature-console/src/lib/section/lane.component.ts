import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  FpcBadgeComponent,
  FpcBoardLaneComponent,
  FpcLaneHeaderComponent,
  FpcSectionColumnComponent,
} from '@forepath/shared/frontend/ui-components';

/**
 * One lane of the console's lane grammar (3.37 body template "Lanes", Agenstra / Decabill style): an
 * `fpc-section-column` holding an `fpc-board-lane` with an `fpc-lane-header` (title, count, actions), an optional lane
 * search and its own scrolling body. Place lanes in an `fpc-section-row`; on phones a `.fpc-lane-tabs` tab group picks
 * one (`off` hides the others below md).
 *
 * Slots: `[lwLaneActions]` / `[fpcPanelActions]` (header actions), `[lwLaneSearch]` (an `fpc-search-field` or an
 * `fpc-list-toolbar`), `[lwLaneToolbar]` (pinned toolbar: breadcrumbs, segmented views), default content (the body: a
 * flex column, so `fpc-empty-state` fills and centres; padded unless `flush`), `[lwLaneFooter]` (pager, totals).
 * A thin wrapper: all chrome comes from `fpc-board-lane` (no own CSS).
 */
@Component({
  selector: 'loadweaver-lane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcBadgeComponent, FpcBoardLaneComponent, FpcLaneHeaderComponent, FpcSectionColumnComponent],
  host: { class: 'lw-lane' },
  styles: `
    :host {
      display: contents;
    }

    /* The shared column divider (every column but the last, >= md) keys on :not(:last-child), but each column is the
       only child of this display: contents wrapper: draw it here while another lane / column follows. */
    @media (min-width: 768px) {
      :host(:has(~ loadweaver-lane, ~ fpc-section-column)) > fpc-section-column {
        border-right: var(--bs-border-width) solid var(--bs-border-color);
      }
    }
  `,
  template: `
    <fpc-section-column [grow]="grow()" [class.fpc-lane--off]="off()">
      <fpc-board-lane [ariaLabel]="title() || null" [scrollX]="scrollX()" [padded]="!flush()">
        <fpc-lane-header fpcBoardLaneHeader [title]="title()" [flush]="true">
          <ng-container ngProjectAs="[fpcLaneHeaderActions]">
            @if (count() !== null) {
              <fpc-badge color="light" size="sm">{{ count() }}</fpc-badge>
            }
            <ng-content select="[lwLaneActions],[fpcPanelActions]" />
          </ng-container>
        </fpc-lane-header>
        <ng-container ngProjectAs="[fpcBoardLaneSearch]">
          <ng-content select="[lwLaneSearch]" />
        </ng-container>
        <ng-container ngProjectAs="[fpcBoardLaneToolbar]">
          <ng-content select="[lwLaneToolbar]" />
        </ng-container>
        <ng-content />
        <ng-container ngProjectAs="[fpcBoardLaneFooter]">
          <ng-content select="[lwLaneFooter]" />
        </ng-container>
      </fpc-board-lane>
    </fpc-section-column>
  `,
})
export class LoadweaverLaneComponent {
  readonly title = input('');
  /** Count badge in the header (`null`: none). */
  readonly count = input<number | null>(null);
  /** `flex` of the column (e.g. `7 1 0` beside a `5 1 0` lane); default: equal share. */
  readonly grow = input<string | null>(null);
  /** Lists fill the lane edge to edge; forms / text get padding. */
  readonly flush = input(false, { transform: booleanAttribute });
  /** Hidden below md (the phone lane tab picks another lane). */
  readonly off = input(false, { transform: booleanAttribute });
  /** The lane body scrolls both ways (wide tables with sticky heads; no `.table-responsive` wrapper). */
  readonly scrollX = input(false, { transform: booleanAttribute });
}
