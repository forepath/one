import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AdminInventoryService,
  InventoryFacade,
  type InventoryCompartment,
  type InventoryStock,
  type InventoryWithdrawalRequest,
  type InventoryWithdrawalRequestStatus,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcTableCellDirective,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcKeyValueListComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FPC_DEFAULT_PAGE_SIZE,
  type FpcKeyValueItem,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { catchError, of } from 'rxjs';

import { formatBillingDateTime } from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { dbCopyIdItem } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';

import { InventoryCompartmentSelectComponent } from './inventory-compartment-select.component';
import {
  formatInventoryQuantity,
  INVENTORY_REQUEST_SOURCE_LABELS,
  inventoryRequestState,
  inventoryUnitLabel,
} from './inventory-labels';
import { InventoryNavComponent } from './inventory-nav.component';
import { InventorySerialInputComponent, type InventorySerialSelection } from './inventory-serial-input.component';
import { loadInventorySerialsInStock } from './inventory-serial-units.util';

interface AllocationRow {
  compartmentId: string;
  label: string;
  available: number;
  quantity: number | null;
  /** Serial-tracked articles: the units taken from this compartment. */
  serialText: string;
  serials: InventorySerialSelection;
  availableSerials: string[] | null;
}

const NO_SERIALS: InventorySerialSelection = { serialNumbers: [], tokens: [], valid: true };
/** Thousandths, like the backend (quantities have three decimals). */
const milli = (value: number | null | undefined) => Math.round(Number(value ?? 0) * 1000);

/**
 * Withdrawal requests raised by offers, invoices and subscriptions. Nothing moves until an administrator accepts a
 * request here by picking the source compartments (one withdrawal document per compartment) — or rejects it.
 */
