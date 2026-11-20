import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InventoryFacade, type InventoryArticle } from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormSwitchComponent,
  FpcPageHeaderComponent,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { showBillingModal } from '../billing-modal';
import { dbCopyIdItem, dbOpenItem, DB_DL_EDIT } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';

import { InventoryArticleFormComponent } from './inventory-article-form.component';
import { InventoryLabelPrintDialogComponent } from './inventory-label-print-dialog.component';
import {
  formatInventoryPrice,
  formatInventoryQuantity,
  inventoryActiveState,
  inventoryStockState,
} from './inventory-labels';
import { InventoryNavComponent } from './inventory-nav.component';

/** All articles (server-paged), filterable to low stock; opens the article detail. */
@Component({
  selector: 'framework-inventory-articles-page',
  standalone: true,
  imports: [
    FormsModule,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormSwitchComponent,
    FpcPageHeaderComponent,
    InventoryArticleFormComponent,
    InventoryLabelPrintDialogComponent,
    InventoryNavComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border-top d-flex flex-column flex-grow-1 min-h-0" data-testid="inventory-articles-page">
      <fpc-page-header [title]="pageTitle" />
      <framework-inventory-nav active="articles" />
      <fpc-data-table
        class="flex-grow-1 min-h-0"
        [ariaLabel]="articlesTitle"
        [columns]="columns"
        [rows]="articles().items"
        [rowLink]="articleLink"
        paging="server"
        [total]="articles().total"
        [(page)]="paging.page"
        [(pageSize)]="paging.pageSize"
        persistKey="decabill-inventory-articles"
        [(query)]="paging.search"
        i18n-searchPlaceholder="@@featureInventoryArticles-searchSerials"
        searchPlaceholder="Search number, name, EAN, MPN, serial number"
        selectable
        [(selected)]="selected"
        [loading]="articles().loading"
        refreshable
        (refresh)="paging.reload()"
        [error]="articles().error"
        [rowMenu]="rowMenu"
        (rowAction)="onRowAction($event.row, $event.item.id)"
        emptyIcon="box-seam"
        data-testid="inventory-articles-table"
      >
        <fpc-button
          fpcDataTableToolbar
          variant="primary"
          iconOnly
          [title]="addLabel"
          [ariaLabel]="addLabel"
          (clicked)="openForm(null)"
          data-testid="inventory-add-article-master"
        >
          <i class="bi bi-plus-lg" aria-hidden="true"></i>
        </fpc-button>
        <fpc-form-switch
          fpcDataTableToolbar
          class="ms-2"
          switchId="inventoryLowStockOnly"
          name="lowStockOnly"
          [ngModel]="lowStockOnly()"
          (ngModelChange)="lowStockOnly.set($event)"
          i18n-label="@@featureInventoryArticles-lowStockOnly"
          label="Low stock only"
          data-testid="inventory-low-stock-filter"
        />
        <fpc-button
          fpcDataTableBatch
          variant="secondary"
          iconOnly
          [title]="printLabelsLabel"
          [ariaLabel]="printLabelsLabel"
          (clicked)="openLabels()"
          data-testid="inventory-articles-print-labels"
        >
          <i class="bi bi-printer" aria-hidden="true"></i>
        </fpc-button>
        <span fpcDataTableEmpty>
          <fpc-empty-state
            size="sm"
            icon="box-seam"
            i18n-message="@@featureInventoryArticles-empty"
            message="No articles yet"
          />
        </span>
      </fpc-data-table>
    </div>

    <framework-inventory-article-form [(open)]="formOpen" [article]="editArticle()" />
    <framework-inventory-label-print-dialog
      [(open)]="labelOpen"
      [articleIds]="selected()"
      [defaultKinds]="['article_number', 'ean']"
    />
  `,
})
export class InventoryArticlesPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(InventoryFacade);
  private readonly router = inject(Router);

  readonly pageTitle = $localize`:@@featureInventory-title:Inventory`;
  readonly articlesTitle = $localize`:@@featureInventoryNav-articles:Articles`;
  readonly addLabel = $localize`:@@featureInventoryArticles-add:New article`;
  readonly printLabelsLabel = $localize`:@@featureInventoryLabels-title:Print labels`;
  /** Selected article ids (kept across pages for bulk label printing). */
  readonly selected = signal<readonly string[]>([]);
  readonly labelOpen = signal(false);

  readonly articles = toSignal(this.facade.articles$, { requireSync: true });
  readonly lowStockOnly = signal(false);
  readonly formOpen = signal(false);
  readonly editArticle = signal<InventoryArticle | null>(null);

  readonly paging = dbServerPaging(
    (query) => this.facade.loadArticles({ ...query, lowStockOnly: this.lowStockOnly() }),
    { url: '', filters: () => this.lowStockOnly() },
  );

  readonly columns: FpcTableColumn<InventoryArticle>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInventory-colState:State`,
      type: 'state',
      state: (row) =>
        row.isActive ? inventoryStockState(row.totalQuantity, row.reorderPoint) : inventoryActiveState(false),
    },
    {
      id: 'number',
      label: $localize`:@@featureInventory-articleNumber:Article number`,
      value: (row) => row.articleNumber,
      mono: true,
    },
    {
      id: 'name',
      label: $localize`:@@featureInventory-name:Name`,
      value: (row) => row.name,
      required: true,
      priority: 1,
    },
    { id: 'ean', label: 'EAN', value: (row) => row.ean ?? '', mono: true, priority: 3 },
    {
      id: 'stock',
      label: $localize`:@@featureInventory-onHand:On hand`,
      value: (row) => formatInventoryQuantity(row.totalQuantity, row.unit),
      align: 'end',
    },
    {
      id: 'requested',
      label: $localize`:@@featureInventoryArticles-requested:Requested`,
      value: (row) => (row.requestedQuantity > 0 ? formatInventoryQuantity(row.requestedQuantity, row.unit) : ''),
      align: 'end',
      priority: 3,
    },
    {
      id: 'locations',
      label: $localize`:@@featureInventoryArticles-locations:Locations`,
      value: (row) => row.locationCount,
      align: 'end',
      priority: 3,
    },
    {
      id: 'price',
      label: $localize`:@@featureInventoryArticleForm-salesPrice:Sales price`,
      value: (row) => formatInventoryPrice(row.salesPriceNet, row.currency),
      align: 'end',
      priority: 2,
    },
  ];

  readonly articleLink = (row: InventoryArticle): string => `/administration/inventory/articles/${row.id}`;
  readonly rowMenu = (): FpcMenuItem[] => [
    dbOpenItem(),
    { id: 'edit', label: DB_DL_EDIT, icon: 'pencil' },
    { id: 'labels', label: this.printLabelsLabel, icon: 'printer' },
    dbCopyIdItem(),
  ];
  readonly hasArticles = computed(() => this.articles().items.length > 0);

  ngOnInit(): void {
    this.facade.loadSummary();
    this.facade.connectLive();
  }

  ngOnDestroy(): void {
    this.facade.disconnectLive();
  }

  openForm(article: InventoryArticle | null): void {
    this.editArticle.set(article);
    showBillingModal(this.formOpen);
  }

  openLabels(): void {
    if (this.selected().length > 0) showBillingModal(this.labelOpen);
  }

  onRowAction(row: InventoryArticle, action: string): void {
    if (action === 'open') void this.router.navigateByUrl(this.articleLink(row));
    else if (action === 'edit') this.openForm(row);
    else if (action === 'labels') {
      this.selected.set([row.id]);
      this.openLabels();
    } else if (action === 'copy-id') fpcCopyText(row.id);
  }
}
