import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  AdminPromotionsService,
  type AdminPromotionResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

import { isAccessDeniedError } from '../billing-access-denied.util';

/**
 * Admin promotion typeahead. The stored value is the promotion **code** (what the offer line API expects).
 * The admin promotions API needs `promotions:write`; without it (401 / 403) the select becomes a plain text input.
 */
@Component({
  selector: 'framework-billing-admin-promotion-select',
  standalone: true,
  imports: [CommonModule, FpcBadgeComponent, FpcTypeaheadSelectComponent],
  templateUrl: './billing-admin-promotion-select.component.html',
  styleUrls: ['../billing-admin-user-select/billing-admin-user-select.component.scss'],
})
export class BillingAdminPromotionSelectComponent {
  readonly selectedCode = model<string>('');
  readonly size = input<'sm' | 'md'>('md');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly inputId = input('billingAdminPromotionSelect');
  readonly placeholder = input($localize`:@@featureBillingAdminPromotionSelect-placeholder:Search by code or name`);
  readonly showSuggestionsOnFocus = input(false);
  readonly suggestionLimit = input(20);

  private readonly promotionsService = inject(AdminPromotionsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly suggestionsOpen = signal(false);
  readonly searchResults = signal<AdminPromotionResponse[]>([]);
  readonly loading = signal(false);
  /** Set once the list API answered 401 / 403: the code is typed as plain text from then on. */
  readonly accessDenied = signal(false);
  /** Keeps the picked promotion's name visible after search results are cleared. */
  private readonly pickedPromotion = signal<AdminPromotionResponse | null>(null);

  readonly filteredPromotions = computed(() => this.searchResults());

  /** The chip label: the code is the value, so a stored code always shows, even if it was never searched. */
  readonly selectedPromotion = computed(() => {
    const code = this.selectedCode()?.trim();

    if (!code) {
      return null;
    }

    const picked = this.pickedPromotion();

    return {
      code,
      name: picked?.code === code ? picked.name : (this.searchResults().find((p) => p.code === code)?.name ?? null),
    };
  });

  constructor() {
    this.searchQuery$
      .pipe(
        skip(1),
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => this.loading.set(true)),
        switchMap((query) => {
          const term = query.trim();

          if (!term) {
            return of([] as AdminPromotionResponse[]);
          }

          return this.promotionsService.list({ search: term, limit: this.suggestionLimit() }).pipe(
            map((response) => response.items ?? []),
            catchError((error: unknown) => {
              if (isAccessDeniedError(error)) {
                this.accessDenied.set(true);
                this.selectedCode.set(term);
              }

              return of([] as AdminPromotionResponse[]);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((promotions) => {
        this.searchResults.set(promotions);
        this.loading.set(false);
      });
  }

  reset(): void {
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.suggestionsOpen.set(false);
    this.loading.set(false);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    const term = value.trim();

    if (term.length > 0 || this.showSuggestionsOnFocus()) {
      this.suggestionsOpen.set(true);
      if (term.length > 0) {
        this.loading.set(true);
        this.searchResults.set([]);
      } else {
        this.loading.set(false);
        this.searchResults.set([]);
      }
    } else {
      this.suggestionsOpen.set(false);
      this.loading.set(false);
      this.searchResults.set([]);
    }
  }

  /** Fallback (no access): the typed text is the code. */
  onPlainInput(value: string): void {
    this.selectedCode.set(value);
  }

  pickPromotion(promotion: AdminPromotionResponse, event: Event): void {
    event.preventDefault();
    this.pickedPromotion.set(promotion);
    this.selectedCode.set(promotion.code);
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.suggestionsOpen.set(false);
  }

  clearSelection(): void {
    this.pickedPromotion.set(null);
    this.selectedCode.set('');
    this.reset();
  }
}
