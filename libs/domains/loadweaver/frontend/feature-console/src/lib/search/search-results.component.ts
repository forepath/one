import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import type { SearchResult } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcListComponent,
  FpcListHeaderComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

import { PLAN_STATUS_BADGE_TONE, planStatusLabel } from '../plans/plan-format';
import {
  searchActionRequest,
  searchKindIcon,
  searchKindSingular,
  searchResultStatus,
  searchResultTitle,
  splitItem,
  type SearchEntry,
  type SearchSection,
} from './search-format';

/**
 * Sections of search entries (search page): `fpc-list-header` per section over a flush `fpc-list` listbox of
 * `fpc-list-item` options; pick an entry, star or unstar a result.
 */
@Component({
  selector: 'loadweaver-search-results',
  imports: [
    CommonModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcListComponent,
    FpcListHeaderComponent,
    FpcListItemComponent,
  ],
  templateUrl: './search-results.component.html',
  standalone: true,
})
export class LoadweaverSearchResultsComponent {
  readonly sections = input<SearchSection[]>([]);
  /** The keyboard-selected entry. */
  readonly activeId = input<string | null>(null);
  /** Optional: id prefix of the rendered rows (for `aria-activedescendant`). */
  readonly idPrefix = input('lw-search-entry');
  /**
   * Off in fleet mode while the cluster doesn't verify this fleet's per-user claims: favourites are the person's,
   * and without the claim the cluster would only see the fleet's service account (2026-10-27).
   */
  readonly starrable = input(true);
  /** Shown under the results when starring is off (why). */
  readonly starHint = input<string | null>(null);

  readonly picked = output<SearchEntry>();
  readonly starred = output<SearchResult>();

  readonly kindIcon = searchKindIcon;
  readonly actionRequest = searchActionRequest;
  readonly splitItem = splitItem;
  /** Translated kind + name, plans without their id plus a status badge (D7 / D11, LW-21). */
  readonly resultTitle = searchResultTitle;
  readonly resultStatus = searchResultStatus;
  readonly statusTone = PLAN_STATUS_BADGE_TONE;
  readonly statusLabel = planStatusLabel;
  readonly kindSingular = searchKindSingular;

  readonly starLabel = $localize`:@@lwConsoleSearch-star:Add to favourites`;
  readonly unstarLabel = $localize`:@@lwConsoleSearch-unstar:Remove from favourites`;

  domId(entry: SearchEntry): string {
    return `${this.idPrefix()}-${entry.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }

  star(result: SearchResult, event: Event): void {
    event.stopPropagation();
    this.starred.emit(result);
  }
}
