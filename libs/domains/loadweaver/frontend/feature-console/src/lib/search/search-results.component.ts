import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import type { SearchResult } from '@forepath/loadweaver/frontend/data-access-console';

import { searchActionRequest, searchKindIcon, splitItem, type SearchEntry, type SearchSection } from './search-format';

/** Sections of search entries (palette and search page): pick an entry, star or unstar a result. */
@Component({
  selector: 'loadweaver-search-results',
  imports: [CommonModule],
  templateUrl: './search-results.component.html',
  standalone: true,
})
export class LoadweaverSearchResultsComponent {
  readonly sections = input<SearchSection[]>([]);
  /** The keyboard-selected entry. */
  readonly activeId = input<string | null>(null);
  /** Optional: id prefix of the rendered rows (for `aria-activedescendant`). */
  readonly idPrefix = input('lw-search-entry');
  /** Full-bleed sections (search page): flush lists under header strips instead of spaced cards (palette). */
  readonly flush = input(false);

  readonly picked = output<SearchEntry>();
  readonly starred = output<SearchResult>();

  readonly kindIcon = searchKindIcon;
  readonly actionRequest = searchActionRequest;
  readonly splitItem = splitItem;

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