@Component({
  selector: 'framework-inventory-requests-page',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcKeyValueListComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    InventoryCompartmentSelectComponent,
    InventoryNavComponent,
    InventorySerialInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory-requests-page.component.html',
})
export class InventoryRequestsPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(InventoryFacade);
  private readonly service = inject(AdminInventoryService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureInventory-title:Inventory`;
  readonly requestsTitle = $localize`:@@featureInventoryNav-requests:Requests`;
  readonly acceptLabel = $localize`:@@featureInventoryRequests-accept:Accept`;
  readonly rejectLabel = $localize`:@@featureInventoryRequests-reject:Reject`;

  readonly requests = toSignal(this.facade.requests$, { requireSync: true });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null });
  /** Applied status filter (pending requests are the default inbox); the draft lives in the filter panel. */
  readonly status = signal<InventoryWithdrawalRequestStatus | 'all'>('pending');
  readonly filtersOpen = signal(false);
  statusDraft: InventoryWithdrawalRequestStatus | 'all' = 'pending';

  readonly paging = dbServerPaging(
    (query) =>
      this.facade.loadRequests({
        ...query,
        status: this.status() === 'all' ? null : (this.status() as InventoryWithdrawalRequestStatus),
      }),
    { url: 'rq-', filters: () => this.status() },
  );

  readonly columns: FpcTableColumn<InventoryWithdrawalRequest>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInventory-colState:State`,
      type: 'state',
      state: (row) => inventoryRequestState(row.status),
    },
    {
      id: 'source',
      label: $localize`:@@featureInventoryRequests-colSource:Source`,
      value: (row) => row.sourceLabel,
      required: true,
    },
    {
      id: 'customer',
      label: $localize`:@@featureInventoryRequests-colCustomer:Customer`,
      value: (row) => row.customerEmail ?? '',
      priority: 2,
    },
    {
      id: 'article',
      label: $localize`:@@featureInventory-colArticle:Article`,
      value: (row) => row.article.name,
      priority: 1,
    },
    {
      id: 'quantity',
      label: $localize`:@@featureInventory-colQuantity:Quantity`,
      value: (row) => formatInventoryQuantity(row.quantity, row.article.unit),
      align: 'end',
    },
    {
      id: 'available',
      label: $localize`:@@featureInventory-onHand:On hand`,
      value: (row) => formatInventoryQuantity(row.availableQuantity, row.article.unit),
      align: 'end',
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@featureInventoryRequests-colCreated:Requested`,
      value: (row) => formatBillingDateTime(row.createdAt),
      priority: 3,
    },
  ];

  readonly rowMenu = (row: InventoryWithdrawalRequest): FpcMenuItem[] => [
    ...(row.status === 'pending'
      ? [
          { id: 'accept', label: this.acceptLabel, icon: 'check-lg' },
          { id: 'reject', label: this.rejectLabel, icon: 'x-lg', danger: true },
        ]
      : [
          {
            id: 'documents',
            label: $localize`:@@featureInventoryRequests-documents:Documents`,
            icon: 'file-earmark-text',
          },
        ]),
    {
      id: 'article',
      label: $localize`:@@featureInventory-openArticle:Open article`,
      icon: 'box-seam',
      dividerBefore: true,
    },
    dbCopyIdItem(),
  ];

  // ---- Accept / reject ----

  readonly acceptOpen = signal(false);
  readonly rejectOpen = signal(false);
  readonly current = signal<InventoryWithdrawalRequest | null>(null);
  readonly allocations = signal<AllocationRow[]>([]);
  readonly sources = signal<InventoryStock[]>([]);
  readonly sourcesTotal = signal(0);
  readonly sourcesPage = signal(1);
  readonly sourcesPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly sourcesLoading = signal(false);
  readonly extraCompartment = signal<InventoryCompartment | null>(null);
  note = '';

  /** Summary of the request in the accept / reject dialogs. */
  readonly requestItems = computed((): FpcKeyValueItem[] => {
    const request = this.current();

    if (!request) return [];

    return [
      {
        key: 'source',
        label: $localize`:@@featureInventoryRequests-colSource:Source`,
        value: request.sourceLabel,
        hint: INVENTORY_REQUEST_SOURCE_LABELS[request.sourceType],
      },
      {
        key: 'customer',
        label: $localize`:@@featureInventoryRequests-colCustomer:Customer`,
        value: request.customerEmail ?? '—',
      },
      {
        key: 'article',
        label: $localize`:@@featureInventory-colArticle:Article`,
        value: request.article.name,
        hint: request.article.articleNumber,
      },
      {
        key: 'quantity',
        label: $localize`:@@featureInventory-colQuantity:Quantity`,
        value: formatInventoryQuantity(request.quantity, request.article.unit),
      },
    ];
  });

  readonly unitLabelOf = inventoryUnitLabel;
  readonly serialTracking = computed(() => this.current()?.article.serialTracking === true);
  /** Quantity of an allocation (serial-tracked: its serial count). */
  allocationQuantity(row: AllocationRow): number {
    return this.serialTracking() ? row.serials.serialNumbers.length : Number(row.quantity ?? 0);
  }
  readonly allocatedMilli = computed(() =>
    this.allocations().reduce((sum, row) => sum + milli(this.allocationQuantity(row)), 0),
  );
  readonly requestedMilli = computed(() => milli(this.current()?.quantity));
  readonly remaining = computed(() => (this.requestedMilli() - this.allocatedMilli()) / 1000);
  readonly allocationValid = computed(
    () =>
      this.allocatedMilli() === this.requestedMilli() &&
      this.allocations().every(
        (row) =>
          milli(this.allocationQuantity(row)) > 0 &&
          milli(this.allocationQuantity(row)) <= milli(row.available) &&
          (!this.serialTracking() || row.serials.valid),
      ),
  );

  readonly sourceColumns: FpcTableColumn<InventoryStock>[] = [
    {
      id: 'location',
      label: $localize`:@@featureInventory-location:Location`,
      value: (row) => `${row.warehouse.code} / ${row.compartment.code}`,
      required: true,
      mono: true,
    },
    {
      id: 'warehouse',
      label: $localize`:@@featureInventory-colWarehouse:Warehouse`,
      value: (row) => row.warehouse.name,
      priority: 2,
    },
    {
      id: 'available',
      label: $localize`:@@featureInventory-onHand:On hand`,
      value: (row) => formatInventoryQuantity(row.quantity, row.article.unit),
      align: 'end',
    },
  ];

  constructor() {
    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.acceptOpen,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.rejectOpen,
      destroyRef: this.destroyRef,
    });
    effect(() => {
      const request = this.current();
      const open = this.acceptOpen();
      const page = this.sourcesPage();
      const pageSize = this.sourcesPageSize();

      if (!open || !request) return;

      untracked(() => this.loadSources(request.article.id, page, pageSize));
    });
  }

  ngOnInit(): void {
    this.facade.loadSummary();
    this.facade.connectLive();
  }

  ngOnDestroy(): void {
    this.facade.disconnectLive();
  }

  applyFilters(): void {
    this.status.set(this.statusDraft);
    this.filtersOpen.set(false);
  }

  clearFilters(): void {
    this.statusDraft = 'all';
    this.status.set('all');
  }

  sourceTypeLabel(row: InventoryWithdrawalRequest): string {
    return INVENTORY_REQUEST_SOURCE_LABELS[row.sourceType];
  }

  onRowAction(row: InventoryWithdrawalRequest, action: string): void {
    switch (action) {
      case 'accept':
        this.openAccept(row);
        break;
      case 'reject':
        this.openReject(row);
        break;
      case 'documents':
        void this.router.navigate(['/administration/inventory/documents'], { queryParams: { request: row.id } });
        break;
      case 'article':
        void this.router.navigate(['/administration/inventory/articles', row.article.id]);
        break;
      case 'copy-id':
        fpcCopyText(row.id);
        break;
    }
  }

  onRowActivate(row: InventoryWithdrawalRequest): void {
    if (row.status === 'pending') this.openAccept(row);
  }

  openAccept(row: InventoryWithdrawalRequest): void {
    this.facade.clearError();
    this.current.set(row);
    this.allocations.set([]);
    this.extraCompartment.set(null);
    this.note = '';
    this.sourcesPage.set(1);
    showBillingModal(this.acceptOpen);
  }

  openReject(row: InventoryWithdrawalRequest): void {
    this.facade.clearError();
    this.current.set(row);
    this.note = '';
    showBillingModal(this.rejectOpen);
  }

  private loadSources(articleId: string, page: number, pageSize: number): void {
    this.sourcesLoading.set(true);
    this.service
      .listArticleStock(articleId, { withStockOnly: true, limit: pageSize, offset: (page - 1) * pageSize })
      .pipe(
        catchError(() => of({ items: [] as InventoryStock[], total: 0 })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.sources.set(response.items);
        this.sourcesTotal.set(response.total);
        this.sourcesLoading.set(false);
      });
  }

  /** Adds a suggested source with as much of the open quantity as it holds. */
  addSource(row: InventoryStock): void {
    if (this.allocations().some((allocation) => allocation.compartmentId === row.compartment.id)) return;

    const take = Math.min(Math.max(this.remaining(), 0), row.quantity);
    const serialTracking = this.serialTracking();

    this.allocations.update((rows) => [
      ...rows,
      {
        compartmentId: row.compartment.id,
        label: `${row.warehouse.code} / ${row.compartment.code}`,
        available: row.quantity,
        quantity: !serialTracking && take > 0 ? take : null,
        serialText: '',
        serials: NO_SERIALS,
        availableSerials: serialTracking ? [] : null,
      },
    ]);

    if (serialTracking) {
      loadInventorySerialsInStock(this.service, row.article.id, row.compartment.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((serials) =>
          this.allocations.update((rows) =>
            rows.map((entry) =>
              entry.compartmentId === row.compartment.id ? { ...entry, availableSerials: serials } : entry,
            ),
          ),
        );
    }
  }

  /** A compartment found by search (its stock is checked by the server). */
  addExtraCompartment(compartment: InventoryCompartment | null): void {
    if (!compartment || this.allocations().some((row) => row.compartmentId === compartment.id)) return;

    const request = this.current();

    this.service
      .listArticleStock(request!.article.id, { search: compartment.code, withStockOnly: true, limit: 100 })
      .pipe(
        catchError(() => of({ items: [] as InventoryStock[], total: 0 })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        const stock = response.items.find((item) => item.compartment.id === compartment.id);

        if (stock) {
          this.addSource(stock);
        } else {
          this.facade.clearError();
          this.missingStock.set(`${compartment.warehouseCode} / ${compartment.code}`);
        }

        this.extraCompartment.set(null);
      });
  }

  readonly missingStock = signal<string | null>(null);

  setQuantity(index: number, value: number | null): void {
    this.allocations.update((rows) => rows.map((row, i) => (i === index ? { ...row, quantity: value } : row)));
  }

  setSerialText(index: number, serialText: string): void {
    this.allocations.update((rows) => rows.map((row, i) => (i === index ? { ...row, serialText } : row)));
  }

  setSerials(index: number, serials: InventorySerialSelection): void {
    this.allocations.update((rows) => rows.map((row, i) => (i === index ? { ...row, serials } : row)));
  }

  removeAllocation(index: number): void {
    this.allocations.update((rows) => rows.filter((_, i) => i !== index));
  }

  formatQuantity(value: number): string {
    return formatInventoryQuantity(value, this.current()?.article.unit);
  }

  submitAccept(): void {
    const request = this.current();

    if (!request || !this.allocationValid()) return;

    this.facade.mutate({
      kind: 'acceptRequest',
      id: request.id,
      allocations: this.allocations().map((row) => ({
        compartmentId: row.compartmentId,
        quantity: this.allocationQuantity(row),
        ...(this.serialTracking() ? { serialNumbers: row.serials.tokens } : {}),
      })),
      note: this.note.trim() || null,
    });
  }

  submitReject(): void {
    const request = this.current();

    if (request) this.facade.mutate({ kind: 'rejectRequest', id: request.id, note: this.note.trim() || null });
  }
}
