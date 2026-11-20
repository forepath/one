import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { AdminInventoryService, type InventoryArticle } from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

import { formatInventoryQuantity } from './inventory-labels';

/**
 * Typeahead over articles (number, name, EAN, MPN). Emits `articlePicked` with the full article so callers can
 * prefill description, unit and price; `selectedArticleId` is two-way. Loads the picked article when only its id is
 * known (editing an existing line).
 */
@Component({
  selector: 'framework-inventory-article-select',
  standalone: true,
  imports: [FpcBadgeComponent, FpcTypeaheadSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="billing-admin-user-select">
      @if (selectedArticle(); as article) {
        <fpc-badge variant="info" color="secondary" class="billing-admin-user-select__chip">
          <span class="text-truncate">
            {{ article.name }}<span class="ms-1 font-monospace text-body-secondary">{{ article.articleNumber }}</span>
          </span>
          <button
            type="button"
            class="btn-close billing-admin-user-select__clear"
            [disabled]="disabled()"
            (click)="clearSelection()"
            i18n-aria-label="@@featureInventoryArticleSelect-clearAria"
            aria-label="Clear selected article"
          ></button>
        </fpc-badge>
      } @else {
        <fpc-typeahead-select
          [inputId]="inputId()"
          [listboxId]="inputId() + '-listbox'"
          [placeholder]="placeholder()"
          [disabled]="disabled()"
          [required]="required()"
          [loading]="loading()"
          [openOnFocus]="false"
          [query]="searchQuery()"
          (queryChange)="onSearchChange($event)"
          [open]="suggestionsOpen()"
          (openChange)="suggestionsOpen.set($event)"
          (cleared)="reset()"
        >
          <div fpcTypeaheadSuggestions>
            @for (article of results(); track article.id) {
              <button
                type="button"
                class="dropdown-item py-2 text-start"
                (mousedown)="pick(article, $event)"
                data-testid="inventory-article-option"
              >
                <span class="d-block small fw-medium text-truncate">{{ article.name }}</span>
                <span class="d-block text-body-secondary small text-truncate"
                  ><span class="font-monospace">{{ article.articleNumber }}</span>
                  @if (article.ean) {
                    <span class="ms-2 font-monospace">{{ article.ean }}</span>
                  }
                  <span class="ms-2">{{ quantity(article) }}</span></span
                >
              </button>
            } @empty {
              @if (searchQuery().trim() && !loading()) {
                <span class="dropdown-item-text text-body-secondary small" i18n="@@featureInventoryArticleSelect-none"
                  >No articles found.</span
                >
              }
            }
          </div>
        </fpc-typeahead-select>
      }
    </div>
  `,
  styleUrls: ['../billing-admin-user-select/billing-admin-user-select.component.scss'],
})
export class InventoryArticleSelectComponent {
  readonly selectedArticleId = model<string | null>(null);
  readonly disabled = input(false);
  readonly required = input(false);
  readonly activeOnly = input(true);
  readonly inputId = input('inventoryArticleSelect');
  readonly placeholder = input($localize`:@@featureInventoryArticleSelect-placeholder:Search by number, name or EAN`);
  readonly articlePicked = output<InventoryArticle | null>();

  private readonly service = inject(AdminInventoryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly suggestionsOpen = signal(false);
  readonly results = signal<InventoryArticle[]>([]);
  readonly loading = signal(false);
  private readonly cache = signal<InventoryArticle | null>(null);

  readonly selectedArticle = computed(() => {
    const id = this.selectedArticleId();
    const cached = this.cache();

    return id && cached?.id === id ? cached : null;
  });

  constructor() {
    toObservable(this.searchQuery)
      .pipe(
        skip(1),
        debounceTime(250),
        distinctUntilChanged(),
        tap(() => this.loading.set(true)),
        switchMap((query) =>
          query.trim()
            ? this.service
                .listArticles({ search: query.trim(), limit: 20, activeOnly: this.activeOnly() || undefined })
                .pipe(
                  map((response) => response.items),
                  catchError(() => of([] as InventoryArticle[])),
                )
            : of([] as InventoryArticle[]),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((articles) => {
        this.results.set(articles);
        this.loading.set(false);
      });

    // A preset id (editing) resolves to its article for the chip.
    toObservable(this.selectedArticleId)
      .pipe(
        distinctUntilChanged(),
        switchMap((id) =>
          id && this.cache()?.id !== id ? this.service.getArticle(id).pipe(catchError(() => of(null))) : of(undefined),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((article) => {
        if (article) this.cache.set(article);
      });
  }

  quantity(article: InventoryArticle): string {
    return formatInventoryQuantity(article.totalQuantity, article.unit);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.suggestionsOpen.set(value.trim().length > 0);

    if (value.trim()) {
      this.loading.set(true);
    } else {
      this.results.set([]);
      this.loading.set(false);
    }
  }

  pick(article: InventoryArticle, event: Event): void {
    event.preventDefault();
    this.cache.set(article);
    this.selectedArticleId.set(article.id);
    this.articlePicked.emit(article);
    this.reset();
  }

  clearSelection(): void {
    this.cache.set(null);
    this.selectedArticleId.set(null);
    this.articlePicked.emit(null);
    this.reset();
  }

  reset(): void {
    this.searchQuery.set('');
    this.results.set([]);
    this.suggestionsOpen.set(false);
    this.loading.set(false);
  }
}
