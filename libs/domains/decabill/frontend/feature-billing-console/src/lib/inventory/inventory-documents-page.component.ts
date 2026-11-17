import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminInventoryService,
  InventoryFacade,
  type InventoryMovement,
  type InventoryMovementType,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcTableCellDirective,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { formatBillingDateTime } from '../billing-format';
import { dbCopyIdItem } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';

import {
  formatInventoryQuantity,
  INVENTORY_REASON_LABELS,
  inventoryMovementState,
  saveInventoryBlob,
} from './inventory-labels';
import { InventoryNavComponent } from './inventory-nav.component';
import { InventoryRouteCellComponent } from './inventory-route-cell.component';

/**
 * Numbered movement documents (PUT- / TRF- / WDR- / LND- / RTN-). The PDFs are archived and signed in the File Explorer under
 * `inventory/documents`; this list downloads them directly.
 */
@Component({
  selector: 'framework-inventory-documents-page',
  standalone: true,
  imports: [
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FormsModule,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    InventoryNavComponent,
    InventoryRouteCellComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border-top d-flex flex-column flex-grow-1 min-h-0" data-testid="inventory-documents-page">
      <fpc-page-header [title]="pageTitle" />
      <framework-inventory-nav active="documents" />
      @if (requestId()) {
        <fpc-alert
          [flush]="true"
          variant="info"
          [dismissible]="true"
          (closed)="clearRequestFilter()"
          i18n-message="@@featureInventoryDocuments-requestFilter"
          message="Showing the documents of one withdrawal request."
        />
      }
      <fpc-data-table
        class="flex-grow-1 min-h-0"
        [ariaLabel]="documentsTitle"
        [columns]="columns"
        [rows]="movements().items"
        paging="server"
        [total]="movements().total"
        [(page)]="paging.page"
        [(pageSize)]="paging.pageSize"
        persistKey="decabill-inventory-documents"
        [(query)]="paging.search"
        i18n-searchPlaceholder="@@featureInventoryDocuments-searchSerials"
        searchPlaceholder="Search number, article, serial number, reference"
        showFilterButton
        [(filtersOpen)]="filtersOpen"
        [filtersActive]="type() === 'all' ? 0 : 1"
        (filtersApplied)="applyFilters()"
        (filtersCleared)="clearFilters()"
        [loading]="movements().loading"
        refreshable
        (refresh)="paging.reload()"
        [error]="movements().error"
        [rowMenu]="rowMenu"
        (rowAction)="onRowAction($event.row, $event.item.id)"
        (rowActivate)="download($event)"
        emptyIcon="file-earmark-text"
        data-testid="inventory-documents-table"
      >
        <fpc-form-field
          fpcDataTableFilters
          forId="inventoryDocumentTypeFilter"
          i18n-label="@@featureInventoryDocuments-typeFilter"
          label="Type"
        >
          <fpc-form-control
            controlType="select"
            controlId="inventoryDocumentTypeFilter"
            [(ngModel)]="typeDraft"
            name="inventoryDocumentTypeFilter"
            data-testid="inventory-documents-type-filter"
          >
            <option value="all" i18n="@@featureInventoryRequests-all">All</option>
            <option value="putaway" i18n="@@featureInventory-typePutaway">Putaway</option>
            <option value="transfer" i18n="@@featureInventory-typeTransfer">Transfer</option>
            <option value="withdrawal" i18n="@@featureInventory-typeWithdrawal">Withdrawal</option>
            <option value="lending" i18n="@@featureInventory-typeLending">Lending</option>
            <option value="lending_return" i18n="@@featureInventory-typeLendingReturn">Lending return</option>
          </fpc-form-control>
        </fpc-form-field>
        <ng-template fpcTableCell="route" let-row>
          <framework-inventory-route-cell [source]="row.source" [target]="row.target" />
        </ng-template>
        <ng-template fpcTableCell="article" let-row
          >{{ row.articleName
          }}<span class="ms-2 small text-body-secondary font-monospace">{{ row.articleNumber }}</span></ng-template
        >
        <span fpcDataTableEmpty>
          <fpc-empty-state
            size="sm"
            icon="file-earmark-text"
            i18n-message="@@featureInventoryDocuments-empty"
            message="No documents yet"
          />
        </span>
      </fpc-data-table>
    </div>
  `,
})
export class InventoryDocumentsPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(InventoryFacade);
  private readonly service = inject(AdminInventoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureInventory-title:Inventory`;
  readonly documentsTitle = $localize`:@@featureInventoryNav-documents:Documents`;

  readonly movements = toSignal(this.facade.movements$, { requireSync: true });
  readonly type = signal<InventoryMovementType | 'all'>('all');
  readonly filtersOpen = signal(false);
  typeDraft: InventoryMovementType | 'all' = 'all';
  readonly requestId = signal<string | null>(this.route.snapshot.queryParamMap.get('request'));

  readonly paging = dbServerPaging(
    (query) =>
      this.facade.loadMovements({
        ...query,
        filters: {
          ...(this.type() !== 'all' ? { type: this.type() as InventoryMovementType } : {}),
          ...(this.requestId() ? { requestId: this.requestId()! } : {}),
        },
      }),
    { url: 'doc-', filters: () => [this.type(), this.requestId()] },
  );

  readonly columns: FpcTableColumn<InventoryMovement>[] = [
    {
      id: 'type',
      label: $localize`:@@featureInventory-colType:Type`,
      type: 'state',
      state: (row) => inventoryMovementState(row.type),
    },
    {
      id: 'number',
      label: $localize`:@@featureInventory-colDocument:Document`,
      value: (row) => row.documentNumber,
      required: true,
      mono: true,
    },
    {
      id: 'article',
      label: $localize`:@@featureInventory-colArticle:Article`,
      value: (row) => row.articleName,
      priority: 1,
    },
    {
      id: 'route',
      label: $localize`:@@featureInventoryDocuments-route:From → To`,
      value: (row) =>
        [row.source, row.target]
          .map((side) => (side ? `${side.warehouseCode} / ${side.compartmentCode}` : ''))
          .join(' '),
      priority: 2,
    },
    {
      id: 'quantity',
      label: $localize`:@@featureInventory-colQuantity:Quantity`,
      value: (row) => formatInventoryQuantity(row.quantity, row.unit),
      align: 'end',
    },
    {
      id: 'reason',
      label: $localize`:@@featureInventoryMove-reason:Reason`,
      value: (row) => (row.reason ? INVENTORY_REASON_LABELS[row.reason] : ''),
      priority: 3,
    },
    {
      id: 'by',
      label: $localize`:@@featureInventoryDocuments-by:By`,
      value: (row) => row.performedByEmail ?? '',
      priority: 3,
    },
    {
      id: 'date',
      label: $localize`:@@featureInventory-colDate:Date`,
      value: (row) => formatBillingDateTime(row.createdAt),
      priority: 2,
    },
  ];

  readonly rowMenu = (): FpcMenuItem[] => [
    { id: 'pdf', label: $localize`:@@featureInventory-downloadDocument:Download document`, icon: 'file-earmark-pdf' },
    { id: 'article', label: $localize`:@@featureInventory-openArticle:Open article`, icon: 'box-seam' },
    dbCopyIdItem(),
  ];

  ngOnInit(): void {
    this.facade.loadSummary();
    this.facade.connectLive();
  }

  ngOnDestroy(): void {
    this.facade.disconnectLive();
  }

  applyFilters(): void {
    this.type.set(this.typeDraft);
    this.filtersOpen.set(false);
  }

  clearFilters(): void {
    this.typeDraft = 'all';
    this.type.set('all');
  }

  clearRequestFilter(): void {
    this.requestId.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { request: null },
      queryParamsHandling: 'merge',
    });
  }

  onRowAction(row: InventoryMovement, action: string): void {
    if (action === 'pdf') this.download(row);
    else if (action === 'article') void this.router.navigate(['/administration/inventory/articles', row.articleId]);
    else if (action === 'copy-id') fpcCopyText(row.id);
  }

  download(row: InventoryMovement): void {
    this.service
      .downloadMovementPdf(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => saveInventoryBlob(blob, `${row.documentNumber}.pdf`));
  }
}
