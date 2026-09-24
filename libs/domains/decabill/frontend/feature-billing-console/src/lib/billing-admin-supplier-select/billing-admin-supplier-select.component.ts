import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  AdminSupplierProfilesService,
  type AdminSupplierProfileListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

@Component({
  selector: 'framework-billing-admin-supplier-select',
  standalone: true,
  imports: [CommonModule, FpcBadgeComponent, FpcTypeaheadSelectComponent],
  templateUrl: './billing-admin-supplier-select.component.html',
  styleUrls: ['../billing-admin-user-select/billing-admin-user-select.component.scss'],
})
export class BillingAdminSupplierSelectComponent {
  readonly suppliers = input<AdminSupplierProfileListItem[]>([]);
  readonly selectedSupplierId = model<string>('');
  readonly size = input<'sm' | 'md'>('md');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly inputId = input('billingAdminSupplierSelect');
  readonly placeholder = input(
    $localize`:@@featureBillingAdminSupplierSelect-placeholder:Search by name, number, or email`,
  );
  readonly showSuggestionsOnFocus = input(false);
  readonly suggestionLimit = input(20);

  private readonly profilesService = inject(AdminSupplierProfilesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly suggestionsOpen = signal(false);
  readonly searchResults = signal<AdminSupplierProfileListItem[]>([]);
  readonly loading = signal(false);
  /** Keeps the picked supplier visible after search results are cleared. */
  private readonly selectedSupplierCache = signal<AdminSupplierProfileListItem | null>(null);

  readonly filteredSuppliers = computed(() => this.searchResults());

  readonly selectedSupplier = computed(() => {
    const selectedId = this.selectedSupplierId();

    if (!selectedId) {
      return null;
    }

    return (
      this.suppliers().find((supplier) => supplier.id === selectedId) ??
      this.searchResults().find((supplier) => supplier.id === selectedId) ??
      (this.selectedSupplierCache()?.id === selectedId ? this.selectedSupplierCache() : null)
    );
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
            return of([] as AdminSupplierProfileListItem[]);
          }

          return this.profilesService.list({ search: term, limit: this.suggestionLimit() }).pipe(
            map((response) => response.items),
            catchError(() => of([] as AdminSupplierProfileListItem[])),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((suppliers) => {
        this.searchResults.set(suppliers);
        this.loading.set(false);
      });
  }

  reset(): void {
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.suggestionsOpen.set(false);
    this.loading.set(false);
  }

  supplierPrimaryLabel(supplier: AdminSupplierProfileListItem): string {
    return (
      supplier.company?.trim() ||
      [supplier.firstName, supplier.lastName].filter(Boolean).join(' ').trim() ||
      supplier.email?.trim() ||
      supplier.supplierNumber
    );
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

  pickSupplier(supplier: AdminSupplierProfileListItem, event: Event): void {
    event.preventDefault();
    this.selectedSupplierCache.set(supplier);
    this.selectedSupplierId.set(supplier.id);
    this.reset();
  }

  clearSelection(): void {
    this.selectedSupplierCache.set(null);
    this.selectedSupplierId.set('');
    this.reset();
  }
}
