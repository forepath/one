import { CommonModule } from '@angular/common';
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
  type WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  AdminInventoryService,
  InventoryFacade,
  type InventoryArticle,
  type InventoryCompartment,
  type InventoryCompartmentInput,
  type InventoryMovement,
  type InventoryStock,
  type InventoryWarehouse,
  type InventoryWarehouseInput,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcTableCellDirective,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcFormSwitchComponent,
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
import { compressSerialNumbers } from '@forepath/shared/shared/util-barcode';
import { catchError, map, type Observable, of, type Subscription } from 'rxjs';

import { formatBillingDateTime } from '../billing-format';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { DB_DL_DELETE, DB_DL_EDIT, dbCopyIdItem } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';

import { InventoryArticleSelectComponent } from './inventory-article-select.component';
import { InventoryBarcodeComponent } from './inventory-barcode.component';
import {
  formatInventoryQuantity,
  inventoryUnitLabel,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  inventoryActiveState,
  inventoryMovementState,
  inventoryStockState,
  saveInventoryBlob,
} from './inventory-labels';
import {
  InventoryMoveDialogComponent,
  type InventoryMoveArticle,
  type InventoryMoveLocation,
  type InventoryMoveMode,
} from './inventory-move-dialog.component';
import { InventoryNavComponent } from './inventory-nav.component';
import { InventoryPropertyStickerComponent } from './inventory-property-sticker.component';
import { InventoryRouteCellComponent } from './inventory-route-cell.component';
import { loadInventorySerialsInStock } from './inventory-serial-units.util';

type WarehouseForm = Required<Omit<InventoryWarehouseInput, 'isActive'>> & { id: string | null; isActive: boolean };
type CompartmentForm = { id: string | null; code: string; name: string; description: string; isActive: boolean };

/**
 * Warehouse browser: Warehouses → Compartments → Contents → Placement detail, side by side (paged columns, like
 * Agenstra's workspace / environment rails). Selection lives in the URL (`?warehouse=&compartment=&placement=`), every
 * column is server-paged (replace-page) and patched live over the inventory socket.
 */
