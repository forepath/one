import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  AdminBillingService,
  AdminCustomerProfilesService,
  AdminOffersService,
  AdminProjectsService,
  AdminSupplierInvoicesService,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  type Observable,
  of,
  skip,
  switchMap,
  tap,
} from 'rxjs';

export type InventoryReferenceKind =
  | 'invoice'
  | 'offer'
  | 'supplier-invoice'
  | 'subscription'
  | 'project'
  | 'customer'
  | 'other';

export interface InventoryReferenceOption {
  kind: InventoryReferenceKind;
  /** Stored as the movement reference (document number, project name, …). */
  value: string;
  /** Second line in the suggestions (customer, supplier, plan). */
  detail: string | null;
}

const KINDS: Exclude<InventoryReferenceKind, 'other'>[] = [
  'invoice',
  'offer',
  'supplier-invoice',
  'subscription',
  'project',
  'customer',
];
const KIND_LABELS: Record<InventoryReferenceKind, string> = {
  invoice: $localize`:@@featureInventoryReference-invoice:Invoice`,
  offer: $localize`:@@featureInventoryReference-offer:Offer`,
  'supplier-invoice': $localize`:@@featureInventoryReference-supplierInvoice:Supplier invoice`,
  subscription: $localize`:@@featureInventoryReference-subscription:Subscription`,
  project: $localize`:@@featureInventoryReference-project:Project`,
  customer: $localize`:@@featureInventoryReference-customer:Customer`,
  other: $localize`:@@featureInventoryReference-other:Other`,
};
const KIND_ICONS: Record<InventoryReferenceKind, string> = {
  invoice: 'receipt',
  offer: 'file-earmark-text',
  'supplier-invoice': 'truck',
  subscription: 'arrow-repeat',
  project: 'kanban',
  customer: 'person',
  other: 'pencil',
};
/** Suggestions per source (the typeahead shows them grouped). */
const PER_SOURCE = 5;
const nonEmpty = (value: string | null | undefined): value is string => Boolean(value?.trim());

/**
 * Reference of a stock movement: a typeahead over the documents and records it usually refers to (invoices, offers,
 * supplier invoices, subscriptions, projects, customers; searched through their admin list endpoints in parallel), or
 * "Other" free text. The chosen value is stored as text on the movement and printed on its document.
 */
