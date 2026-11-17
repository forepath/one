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
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AdminInventoryService,
  InventoryFacade,
  type InventoryCompartment,
  type InventoryLabelKind,
  type InventoryMovement,
  type InventorySerialUnit,
  type InventorySerialUnitStatus,
  type InventoryStock,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcTableCellDirective,
  FpcEmptyStateComponent,
  fpcCopyText,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcKeyValueDirective,
  FpcKeyValueListComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FPC_DEFAULT_PAGE_SIZE,
  type FpcKeyValueItem,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import { formatBillingDateTime } from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

import { InventoryArticleFormComponent } from './inventory-article-form.component';
import { InventoryBarcodeComponent } from './inventory-barcode.component';
import { InventoryCompartmentSelectComponent } from './inventory-compartment-select.component';
import { InventoryLabelPrintDialogComponent } from './inventory-label-print-dialog.component';
import {
  formatInventoryPrice,
  formatInventoryQuantity,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  INVENTORY_REASON_LABELS,
  inventoryMovementState,
  inventorySerialState,
  inventoryStockState,
  inventoryUnitLabel,
  saveInventoryBlob,
} from './inventory-labels';
import {
  InventoryMoveDialogComponent,
  type InventoryMoveLocation,
  type InventoryMoveMode,
} from './inventory-move-dialog.component';
import { InventoryPropertyStickerComponent } from './inventory-property-sticker.component';
import { InventoryRouteCellComponent } from './inventory-route-cell.component';

