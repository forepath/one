import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { FpcBadgeComponent } from '../badge/badge.component';
import { FpcLaneHeaderComponent } from '../lane-header/lane-header.component';

/**
 * Title bar of one item collection (`fpc-list`, table or card grid) on a page with several
 * sections: the collection name, the item count and optional trailing controls. Shares the
 * `fpc-lane-header` chrome so panels and board lanes read alike; put the collection's search
 * directly below it. Single-list pages do not repeat the page title: they keep only the page
 * header with the search under it. Sticky by default (inside the one lane / panel scroller, on the
 * sticky-local layer).
 *
 * **In-lane groups** (3.38 R2 / R5): sibling sections inside one lane (per volume, channel, wave, zone,
 * "Capacity", "System") are separated by `fpc-list-header` rows — they own the dividing line; no
 * `h3.h6` + manual `border-top`.
 *
 * - `count` alone renders a count badge `[12]` (never "Title (12)").
 * - `count` + `total` renders `[3 / 12]` when a search or filter hides items.
 *
 * Slots:
 * - `[fpcListHeaderTitle]` - rich content after the title (badges, hints)
 * - `[fpcListHeaderActions]` - trailing controls (usually `fpc-button size="sm"`)
 */
@Component({
  selector: 'fpc-list-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcBadgeComponent, FpcLaneHeaderComponent],
  host: {
    class: 'fpc-list-header',
    '[class.fpc-list-header--sticky]': 'sticky()',
  },
  template: `
    <fpc-lane-header class="fpc-list-header__bar" flush>
      <span fpcLaneHeaderTitle class="fpc-list-header__title min-w-0">
        <span class="fpc-list-header__title-text">{{ title() }}</span>
        @if (countText(); as text) {
          <fpc-badge class="fpc-list-header__count" color="light" size="sm" data-testid="fpc-list-header-count">{{
            text
          }}</fpc-badge>
        }
        <ng-content select="[fpcListHeaderTitle]" />
      </span>
      <ng-container ngProjectAs="[fpcLaneHeaderActions]"><ng-content select="[fpcListHeaderActions]" /></ng-container>
    </fpc-lane-header>
  `,
  styleUrl: './list-header.component.scss',
})
export class FpcListHeaderComponent {
  readonly title = input('');
  /** Items shown (after search / filters); `null` hides the count. */
  readonly count = input<number | null>(null);
  /** Items loaded; shown as `count / total` when it differs from `count`. */
  readonly total = input<number | null>(null);
  readonly sticky = input(true, { transform: booleanAttribute });

  protected readonly countText = computed(() => {
    const count = this.count();
    const total = this.total();

    if (count === null || count === undefined) {
      return null;
    }

    return total !== null && total !== undefined && total !== count ? `${count} / ${total}` : `${count}`;
  });
}
