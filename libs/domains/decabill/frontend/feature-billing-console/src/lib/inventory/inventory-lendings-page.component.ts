import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AdminInventoryService,
  InventoryFacade,
  type InventoryArticle,
  type InventoryLending,
  type InventoryLendingFilters,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { compressSerialNumbers } from '@forepath/shared/shared/util-barcode';
import { forkJoin } from 'rxjs';

import { formatBillingDate, formatBillingDateTime } from '../billing-format';
import { showBillingModal } from '../billing-modal';
import { dbCopyIdItem } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';

import { InventoryArticleSelectComponent } from './inventory-article-select.component';
import {
  formatInventoryQuantity,
  INVENTORY_BORROWER_KIND_LABELS,
  inventoryLendingState,
  saveInventoryBlob,
} from './inventory-labels';
import { InventoryLendingReturnDialogComponent } from './inventory-lending-return-dialog.component';
import { InventoryMoveDialogComponent, type InventoryMoveArticle } from './inventory-move-dialog.component';
import { InventoryNavComponent } from './inventory-nav.component';

type LendingStatusFilter = 'open' | 'overdue' | 'returned' | 'all';

/**
 * Stock on loan to customers and staff: open lendings first (by due date, overdue flagged), returned ones on demand.
 * A lending is returned (fully or in parts) from here; each return books a document.
 */
