import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  AdminInventoryService,
  type InventoryCompartment,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

/** Typeahead over the active compartments of all warehouses (code, name, warehouse). */
@Component({
  selector: 'framework-inventory-compartment-select',
  standalone: true,
  imports: [FpcBadgeComponent, FpcTypeaheadSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="billing-admin-user-select">
      @if (selected(); as compartment) {
        <fpc-badge variant="info" color="secondary" class="billing-admin-user-select__chip">
          <span class="text-truncate"
            ><span class="font-monospace">{{ compartment.warehouseCode }} / {{ compartment.code }}</span>
            @if (compartment.name) {
              <span class="ms-1 text-body-secondary">{{ compartment.name }}</span>
            }
          </span>
          <button
            type="button"
            class="btn-close billing-admin-user-select__clear"
            [disabled]="disabled()"
            (click)="clear()"
            i18n-aria-label="@@featureInventoryCompartmentSelect-clearAria"
            aria-label="Clear selected compartment"
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
          [query]="query()"
          (queryChange)="onQuery($event)"
          [open]="open()"
          (openChange)="open.set($event)"
          (cleared)="reset()"
        >
          <div fpcTypeaheadSuggestions>
            @for (compartment of results(); track compartment.id) {
              <button
                type="button"
                class="dropdown-item py-2 text-start"
                [disabled]="compartment.id === excludeId()"
                (mousedown)="pick(compartment, $event)"
                data-testid="inventory-compartment-option"
              >
                <span class="d-block small fw-medium font-monospace text-truncate"
                  >{{ compartment.warehouseCode }} / {{ compartment.code }}</span
                >
                <span class="d-block text-body-secondary small text-truncate"
                  >{{ compartment.warehouseName }}
                  @if (compartment.name) {
                    <span class="ms-2">{{ compartment.name }}</span>
                  }
                </span>
              </button>
            } @empty {
              @if (query().trim() && !loading()) {
                <span
                  class="dropdown-item-text text-body-secondary small"
                  i18n="@@featureInventoryCompartmentSelect-none"
                  >No compartments found.</span
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
export class InventoryCompartmentSelectComponent {
  readonly selected = model<InventoryCompartment | null>(null);
  readonly excludeId = input<string | null>(null);
  readonly disabled = input(false);
  readonly required = input(false);
  readonly inputId = input('inventoryCompartmentSelect');
  readonly placeholder = input(
    $localize`:@@featureInventoryCompartmentSelect-placeholder:Search compartment or warehouse`,
  );
  readonly picked = output<InventoryCompartment | null>();

  private readonly service = inject(AdminInventoryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly query = signal('');
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly results = signal<InventoryCompartment[]>([]);

  constructor() {
    toObservable(this.query)
      .pipe(
        skip(1),
        debounceTime(250),
        distinctUntilChanged(),
        tap(() => this.loading.set(true)),
        switchMap((query) =>
          query.trim()
            ? this.service.listCompartments({ search: query.trim(), limit: 20, activeOnly: true }).pipe(
                map((response) => response.items),
                catchError(() => of([] as InventoryCompartment[])),
              )
            : of([] as InventoryCompartment[]),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((items) => {
        this.results.set(items);
        this.loading.set(false);
      });
  }

  onQuery(value: string): void {
    this.query.set(value);
    this.open.set(value.trim().length > 0);

    if (!value.trim()) {
      this.results.set([]);
      this.loading.set(false);
    }
  }

  pick(compartment: InventoryCompartment, event: Event): void {
    event.preventDefault();
    this.selected.set(compartment);
    this.picked.emit(compartment);
    this.reset();
  }

  clear(): void {
    this.selected.set(null);
    this.picked.emit(null);
    this.reset();
  }

  reset(): void {
    this.query.set('');
    this.results.set([]);
    this.open.set(false);
    this.loading.set(false);
  }
}