@Component({
  selector: 'framework-inventory-warehouses-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcFormSwitchComponent,
    FpcKeyValueListComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    InventoryArticleSelectComponent,
    InventoryBarcodeComponent,
    InventoryPropertyStickerComponent,
    InventoryMoveDialogComponent,
    InventoryNavComponent,
    InventoryRouteCellComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory-warehouses-page.component.html',
  styleUrls: ['./inventory-section.scss'],
})
export class InventoryWarehousesPageComponent implements OnInit, OnDestroy {
  readonly facade = inject(InventoryFacade);
  private readonly service = inject(AdminInventoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureInventory-title:Inventory`;
  readonly warehousesTitle = $localize`:@@featureInventory-warehouses:Warehouses`;
  readonly compartmentsTitle = $localize`:@@featureInventory-compartments:Compartments`;
  readonly contentsTitle = $localize`:@@featureInventory-contents:Contents`;
  readonly addWarehouseLabel = $localize`:@@featureInventory-addWarehouse:Add warehouse`;
  readonly addCompartmentLabel = $localize`:@@featureInventory-addCompartment:Add compartment`;
  readonly addArticleLabel = $localize`:@@featureInventory-addArticleToCompartment:Add article`;
  readonly backLabel = $localize`:@@featureInventory-back:Back`;
  readonly editWarehouseLabel = $localize`:@@featureInventory-editWarehouse:Edit warehouse`;
  readonly editCompartmentLabel = $localize`:@@featureInventory-editCompartment:Edit compartment`;
  readonly deleteLabel = DB_DL_DELETE;
  readonly placementTitle = $localize`:@@featureInventory-placementTitle:Article in compartment`;
  readonly movementsTitle = $localize`:@@featureInventory-history:Movements`;
  readonly openArticleLabel = $localize`:@@featureInventory-openArticle:Open article`;
  readonly unitLabelOf = inventoryUnitLabel;
  readonly lendLabel = $localize`:@@featureInventory-typeLending:Lending`;
  readonly removeLocationLabel = $localize`:@@featureInventory-removeLocation:Remove location`;

  // ---- Selection (URL) ----

  private readonly queryParams = toSignal(this.route.queryParamMap.pipe(map((params) => params)), {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly warehouseId = computed(() => this.queryParams().get('warehouse'));
  readonly compartmentId = computed(() => this.queryParams().get('compartment'));
  readonly placementId = computed(() => this.queryParams().get('placement'));

  // ---- Lists ----

  readonly warehouses = toSignal(this.facade.warehouses$, { requireSync: true });
  readonly compartments = toSignal(this.facade.compartments$, { requireSync: true });
  readonly contents = toSignal(this.facade.compartmentStock$, { requireSync: true });
  readonly mutating = toSignal(this.facade.mutating$, { initialValue: false });
  readonly mutationError = toSignal(this.facade.mutationError$, { initialValue: null });

  readonly warehousePaging = dbServerPaging((query) => this.facade.loadWarehouses(query), { url: 'wh-' });

  readonly compartmentSearch = signal('');
  readonly compartmentPage = signal(1);
  readonly compartmentPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  /** Bumped by a table's refresh button: its load effect runs again. */
  readonly compartmentReload = signal(0);
  readonly contentReload = signal(0);
  readonly placementMovementsReload = signal(0);
  readonly contentSearch = signal('');
  readonly contentPage = signal(1);
  readonly contentPageSize = signal(FPC_DEFAULT_PAGE_SIZE);

  /** Selected rows resolved even when they are not on the current page (deep links). */
  readonly selectedWarehouse = signal<InventoryWarehouse | null>(null);
  readonly selectedCompartment = signal<InventoryCompartment | null>(null);
  readonly selectedPlacement = signal<InventoryStock | null>(null);
  readonly placementMovements = signal<InventoryMovement[]>([]);
  readonly placementMovementsTotal = signal(0);
  readonly placementMovementsSearch = signal('');
  readonly placementMovementsPage = signal(1);
  readonly placementMovementsPageSize = signal(FPC_DEFAULT_PAGE_SIZE);
  readonly placementMovementsLoading = signal(false);
  /** Units in stock in the selected placement (serial-tracked articles). */
  readonly placementSerials = signal<string[]>([]);
  /** In-flight history request: a newer page / search replaces it (no out-of-order responses). */
  private placementMovementsRequest: Subscription | null = null;

  readonly activeColumn = computed(() =>
    this.placementId()
      ? 'placement'
      : this.compartmentId()
        ? 'contents'
        : this.warehouseId()
          ? 'compartments'
          : 'warehouses',
  );

  // ---- Columns ----

  readonly warehouseColumns: FpcTableColumn<InventoryWarehouse>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInventory-colState:State`,
      type: 'state',
      state: (row) => inventoryActiveState(row.isActive),
    },
    {
      id: 'code',
      label: $localize`:@@featureInventory-colWarehouse:Warehouse`,
      value: (row) => row.name,
      required: true,
    },
    {
      id: 'compartments',
      label: $localize`:@@featureInventory-colCompartments:Compartments`,
      value: (row) => row.compartmentCount,
      align: 'end',
      priority: 2,
    },
    {
      id: 'articles',
      label: $localize`:@@featureInventory-colArticles:Articles`,
      value: (row) => row.articleCount,
      align: 'end',
      priority: 3,
    },
  ];

  readonly compartmentColumns: FpcTableColumn<InventoryCompartment>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInventory-colState:State`,
      type: 'state',
      state: (row) =>
        row.isActive
          ? row.totalQuantity > 0
            ? { label: $localize`:@@featureInventory-compartmentFilled:In use`, tone: 'success', icon: 'box-seam' }
            : { label: $localize`:@@featureInventory-compartmentEmpty:Empty`, tone: 'neutral', icon: 'square' }
          : inventoryActiveState(false),
    },
    {
      id: 'code',
      label: $localize`:@@featureInventory-colCompartment:Compartment`,
      value: (row) => row.code,
      required: true,
    },
    {
      id: 'articles',
      label: $localize`:@@featureInventory-colArticles:Articles`,
      value: (row) => row.articleCount,
      align: 'end',
      priority: 2,
    },
  ];

  readonly contentColumns: FpcTableColumn<InventoryStock>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInventory-colState:State`,
      type: 'state',
      state: (row) => inventoryStockState(row.quantity, row.article.reorderPoint),
    },
    {
      id: 'article',
      label: $localize`:@@featureInventory-colArticle:Article`,
      value: (row) => row.article.name,
      required: true,
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
      priority: 1,
    },
    {
      id: 'quantity',
      label: $localize`:@@featureInventory-colQuantity:Quantity`,
      value: (row) => formatInventoryQuantity(row.quantity, row.unit),
      align: 'end',
      priority: 1,
    },
    {
      id: 'date',
      label: $localize`:@@featureInventory-colDate:Date`,
      value: (row) => formatBillingDateTime(row.createdAt),
      priority: 2,
    },
  ];

  readonly warehouseMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: DB_DL_EDIT, icon: 'pencil' },
    { id: 'delete', label: DB_DL_DELETE, icon: 'trash', danger: true, dividerBefore: true },
    dbCopyIdItem(),
  ];
  readonly compartmentMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: DB_DL_EDIT, icon: 'pencil' },
    { id: 'delete', label: DB_DL_DELETE, icon: 'trash', danger: true, dividerBefore: true },
    dbCopyIdItem(),
  ];
  readonly movementMenu = (): FpcMenuItem[] => [
    { id: 'pdf', label: $localize`:@@featureInventory-downloadDocument:Download document`, icon: 'file-earmark-pdf' },
  ];

  readonly placementItems = computed((): FpcKeyValueItem[] => {
    const placement = this.selectedPlacement();

    if (!placement) return [];

    return [
      { key: 'article', label: $localize`:@@featureInventory-colArticle:Article`, value: placement.article.name },
      {
        key: 'number',
        label: $localize`:@@featureInventory-articleNumber:Article number`,
        value: placement.article.articleNumber,
        mono: true,
      },
      { key: 'ean', label: 'EAN', value: placement.article.ean ?? '—', mono: true },
      {
        key: 'location',
        label: $localize`:@@featureInventory-location:Location`,
        value: `${placement.warehouse.code} / ${placement.compartment.code}`,
        mono: true,
        hint: placement.warehouse.name,
      },
      {
        key: 'quantity',
        label: $localize`:@@featureInventory-onHand:On hand`,
        value: formatInventoryQuantity(placement.quantity, placement.article.unit),
      },
      ...(placement.article.serialTracking
        ? [
            {
              key: 'serials',
              label: $localize`:@@featureInventoryMove-serials:Serial numbers`,
              value: compressSerialNumbers(this.placementSerials()).join(', ') || '—',
              mono: true,
            },
          ]
        : []),
      {
        key: 'updated',
        label: $localize`:@@featureInventory-updated:Last change`,
        value: formatBillingDateTime(placement.updatedAt),
      },
    ];
  });

  // ---- Modals ----

  readonly warehouseModalOpen = signal(false);
  readonly compartmentModalOpen = signal(false);
  readonly addArticleModalOpen = signal(false);
  readonly moveDialogOpen = signal(false);
  readonly confirmDelete = signal<{
    kind: 'warehouse' | 'compartment' | 'placement';
    id: string;
    label: string;
  } | null>(null);
  readonly confirmDeleteOpen = signal(false);

  warehouseForm: WarehouseForm = this.emptyWarehouseForm();
  compartmentForm: CompartmentForm = this.emptyCompartmentForm();
  addArticleId: string | null = null;
  addArticleQuantity: number | null = null;
  readonly addArticle = signal<InventoryArticle | null>(null);

  readonly moveMode = signal<InventoryMoveMode>('putaway');
  readonly moveArticle = signal<InventoryMoveArticle | null>(null);
  readonly moveSource = signal<InventoryMoveLocation | null>(null);
  readonly moveTarget = signal<InventoryMoveLocation | null>(null);
  readonly movementTypeLabels = INVENTORY_MOVEMENT_TYPE_LABELS;

  constructor() {
    // Compartments of the selected warehouse (replace-page).
    effect(() => {
      const warehouseId = this.warehouseId();
      const page = this.compartmentPage();
      const pageSize = this.compartmentPageSize();
      const search = this.compartmentSearch();

      this.compartmentReload();

      untracked(() => {
        if (warehouseId) {
          this.facade.loadCompartments(warehouseId, { page, pageSize, search });
        } else {
          this.facade.clear('compartments');
        }
      });
    });
    // Contents of the selected compartment.
    effect(() => {
      const compartmentId = this.compartmentId();
      const page = this.contentPage();
      const pageSize = this.contentPageSize();
      const search = this.contentSearch();

      this.contentReload();

      untracked(() => {
        if (compartmentId) {
          this.facade.loadCompartmentStock(compartmentId, { page, pageSize, search });
        } else {
          this.facade.clear('compartmentStock');
        }
      });
    });
    // A different parent starts on its first page.
    effect(() => {
      this.warehouseId();
      untracked(() => this.compartmentPage.set(1));
    });
    effect(() => {
      this.compartmentId();
      untracked(() => this.contentPage.set(1));
    });

    // Header data of the selection: from the current page, else fetched (deep link to a later page).
    effect(() => {
      const id = this.warehouseId();
      const row = this.warehouses().items.find((item) => item.id === id);

      untracked(() =>
        this.resolve(id, row ?? null, this.selectedWarehouse, (value) => this.service.getWarehouse(value)),
      );
    });
    effect(() => {
      const id = this.compartmentId();
      const row = this.compartments().items.find((item) => item.id === id);

      untracked(() =>
        this.resolve(id, row ?? null, this.selectedCompartment, (value) => this.service.getCompartment(value)),
      );
    });
    effect(() => {
      const id = this.placementId();
      const row = this.contents().items.find((item) => item.id === id);

      untracked(() =>
        this.resolve(id, row ?? null, this.selectedPlacement, (value) => this.service.getPlacement(value)),
      );
    });
    // Serial numbers in the placement (re-read when its stock changed).
    effect(() => {
      const placement = this.selectedPlacement();

      untracked(() => {
        if (!placement?.article.serialTracking) {
          this.placementSerials.set([]);

          return;
        }

        loadInventorySerialsInStock(this.service, placement.article.id, placement.compartment.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((serials) => this.placementSerials.set(serials));
      });
    });
    // Movement history of the placement (re-read when its stock changed).
    effect(() => {
      const placement = this.selectedPlacement();
      const page = this.placementMovementsPage();
      const pageSize = this.placementMovementsPageSize();
      const search = this.placementMovementsSearch();

      this.placementMovementsReload();

      untracked(() => this.loadPlacementMovements(placement, page, pageSize, search));
    });

    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.warehouseModalOpen,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.compartmentModalOpen,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.addArticleModalOpen,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.facade.mutating$,
      error$: this.facade.mutationError$,
      open: this.confirmDeleteOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => this.afterDelete(),
    });
  }

  ngOnInit(): void {
    this.facade.loadSummary();
    this.facade.connectLive();
  }

  ngOnDestroy(): void {
    this.facade.disconnectLive();
  }

  private resolve<T extends { id: string }>(
    id: string | null,
    row: T | null,
    target: WritableSignal<T | null>,
    fetch: (id: string) => Observable<T>,
  ): void {
    if (!id) {
      target.set(null);

      return;
    }

    if (row) {
      target.set(row);

      return;
    }

    if (target()?.id === id) return;

    fetch(id)
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((value) => target.set(value));
  }

  private loadPlacementMovements(
    placement: InventoryStock | null,
    page: number,
    pageSize: number,
    search: string,
  ): void {
    this.placementMovementsRequest?.unsubscribe();

    if (!placement) {
      this.placementMovementsLoading.set(false);
      this.placementMovements.set([]);
      this.placementMovementsTotal.set(0);

      return;
    }

    this.placementMovementsLoading.set(true);
    this.placementMovementsRequest = this.service
      .listMovements({
        articleId: placement.article.id,
        compartmentId: placement.compartment.id,
        search: search.trim() || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      .pipe(
        catchError(() => of({ items: [] as InventoryMovement[], total: 0 })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.placementMovements.set(response.items);
        this.placementMovementsTotal.set(response.total);
        this.placementMovementsLoading.set(false);
      });
  }

  // ---- Navigation ----

  private select(params: { warehouse?: string | null; compartment?: string | null; placement?: string | null }): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  selectWarehouse(row: InventoryWarehouse): void {
    this.select({ warehouse: row.id, compartment: null, placement: null });
  }

  selectCompartment(row: InventoryCompartment): void {
    this.select({ compartment: row.id, placement: null });
  }

  selectPlacement(row: InventoryStock): void {
    this.select({ placement: row.id });
  }

  back(): void {
    if (this.placementId()) this.select({ placement: null });
    else if (this.compartmentId()) this.select({ compartment: null });
    else this.select({ warehouse: null });
  }

  articleLink(placement: InventoryStock): string[] {
    return ['/administration/inventory/articles', placement.article.id];
  }

  // ---- Warehouses ----

  openWarehouseModal(row?: InventoryWarehouse): void {
    this.facade.clearError();
    this.warehouseForm = row
      ? {
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description ?? '',
          addressLine1: row.addressLine1 ?? '',
          addressLine2: row.addressLine2 ?? '',
          postalCode: row.postalCode ?? '',
          city: row.city ?? '',
          country: row.country ?? '',
          isActive: row.isActive,
        }
      : this.emptyWarehouseForm();
    showBillingModal(this.warehouseModalOpen);
  }

  submitWarehouse(): void {
    const { id, ...dto } = this.warehouseForm;

    if (!dto.code.trim() || !dto.name.trim()) return;

    this.facade.mutate({ kind: 'saveWarehouse', id: id ?? undefined, dto });
  }

  onWarehouseAction(row: InventoryWarehouse, action: string): void {
    if (action === 'edit') this.openWarehouseModal(row);
    else if (action === 'delete') this.askDelete('warehouse', row.id, row.name);
    else if (action === 'copy-id') fpcCopyText(row.id);
  }

  // ---- Compartments ----

  openCompartmentModal(row?: InventoryCompartment): void {
    this.facade.clearError();
    this.compartmentForm = row
      ? { id: row.id, code: row.code, name: row.name ?? '', description: row.description ?? '', isActive: row.isActive }
      : this.emptyCompartmentForm();
    showBillingModal(this.compartmentModalOpen);
  }

  submitCompartment(): void {
    const warehouseId = this.warehouseId();
    const { id, ...form } = this.compartmentForm;

    if (!warehouseId || !form.code.trim()) return;

    const dto: InventoryCompartmentInput = { ...form };

    this.facade.mutate({ kind: 'saveCompartment', warehouseId, id: id ?? undefined, dto });
  }

  onCompartmentAction(row: InventoryCompartment, action: string): void {
    if (action === 'edit') this.openCompartmentModal(row);
    else if (action === 'delete') this.askDelete('compartment', row.id, row.code);
    else if (action === 'copy-id') fpcCopyText(row.id);
  }

  // ---- Contents ----

  openAddArticle(): void {
    this.facade.clearError();
    this.addArticleId = null;
    this.addArticle.set(null);
    this.addArticleQuantity = null;
    showBillingModal(this.addArticleModalOpen);
  }

  /** Quantity 0 / empty maps the location only; a quantity books a putaway (new goods). */
  submitAddArticle(): void {
    const compartmentId = this.compartmentId();
    const articleId = this.addArticleId;
    const quantity = Number(this.addArticleQuantity ?? 0);

    if (!compartmentId || !articleId) return;

    const article = this.addArticle();
    const compartment = this.selectedCompartment();

    if (quantity > 0 && article?.serialTracking && compartment) {
      // Serial-tracked goods are put away with their serial numbers (putaway dialog).
      this.addArticleModalOpen.set(false);
      this.openMove('putaway', article, null, {
        compartmentId: compartment.id,
        compartmentCode: compartment.code,
        warehouseCode: compartment.warehouseCode,
      });

      return;
    }

    if (quantity > 0) {
      this.facade.mutate({
        kind: 'putaway',
        dto: { articleId, targetCompartmentId: compartmentId, quantity, reason: 'receipt' },
      });
    } else {
      this.facade.mutate({ kind: 'createPlacement', articleId, compartmentId });
    }
  }

  /** "Take it from another compartment": transfer into the selected compartment with suggestions. */
  transferIntoCompartment(): void {
    const article = this.addArticle();
    const compartment = this.selectedCompartment();

    if (!article || !compartment) return;

    this.addArticleModalOpen.set(false);
    this.openMove('transfer', article, null, {
      compartmentId: compartment.id,
      compartmentCode: compartment.code,
      warehouseCode: compartment.warehouseCode,
    });
  }

  openMove(
    mode: InventoryMoveMode,
    article: InventoryMoveArticle,
    source: InventoryMoveLocation | null,
    target: InventoryMoveLocation | null,
  ): void {
    this.moveMode.set(mode);
    this.moveArticle.set({
      id: article.id,
      articleNumber: article.articleNumber,
      name: article.name,
      unit: article.unit,
      serialTracking: article.serialTracking === true,
    });
    this.moveSource.set(source);
    this.moveTarget.set(target);
    showBillingModal(this.moveDialogOpen);
  }

  placementLocation(placement: InventoryStock): InventoryMoveLocation {
    return {
      compartmentId: placement.compartment.id,
      compartmentCode: placement.compartment.code,
      warehouseCode: placement.warehouse.code,
      quantity: placement.quantity,
    };
  }

  movePlacement(mode: InventoryMoveMode): void {
    const placement = this.selectedPlacement();

    if (!placement) return;

    const location = this.placementLocation(placement);

    this.openMove(mode, placement.article, mode === 'putaway' ? null : location, mode === 'putaway' ? location : null);
  }

  removePlacement(): void {
    const placement = this.selectedPlacement();

    if (placement) {
      this.askDelete('placement', placement.id, `${placement.warehouse.code} / ${placement.compartment.code}`);
    }
  }

  onMovementAction(row: InventoryMovement, action: string): void {
    if (action === 'pdf') this.downloadDocument(row);
  }

  downloadDocument(row: InventoryMovement): void {
    this.service
      .downloadMovementPdf(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => saveInventoryBlob(blob, `${row.documentNumber}.pdf`));
  }

  // ---- Delete ----

  private askDelete(kind: 'warehouse' | 'compartment' | 'placement', id: string, label: string): void {
    this.facade.clearError();
    this.confirmDelete.set({ kind, id, label });
    showBillingModal(this.confirmDeleteOpen);
  }

  confirmDeleteMessage(): string {
    const target = this.confirmDelete();

    if (!target) return '';

    switch (target.kind) {
      case 'warehouse':
        return $localize`:@@featureInventory-deleteWarehouseMessage:Warehouse ${target.label}:label: and its empty compartments will be deleted. Warehouses holding stock cannot be deleted.`;
      case 'compartment':
        return $localize`:@@featureInventory-deleteCompartmentMessage:Compartment ${target.label}:label: will be deleted. Compartments holding stock cannot be deleted.`;
      default:
        return $localize`:@@featureInventory-deletePlacementMessage:The location ${target.label}:label: will be removed from the article. Only empty locations can be removed.`;
    }
  }

  runDelete(): void {
    const target = this.confirmDelete();

    if (!target) return;

    if (target.kind === 'warehouse') this.facade.mutate({ kind: 'deleteWarehouse', id: target.id });
    else if (target.kind === 'compartment') this.facade.mutate({ kind: 'deleteCompartment', id: target.id });
    else this.facade.mutate({ kind: 'deletePlacement', id: target.id });
  }

  private afterDelete(): void {
    const target = this.confirmDelete();

    if (!target) return;

    if (target.kind === 'warehouse' && target.id === this.warehouseId()) {
      this.select({ warehouse: null, compartment: null, placement: null });
    } else if (target.kind === 'compartment' && target.id === this.compartmentId()) {
      this.select({ compartment: null, placement: null });
    } else if (target.kind === 'placement' && target.id === this.placementId()) {
      this.select({ placement: null });
    }

    this.confirmDelete.set(null);
  }

  formatQuantity(value: number, unit: string): string {
    return formatInventoryQuantity(value, unit);
  }

  private emptyWarehouseForm(): WarehouseForm {
    return {
      id: null,
      code: '',
      name: '',
      description: '',
      addressLine1: '',
      addressLine2: '',
      postalCode: '',
      city: '',
      country: '',
      isActive: true,
    };
  }

  private emptyCompartmentForm(): CompartmentForm {
    return { id: null, code: '', name: '', description: '', isActive: true };
  }
}