@Component({
  selector: 'framework-inventory-lendings-page',
  standalone: true,
  imports: [
    FormsModule,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    InventoryArticleSelectComponent,
    InventoryLendingReturnDialogComponent,
    InventoryMoveDialogComponent,
    InventoryNavComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border-top d-flex flex-column flex-grow-1 min-h-0" data-testid="inventory-lendings-page">
      <fpc-page-header [title]="pageTitle" />
      <framework-inventory-nav active="lendings" />
      <fpc-data-table
        class="flex-grow-1 min-h-0"
        [ariaLabel]="lendingsTitle"
        [columns]="columns"
        [rows]="lendings().items"
        paging="server"
        [total]="lendings().total"
        [(page)]="paging.page"
        [(pageSize)]="paging.pageSize"
        persistKey="decabill-inventory-lendings"
        [(query)]="paging.search"
        i18n-searchPlaceholder="@@featureInventoryLendings-search"
        searchPlaceholder="Search borrower, article, serial number"
        showFilterButton
        [(filtersOpen)]="filtersOpen"
        [filtersActive]="status() === 'open' ? 0 : 1"
        (filtersApplied)="applyFilters()"
        (filtersCleared)="clearFilters()"
        [loading]="lendings().loading"
        refreshable
        (refresh)="paging.reload()"
        [error]="lendings().error"
        [rowMenu]="rowMenu"
        (rowAction)="onRowAction($event.row, $event.item.id)"
        (rowActivate)="openReturn($event)"
        emptyIcon="person-up"
        data-testid="inventory-lendings-table"
      >
        <fpc-button
          fpcDataTableToolbar
          variant="primary"
          iconOnly
          [title]="newLendingLabel"
          [ariaLabel]="newLendingLabel"
          (clicked)="openNewLending()"
          data-testid="inventory-add-lending"
        >
          <i class="bi bi-plus-lg" aria-hidden="true"></i>
        </fpc-button>
        <fpc-form-field
          fpcDataTableFilters
          forId="inventoryLendingStatusFilter"
          i18n-label="@@featureInventoryRequests-statusFilter"
          label="Status"
        >
          <fpc-form-control
            controlType="select"
            controlId="inventoryLendingStatusFilter"
            [(ngModel)]="statusDraft"
            name="inventoryLendingStatusFilter"
            data-testid="inventory-lendings-status-filter"
          >
            <option value="open" i18n="@@featureInventory-lendingOpen">On loan</option>
            <option value="overdue" i18n="@@featureInventory-lendingOverdue">Overdue</option>
            <option value="returned" i18n="@@featureInventory-lendingReturned">Returned</option>
            <option value="all" i18n="@@featureInventoryRequests-all">All</option>
          </fpc-form-control>
        </fpc-form-field>
        <ng-template fpcTableCell="article" let-row
          >{{ row.article.name
          }}<span class="ms-2 small text-body-secondary font-monospace">{{
            row.article.articleNumber
          }}</span></ng-template
        >
        <ng-template fpcTableCell="borrower" let-row
          >{{ row.borrower.name
          }}<span class="ms-2 small text-body-secondary">{{ borrowerKindLabel(row) }}</span></ng-template
        >
        <ng-template fpcTableCell="serials" let-row
          ><span class="font-monospace small">{{ serialsOf(row) }}</span></ng-template
        >
        <span fpcDataTableEmpty>
          <fpc-empty-state
            size="sm"
            icon="person-up"
            i18n-message="@@featureInventoryLendings-empty"
            message="Nothing on loan"
          />
        </span>
      </fpc-data-table>
    </div>

    <framework-inventory-lending-return-dialog [(open)]="returnOpen" [lending]="returnLending()" />

    <!-- New lending: pick the article, then the lending dialog (source, borrower, due date, serial numbers). -->
    <fpc-modal [(open)]="pickArticleOpen" [title]="newLendingLabel" data-testid="inventory-new-lending-modal">
      <fpc-form-field forId="inventoryLendArticle" i18n-label="@@featureInventory-colArticle" label="Article" required>
        <framework-inventory-article-select
          inputId="inventoryLendArticle"
          [(selectedArticleId)]="pickedArticleId"
          (articlePicked)="pickedArticle.set($event)"
        />
      </fpc-form-field>
      <div *fpcModalFooter class="d-flex justify-content-end gap-2">
        <fpc-button
          variant="primary"
          [disabled]="!pickedArticle()"
          (clicked)="continueNewLending()"
          data-testid="inventory-new-lending-continue"
          i18n="@@featureInventoryLendings-continue"
          >Continue</fpc-button
        >
      </div>
    </fpc-modal>

    <framework-inventory-move-dialog [(open)]="lendOpen" mode="lending" [article]="lendArticle()" />
  `,
})
export class InventoryLendingsPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(InventoryFacade);
  private readonly service = inject(AdminInventoryService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureInventory-title:Inventory`;
  readonly lendingsTitle = $localize`:@@featureInventoryNav-lendings:Lendings`;
  readonly borrowerKindLabels = INVENTORY_BORROWER_KIND_LABELS;

  readonly lendings = toSignal(this.facade.lendings$, { requireSync: true });
  readonly status = signal<LendingStatusFilter>('open');
  readonly filtersOpen = signal(false);
  statusDraft: LendingStatusFilter = 'open';
  readonly returnOpen = signal(false);
  readonly returnLending = signal<InventoryLending | null>(null);
  readonly newLendingLabel = $localize`:@@featureInventoryLendings-new:New lending`;
  readonly pickArticleOpen = signal(false);
  pickedArticleId: string | null = null;
  readonly pickedArticle = signal<InventoryArticle | null>(null);
  readonly lendOpen = signal(false);
  readonly lendArticle = signal<InventoryMoveArticle | null>(null);

  readonly paging = dbServerPaging(
    (query) => this.facade.loadLendings({ ...query, filters: this.filtersFor(this.status()) }),
    { url: 'lnd-', filters: () => [this.status()] },
  );

  readonly columns: FpcTableColumn<InventoryLending>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInventory-colState:State`,
      type: 'state',
      state: (row) => inventoryLendingState(row),
    },
    {
      id: 'number',
      label: $localize`:@@featureInventory-colDocument:Document`,
      value: (row) => row.documentNumber ?? '',
      required: true,
      mono: true,
    },
    {
      id: 'article',
      label: $localize`:@@featureInventory-colArticle:Article`,
      value: (row) => row.article.name,
      priority: 1,
    },
    {
      id: 'borrower',
      label: $localize`:@@featureInventoryLend-borrower:Borrower`,
      value: (row) => row.borrower.name,
      priority: 1,
    },
    {
      id: 'serials',
      label: $localize`:@@featureInventoryMove-serials:Serial numbers`,
      value: (row) => this.serialsOf(row),
      priority: 2,
    },
    {
      id: 'quantity',
      label: $localize`:@@featureInventoryLendings-outstanding:On loan`,
      value: (row) => formatInventoryQuantity(row.outstandingQuantity, row.article.unit),
      align: 'end',
    },
    {
      id: 'due',
      label: $localize`:@@featureInventoryLend-dueDate:Due back`,
      value: (row) => (row.dueDate ? formatBillingDate(row.dueDate) : ''),
      priority: 2,
    },
    {
      id: 'lent',
      label: $localize`:@@featureInventoryLendings-lentAt:Lent`,
      value: (row) => formatBillingDateTime(row.createdAt),
      priority: 3,
    },
  ];

  readonly rowMenu = (row: InventoryLending): FpcMenuItem[] => [
    {
      id: 'return',
      label: $localize`:@@featureInventoryReturn-title:Return lending`,
      icon: 'person-down',
      disabled: row.status !== 'open',
    },
    { id: 'pdf', label: $localize`:@@featureInventoryLendings-documents:Download documents`, icon: 'file-earmark-pdf' },
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

  private filtersFor(status: LendingStatusFilter): InventoryLendingFilters {
    switch (status) {
      case 'open':
        return { status: 'open' };
      case 'overdue':
        return { overdue: true };
      case 'returned':
        return { status: 'returned' };
      default:
        return {};
    }
  }

  borrowerKindLabel(row: InventoryLending): string {
    return this.borrowerKindLabels[row.borrower.kind];
  }

  serialsOf(row: InventoryLending): string {
    const tokens = compressSerialNumbers(row.outstandingSerialNumbers);

    return tokens.length > 3 ? `${tokens.slice(0, 3).join(', ')}, …` : tokens.join(', ');
  }

  applyFilters(): void {
    this.status.set(this.statusDraft);
    this.filtersOpen.set(false);
  }

  clearFilters(): void {
    this.statusDraft = 'open';
    this.status.set('open');
  }

  openNewLending(): void {
    this.pickedArticleId = null;
    this.pickedArticle.set(null);
    showBillingModal(this.pickArticleOpen);
  }

  continueNewLending(): void {
    const article = this.pickedArticle();

    if (!article) return;

    this.pickArticleOpen.set(false);
    this.facade.clearError();
    this.lendArticle.set({
      id: article.id,
      articleNumber: article.articleNumber,
      name: article.name,
      unit: article.unit,
      serialTracking: article.serialTracking,
    });
    showBillingModal(this.lendOpen);
  }

  openReturn(row: InventoryLending): void {
    if (row.status !== 'open') return;

    this.facade.clearError();
    this.returnLending.set(row);
    showBillingModal(this.returnOpen);
  }

  onRowAction(row: InventoryLending, action: string): void {
    switch (action) {
      case 'return':
        this.openReturn(row);
        break;
      case 'pdf':
        this.downloadDocuments(row);
        break;
      case 'article':
        void this.router.navigate(['/administration/inventory/articles', row.article.id]);
        break;
      case 'copy-id':
        fpcCopyText(row.id);
        break;
    }
  }

  /** The lending document and its return documents. */
  private downloadDocuments(row: InventoryLending): void {
    this.service
      .listMovements({ lendingId: row.id, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((movements) => {
        if (movements.items.length === 0) return;

        forkJoin(movements.items.map((movement) => this.service.downloadMovementPdf(movement.id)))
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((blobs) =>
            blobs.forEach((blob, index) => saveInventoryBlob(blob, `${movements.items[index]!.documentNumber}.pdf`)),
          );
      });
  }
}