@Component({
  selector: 'framework-inventory-reference-select',
  standalone: true,
  imports: [FpcBadgeComponent, FpcTypeaheadSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="billing-admin-user-select">
      @if (value()) {
        <fpc-badge
          variant="info"
          color="secondary"
          class="billing-admin-user-select__chip"
          data-testid="inventory-reference-chip"
        >
          <i class="bi bi-{{ kindIcons[kind()] }} me-1" aria-hidden="true"></i>
          <span class="text-truncate"
            ><span class="text-body-secondary me-1">{{ kindLabels[kind()] }}</span
            ><span [class.font-monospace]="kind() !== 'other' && kind() !== 'project' && kind() !== 'customer'">{{
              value()
            }}</span></span
          >
          <button
            type="button"
            class="btn-close billing-admin-user-select__clear"
            [disabled]="disabled()"
            (click)="clear()"
            i18n-aria-label="@@featureInventoryReference-clear"
            aria-label="Clear reference"
          ></button>
        </fpc-badge>
      } @else {
        <fpc-typeahead-select
          [inputId]="inputId()"
          [listboxId]="inputId() + '-listbox'"
          [placeholder]="placeholder"
          [disabled]="disabled()"
          [loading]="loading()"
          [openOnFocus]="false"
          [query]="query()"
          (queryChange)="onQuery($event)"
          [open]="open()"
          (openChange)="open.set($event)"
          (cleared)="reset()"
        >
          <div fpcTypeaheadSuggestions>
            @for (group of groups(); track group.kind) {
              <h6 class="dropdown-header d-flex align-items-center gap-1">
                <i class="bi bi-{{ kindIcons[group.kind] }}" aria-hidden="true"></i>{{ kindLabels[group.kind] }}
              </h6>
              @for (option of group.options; track option.value) {
                <button
                  type="button"
                  class="dropdown-item py-2 text-start"
                  (mousedown)="pick(option, $event)"
                  data-testid="inventory-reference-option"
                >
                  <span class="d-block small fw-medium text-truncate">{{ option.value }}</span>
                  @if (option.detail) {
                    <span class="d-block text-body-secondary small text-truncate">{{ option.detail }}</span>
                  }
                </button>
              }
            }
            @if (query().trim(); as text) {
              @if (!loading() && groups().length === 0) {
                <span class="dropdown-item-text text-body-secondary small" i18n="@@featureInventoryReference-none"
                  >No matching documents.</span
                >
              }
              <button
                type="button"
                class="dropdown-item py-2 text-start"
                (mousedown)="pickOther(text, $event)"
                data-testid="inventory-reference-other"
              >
                <span class="d-block small fw-medium text-truncate"
                  ><i class="bi bi-pencil me-1" aria-hidden="true"></i
                  ><ng-container i18n="@@featureInventoryReference-useOther">Other:</ng-container> {{ text }}</span
                >
                <span class="d-block text-body-secondary small" i18n="@@featureInventoryReference-otherHint"
                  >Free text, for example a delivery note number</span
                >
              </button>
            }
          </div>
        </fpc-typeahead-select>
      }
    </div>
  `,
  styleUrls: ['../billing-admin-user-select/billing-admin-user-select.component.scss'],
})
export class InventoryReferenceSelectComponent {
  /** The reference text ('' = none). */
  readonly value = model('');
  readonly disabled = input(false);
  readonly inputId = input('inventoryReference');

  private readonly billing = inject(AdminBillingService);
  private readonly offers = inject(AdminOffersService);
  private readonly supplierInvoices = inject(AdminSupplierInvoicesService);
  private readonly projects = inject(AdminProjectsService);
  private readonly customers = inject(AdminCustomerProfilesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly placeholder = $localize`:@@featureInventoryReference-placeholder:Search invoice, offer, project, customer…`;
  readonly kindLabels = KIND_LABELS;
  readonly kindIcons = KIND_ICONS;

  readonly query = signal('');
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly results = signal<InventoryReferenceOption[]>([]);
  /** Kind of the chosen value; values set from outside (or typed) count as "Other". */
  private readonly pickedKind = signal<{ value: string; kind: InventoryReferenceKind } | null>(null);

  readonly kind = computed<InventoryReferenceKind>(() => {
    const picked = this.pickedKind();

    return picked && picked.value === this.value() ? picked.kind : 'other';
  });
  readonly groups = computed(() =>
    KINDS.map((kind) => ({ kind, options: this.results().filter((option) => option.kind === kind) })).filter(
      (group) => group.options.length > 0,
    ),
  );

  constructor() {
    toObservable(this.query)
      .pipe(
        skip(1),
        debounceTime(250),
        distinctUntilChanged(),
        tap(() => this.loading.set(true)),
        switchMap((query) => (query.trim() ? this.search(query.trim()) : of([] as InventoryReferenceOption[]))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((options) => {
        this.results.set(options);
        this.loading.set(false);
      });
  }

  /** All sources in parallel; a failing source (e.g. no permission, feature off) contributes nothing. */
  private search(search: string): Observable<InventoryReferenceOption[]> {
    const page = { search, limit: PER_SOURCE, offset: 0 };
    const safe = (source: Observable<InventoryReferenceOption[]>) =>
      source.pipe(catchError(() => of([] as InventoryReferenceOption[])));

    return combineLatest([
      safe(
        this.billing.listInvoices(page).pipe(
          map((response) =>
            response.items
              .filter((invoice) => nonEmpty(invoice.invoiceNumber))
              .map((invoice) => ({
                kind: 'invoice' as const,
                value: invoice.invoiceNumber!,
                detail: invoice.customerName ?? invoice.userEmail ?? null,
              })),
          ),
        ),
      ),
      safe(
        this.offers.list(page).pipe(
          map((response) =>
            response.items
              .filter((offer) => nonEmpty(offer.offerNumber))
              .map((offer) => ({
                kind: 'offer' as const,
                value: offer.offerNumber!,
                detail: offer.customerName ?? offer.userEmail ?? null,
              })),
          ),
        ),
      ),
      safe(
        this.supplierInvoices.list(page).pipe(
          map((response) =>
            response.items
              .filter((invoice) => nonEmpty(invoice.invoiceNumber))
              .map((invoice) => ({
                kind: 'supplier-invoice' as const,
                value: invoice.invoiceNumber!,
                detail: invoice.supplierName ?? null,
              })),
          ),
        ),
      ),
      safe(
        this.billing.listSubscriptions(page).pipe(
          map((response) =>
            response.items
              .filter((subscription) => nonEmpty(subscription.number))
              .map((subscription) => ({
                kind: 'subscription' as const,
                value: subscription.number,
                detail:
                  [subscription.planName, subscription.customerName ?? subscription.userEmail]
                    .filter(Boolean)
                    .join(', ') || null,
              })),
          ),
        ),
      ),
      safe(
        this.projects.list(page).pipe(
          map((response) =>
            response.items
              .filter((project) => nonEmpty(project.name))
              .map((project) => ({
                kind: 'project' as const,
                value: project.name,
                detail: project.customerName ?? project.userEmail ?? null,
              })),
          ),
        ),
      ),
      safe(
        this.customers.list(page).pipe(
          map((response) =>
            response.items
              .filter((customer) => nonEmpty(customer.customerNumber))
              .map((customer) => ({
                kind: 'customer' as const,
                value: customer.customerNumber,
                detail:
                  customer.company?.trim() ||
                  [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() ||
                  null,
              })),
          ),
        ),
      ),
    ]).pipe(map((sources) => sources.flat()));
  }

  onQuery(value: string): void {
    this.query.set(value);
    this.open.set(value.trim().length > 0);

    if (!value.trim()) {
      this.results.set([]);
      this.loading.set(false);
    }
  }

  pick(option: InventoryReferenceOption, event: Event): void {
    event.preventDefault();
    this.pickedKind.set({ value: option.value, kind: option.kind });
    this.value.set(option.value.slice(0, 255));
    this.reset();
  }

  pickOther(text: string, event: Event): void {
    event.preventDefault();
    this.pickedKind.set({ value: text.trim().slice(0, 255), kind: 'other' });
    this.value.set(text.trim().slice(0, 255));
    this.reset();
  }

  clear(): void {
    this.pickedKind.set(null);
    this.value.set('');
    this.reset();
  }

  reset(): void {
    this.query.set('');
    this.results.set([]);
    this.open.set(false);
    this.loading.set(false);
  }
}