/** One article: master data and barcodes, its locations (map / move from here) and its movement documents. */
@Component({
  selector: 'framework-inventory-article-detail-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    InventoryArticleFormComponent,
    InventoryBarcodeComponent,
    InventoryPropertyStickerComponent,
    InventoryCompartmentSelectComponent,
    InventoryLabelPrintDialogComponent,
    InventoryMoveDialogComponent,
    InventoryRouteCellComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory-article-detail-page.component.html',
  styleUrls: ['./inventory-section.scss'],
})
export class InventoryArticleDetailPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(InventoryFacade);
  private readonly service = inject(AdminInventoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureInventory-title:Inventory`;
  readonly backLabel = $localize`:@@featureInventoryArticleDetail-backToArticles:Back to articles`;
  readonly articleNumberLabel = $localize`:@@featureInventory-articleNumber:Article number`;
  readonly detailsTitle = $localize`:@@featureInventoryArticleDetail-details:Details`;
  readonly editLabel = $localize`:@@featureDataList-edit:Edit`;
  readonly showLendingsLabel = $localize`:@@featureInventoryArticleDetail-showLendings:Show lendings`;
  readonly lendLabel = $localize`:@@featureInventory-typeLending:Lending`;
  readonly printLabelsLabel = $localize`:@@featureInventoryLabels-title:Print labels`;
  readonly serialsTitle = $localize`:@@featureInventoryMove-serials:Serial numbers`;
  readonly printSelectedLabel = $localize`:@@featureInventoryLabels-printSelected:Print labels for the selected serial numbers`;
  readonly locationsTitle = $localize`:@@featureInventoryArticles-locations:Locations`;
  readonly movementsTitle = $localize`:@@featureInventory-history:Movements`;
  readonly addLocationLabel = $localize`:@@featureInventoryArticleForm-addLocation:Add location`;
  readonly deleteLabel = $localize`:@@featureDataList-delete:Delete`;
  readonly movementTypeLabels = INVENTORY_MOVEMENT_TYPE_LABELS;

  readonly articleId = toSignal(this.route.paramMap.pipe(map((params) => params.get('articleId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('articleId') ?? '',
  });
  readonly article = toSignal(this.facade.selectedArticle$, { initialValue: null });
  readonly locations = toSignal(this.facade.articleStock$, { requireSync: true });
  readonly movements = toSignal(this.facade.movements$, { requireSync: true });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null });

  /** Bumped by a table's refresh button: its load effect runs again. */
  readonly locationReload = signal(0);
  readonly movementReload = signal(0);
  readonly locationSearch = signal('');
  readonly locationPage = signal(1);
  readonly locationPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly movementSearch = signal('');
  readonly movementPage = signal(1);
  readonly serialReload = signal(0);
  readonly serialSearch = signal('');
  readonly serialPage = signal(1);
  readonly serialPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly serialStatus = signal<InventorySerialUnitStatus | 'all'>('all');
  serialStatusDraft: InventorySerialUnitStatus | 'all' = 'all';
  readonly serialFiltersOpen = signal(false);
  readonly selectedSerials = signal<readonly string[]>([]);
  readonly serialUnits = toSignal(this.facade.serialUnits$, { requireSync: true });

  // Labels: the whole article, or the selected units.
  readonly labelOpen = signal(false);
  readonly labelArticleIds = signal<string[]>([]);
  readonly labelUnitIds = signal<string[]>([]);
  readonly labelKinds = signal<InventoryLabelKind[]>(['article_number']);
  readonly movementPageSize = signal(FPC_DEFAULT_PAGE_SIZE);

  readonly formOpen = signal(false);
  readonly moveOpen = signal(false);
  readonly moveMode = signal<InventoryMoveMode>('putaway');
  readonly moveSource = signal<InventoryMoveLocation | null>(null);
  readonly moveTarget = signal<InventoryMoveLocation | null>(null);
  readonly addLocationOpen = signal(false);
  readonly addLocationCompartment = signal<InventoryCompartment | null>(null);
  addLocationQuantity: number | null = null;
  readonly confirmOpen = signal(false);
  readonly confirmTarget = signal<{ kind: 'article' | 'placement'; id: string } | null>(null);

  readonly moveArticle = computed(() => {
    const article = this.article();

    return article && article.id === this.articleId()
      ? {
          id: article.id,
          articleNumber: article.articleNumber,
          name: article.name,
          unit: article.unit,
          serialTracking: article.serialTracking,
        }
      : null;
  });

  readonly unitLabelOf = inventoryUnitLabel;
  readonly lentLabel = computed(() => {
    const article = this.article();

    return article ? formatInventoryQuantity(article.lentQuantity, article.unit) : '';
  });

  readonly items = computed((): FpcKeyValueItem[] => {
    const article = this.article();

    if (!article) return [];

    const dims = [article.lengthCm, article.widthCm, article.heightCm];

    return [
      {
        key: 'number',
        label: $localize`:@@featureInventory-articleNumber:Article number`,
        value: article.articleNumber,
        mono: true,
      },
      { key: 'ean', label: 'EAN', value: article.ean ?? '—', mono: true },
      { key: 'unit', label: $localize`:@@featureInventory-unit:Unit`, value: inventoryUnitLabel(article.unit) },
      {
        key: 'stock',
        label: $localize`:@@featureInventory-onHand:On hand`,
        value: formatInventoryQuantity(article.totalQuantity, article.unit),
        hint:
          article.requestedQuantity > 0
            ? $localize`:@@featureInventoryArticles-requestedHint:${formatInventoryQuantity(article.requestedQuantity, article.unit)}:quantity: requested`
            : null,
      },
      {
        key: 'lent',
        label: $localize`:@@featureInventoryLendings-outstanding:On loan`,
        value: formatInventoryQuantity(article.lentQuantity, article.unit),
      },
      {
        key: 'serialTracking',
        label: $localize`:@@featureInventoryArticleForm-serialTracking:Serial numbers`,
        value: article.serialTracking
          ? $localize`:@@featureInventoryArticleDetail-serialTracked:Required for every unit`
          : $localize`:@@featureInventoryArticleDetail-notSerialTracked:Not tracked`,
      },
      {
        key: 'purchase',
        label: $localize`:@@featureInventoryArticleForm-purchasePrice:Purchase price`,
        value: formatInventoryPrice(article.purchasePriceNet, article.currency),
      },
      {
        key: 'sales',
        label: $localize`:@@featureInventoryArticleForm-salesPrice:Sales price`,
        value: formatInventoryPrice(article.salesPriceNet, article.currency),
      },
      {
        key: 'reorder',
        label: $localize`:@@featureInventoryArticleForm-reorderPoint:Reorder point`,
        value: article.reorderPoint === null ? '—' : formatInventoryQuantity(article.reorderPoint, article.unit),
      },
      {
        key: 'reorderQuantity',
        label: $localize`:@@featureInventoryArticleForm-reorderQuantity:Reorder quantity`,
        value: article.reorderQuantity === null ? '—' : formatInventoryQuantity(article.reorderQuantity, article.unit),
      },
      {
        key: 'manufacturer',
        label: $localize`:@@featureInventoryArticleForm-manufacturer:Manufacturer`,
        value: article.manufacturer ?? '—',
      },
      {
        key: 'mpn',
        label: $localize`:@@featureInventoryArticleForm-mpn:Manufacturer part number`,
        value: article.manufacturerPartNumber ?? '—',
        mono: true,
      },
      {
        key: 'supplierNumber',
        label: $localize`:@@featureInventoryArticleForm-supplierNumber:Supplier article number`,
        value: article.supplierArticleNumber ?? '—',
      },
      {
        key: 'weight',
        label: $localize`:@@featureInventoryArticleForm-weight:Weight (kg)`,
        value: article.weightKg ?? '—',
      },
      {
        key: 'dimensions',
        label: $localize`:@@featureInventoryArticleDetail-dimensions:Dimensions (cm)`,
        value: dims.some((value) => value !== null) ? dims.map((value) => value ?? '?').join(' × ') : '—',
      },
      {
        key: 'hs',
        label: $localize`:@@featureInventoryArticleForm-hsCode:Customs tariff number (HS)`,
        value: article.hsCode ?? '—',
        mono: true,
      },
      {
        key: 'origin',
        label: $localize`:@@featureInventoryArticleForm-origin:Country of origin`,
        value: article.countryOfOrigin ?? '—',
      },
    ];
  });

  readonly locationColumns: FpcTableColumn<InventoryStock>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInventory-colState:State`,
      type: 'state',
      state: (row) => inventoryStockState(row.quantity, null),
    },
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
      id: 'quantity',
      label: $localize`:@@featureInventory-colQuantity:Quantity`,
      value: (row) => formatInventoryQuantity(row.quantity, row.article.unit),
      align: 'end',
    },
  ];

  readonly movementColumns: FpcTableColumn<InventoryMovement>[] = [
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
      id: 'date',
      label: $localize`:@@featureInventory-colDate:Date`,
      value: (row) => formatBillingDateTime(row.createdAt),
      priority: 2,
    },
  ];

  readonly locationMenu = (row: InventoryStock): FpcMenuItem[] => [
    {
      id: 'putaway',
      label: INVENTORY_MOVEMENT_TYPE_LABELS.putaway,
      icon: 'box-arrow-in-down',
      disabled: !row.compartment.isActive,
    },
    {
      id: 'transfer',
      label: INVENTORY_MOVEMENT_TYPE_LABELS.transfer,
      icon: 'arrow-left-right',
      disabled: row.quantity <= 0,
    },
    {
      id: 'withdrawal',
      label: INVENTORY_MOVEMENT_TYPE_LABELS.withdrawal,
      icon: 'box-arrow-up',
      disabled: row.quantity <= 0,
    },
    {
      id: 'lending',
      label: INVENTORY_MOVEMENT_TYPE_LABELS.lending,
      icon: 'person-up',
      disabled: row.quantity <= 0,
    },
    {
      id: 'open',
      label: $localize`:@@featureInventoryArticleDetail-openInWarehouse:Show in warehouse`,
      icon: 'building',
      dividerBefore: true,
    },
    {
      id: 'remove',
      label: $localize`:@@featureInventory-removeLocation:Remove location`,
      icon: 'trash',
      danger: true,
      disabled: row.quantity > 0,
    },
  ];
  readonly serialColumns: FpcTableColumn<InventorySerialUnit>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInventory-colState:State`,
      type: 'state',
      state: (row) => inventorySerialState(row.status),
    },
    {
      id: 'serial',
      label: $localize`:@@featureInventorySerials-serialNumber:Serial number`,
      value: (row) => row.serialNumber,
      required: true,
      mono: true,
    },
    {
      id: 'where',
      label: $localize`:@@featureInventorySerials-where:Location / borrower`,
      value: (row) =>
        row.location
          ? `${row.location.warehouseCode} / ${row.location.compartmentCode}`
          : (row.lending?.borrowerName ?? ''),
      priority: 1,
    },
    {
      id: 'due',
      label: $localize`:@@featureInventoryLend-dueDate:Due back`,
      value: (row) => row.lending?.dueDate ?? '',
      priority: 3,
    },
    {
      id: 'updated',
      label: $localize`:@@featureInventory-colLastChange:Last change`,
      value: (row) => formatBillingDateTime(row.updatedAt),
      priority: 2,
    },
  ];
  readonly serialMenu = (row: InventorySerialUnit): FpcMenuItem[] => [
    { id: 'history', label: $localize`:@@featureInventorySerials-history:Show movements`, icon: 'clock-history' },
    { id: 'labels', label: this.printLabelsLabel, icon: 'printer' },
    {
      id: 'lending',
      label: $localize`:@@featureInventorySerials-openLending:Open lending`,
      icon: 'person-up',
      disabled: !row.lending,
    },
    { id: 'copy', label: $localize`:@@featureInventorySerials-copy:Copy serial number`, icon: 'clipboard' },
  ];

  readonly movementMenu = (): FpcMenuItem[] => [
    { id: 'pdf', label: $localize`:@@featureInventory-downloadDocument:Download document`, icon: 'file-earmark-pdf' },
  ];

  constructor() {
    effect(() => {
      const articleId = this.articleId();

      untracked(() => {
        if (articleId) this.facade.loadArticle(articleId);
      });
    });
    effect(() => {
      const articleId = this.articleId();
      const page = this.locationPage();
      const pageSize = this.locationPageSize();
      const search = this.locationSearch();

      this.locationReload();

      untracked(() => {
        if (articleId) this.facade.loadArticleStock(articleId, { page, pageSize, search });
      });
    });
    effect(() => {
      const articleId = this.articleId();
      const page = this.movementPage();
      const pageSize = this.movementPageSize();
      const search = this.movementSearch();

      this.movementReload();

      untracked(() => {
        if (articleId) this.facade.loadMovements({ page, pageSize, search, filters: { articleId } });
      });
    });

    // Serial units of serial-tracked articles.
    effect(() => {
      const article = this.article();
      const page = this.serialPage();
      const pageSize = this.serialPageSize();
      const search = this.serialSearch();
      const status = this.serialStatus();

      this.serialReload();

      untracked(() => {
        if (article?.serialTracking && article.id === this.articleId()) {
          this.facade.loadSerialUnits(article.id, {
            page,
            pageSize,
            search,
            status: status === 'all' ? null : status,
          });
        }
      });
    });

    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.addLocationOpen,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.confirmOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        if (this.confirmTarget()?.kind === 'article')
          void this.router.navigateByUrl('/administration/inventory/articles');
      },
    });
  }

  ngOnInit(): void {
    this.facade.loadSummary();
    this.facade.connectLive();
  }

  ngOnDestroy(): void {
    this.facade.disconnectLive();
  }

  openEdit(): void {
    showBillingModal(this.formOpen);
  }

  location(row: InventoryStock): InventoryMoveLocation {
    return {
      compartmentId: row.compartment.id,
      compartmentCode: row.compartment.code,
      warehouseCode: row.warehouse.code,
      quantity: row.quantity,
    };
  }

  openMove(mode: InventoryMoveMode, source: InventoryMoveLocation | null, target: InventoryMoveLocation | null): void {
    this.moveMode.set(mode);
    this.moveSource.set(source);
    this.moveTarget.set(target);
    showBillingModal(this.moveOpen);
  }

  onLocationAction(row: InventoryStock, action: string): void {
    switch (action) {
      case 'putaway':
        this.openMove('putaway', null, this.location(row));
        break;
      case 'transfer':
      case 'withdrawal':
      case 'lending':
        this.openMove(action, this.location(row), null);
        break;
      case 'open':
        void this.router.navigate(['/administration/inventory'], {
          queryParams: { warehouse: row.warehouse.id, compartment: row.compartment.id, placement: row.id },
        });
        break;
      case 'remove':
        this.confirmTarget.set({ kind: 'placement', id: row.id });
        this.facade.clearError();
        showBillingModal(this.confirmOpen);
        break;
    }
  }

  openAddLocation(): void {
    this.facade.clearError();
    this.addLocationCompartment.set(null);
    this.addLocationQuantity = null;
    showBillingModal(this.addLocationOpen);
  }

  /** New location: 0 maps it, a quantity books new goods (putaway); "take from" opens a transfer into it. */
  submitAddLocation(): void {
    const article = this.article();
    const compartment = this.addLocationCompartment();
    const quantity = Number(this.addLocationQuantity ?? 0);

    if (!article || !compartment) return;

    if (quantity > 0 && article.serialTracking) {
      // Serial-tracked goods are put away with their serial numbers (putaway dialog).
      this.addLocationOpen.set(false);
      this.openMove('putaway', null, {
        compartmentId: compartment.id,
        compartmentCode: compartment.code,
        warehouseCode: compartment.warehouseCode,
      });

      return;
    }

    if (quantity > 0) {
      this.facade.mutate({
        kind: 'putaway',
        dto: { articleId: article.id, targetCompartmentId: compartment.id, quantity, reason: 'receipt' },
      });
    } else {
      this.facade.mutate({ kind: 'createPlacement', articleId: article.id, compartmentId: compartment.id });
    }
  }

  transferIntoNewLocation(): void {
    const compartment = this.addLocationCompartment();

    if (!compartment) return;

    this.addLocationOpen.set(false);
    this.openMove('transfer', null, {
      compartmentId: compartment.id,
      compartmentCode: compartment.code,
      warehouseCode: compartment.warehouseCode,
    });
  }

  askDeleteArticle(): void {
    const article = this.article();

    if (!article) return;

    this.facade.clearError();
    this.confirmTarget.set({ kind: 'article', id: article.id });
    showBillingModal(this.confirmOpen);
  }

  confirmMessage(): string {
    return this.confirmTarget()?.kind === 'article'
      ? $localize`:@@featureInventoryArticleDetail-deleteArticle:The article will be deleted. Articles with stock, movements or requests cannot be deleted; deactivate them instead.`
      : $localize`:@@featureInventoryArticleDetail-deleteLocation:The empty location will be removed from this article.`;
  }

  runConfirm(): void {
    const target = this.confirmTarget();

    if (!target) return;

    if (target.kind === 'article') this.facade.mutate({ kind: 'deleteArticle', id: target.id });
    else this.facade.mutate({ kind: 'deletePlacement', id: target.id });
  }

  openLabels(kinds: InventoryLabelKind[], unitIds: readonly string[] = []): void {
    const article = this.article();

    if (!article) return;

    this.labelKinds.set(kinds);
    this.labelArticleIds.set(unitIds.length > 0 ? [] : [article.id]);
    this.labelUnitIds.set([...unitIds]);
    showBillingModal(this.labelOpen);
  }

  applySerialFilters(): void {
    this.serialStatus.set(this.serialStatusDraft);
    this.serialFiltersOpen.set(false);
  }

  clearSerialFilters(): void {
    this.serialStatusDraft = 'all';
    this.serialStatus.set('all');
  }

  onSerialAction(row: InventorySerialUnit, action: string): void {
    switch (action) {
      case 'history':
        this.movementSearch.set(row.serialNumber);
        break;
      case 'labels':
        this.openLabels(['property'], [row.id]);
        break;
      case 'lending':
        void this.router.navigate(['/administration/inventory/lendings'], {
          queryParams: { 'lnd-q': row.lending?.documentNumber ?? row.serialNumber },
        });
        break;
      case 'copy':
        fpcCopyText(row.serialNumber);
        break;
    }
  }

  onMovementAction(row: InventoryMovement, action: string): void {
    if (action === 'pdf') this.download(row);
  }

  download(row: InventoryMovement): void {
    this.service
      .downloadMovementPdf(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => saveInventoryBlob(blob, `${row.documentNumber}.pdf`));
  }
}
