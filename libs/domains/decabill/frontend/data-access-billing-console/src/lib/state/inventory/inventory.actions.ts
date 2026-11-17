import { createAction, props } from '@ngrx/store';

import type {
  InventoryArticle,
  InventoryArticleInput,
  InventoryCompartment,
  InventoryCompartmentInput,
  InventoryLending,
  InventoryLendingFilters,
  InventoryLendingInput,
  InventoryLendingReturnInput,
  InventoryMovement,
  InventoryMovementFilters,
  InventoryPutawayInput,
  InventoryRequestAllocation,
  InventorySerialUnitStatus,
  InventoryStock,
  InventorySummary,
  InventoryTransferInput,
  InventoryWarehouse,
  InventoryWarehouseInput,
  InventoryWithdrawalInput,
  InventoryWithdrawalRequest,
  InventoryWithdrawalRequestStatus,
} from '../../types/inventory.types';

/** Replace-page lists of the inventory feature. */
export type InventorySliceKey =
  | 'warehouses'
  | 'compartments'
  | 'compartmentStock'
  | 'articles'
  | 'articleStock'
  | 'requests'
  | 'movements'
  | 'lendings'
  | 'serialUnits';

export interface InventoryPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  /** Reload without the loading state (live updates). */
  silent?: boolean;
}

// ---- Lists ----

export const loadInventoryWarehouses = createAction('[Inventory] Load Warehouses', props<InventoryPageQuery>());
export const loadInventoryCompartments = createAction(
  '[Inventory] Load Compartments',
  props<InventoryPageQuery & { warehouseId: string }>(),
);
export const loadInventoryCompartmentStock = createAction(
  '[Inventory] Load Compartment Stock',
  props<InventoryPageQuery & { compartmentId: string }>(),
);
export const loadInventoryArticles = createAction(
  '[Inventory] Load Articles',
  props<InventoryPageQuery & { lowStockOnly?: boolean; activeOnly?: boolean }>(),
);
export const loadInventoryArticleStock = createAction(
  '[Inventory] Load Article Stock',
  props<InventoryPageQuery & { articleId: string }>(),
);
export const loadInventoryRequests = createAction(
  '[Inventory] Load Requests',
  props<InventoryPageQuery & { status?: InventoryWithdrawalRequestStatus | null }>(),
);
export const loadInventoryMovements = createAction(
  '[Inventory] Load Movements',
  props<InventoryPageQuery & { filters?: Omit<InventoryMovementFilters, 'search'> }>(),
);

export const loadInventoryLendings = createAction(
  '[Inventory] Load Lendings',
  props<InventoryPageQuery & { filters?: InventoryLendingFilters }>(),
);
/** Serial-tracked units of one article (scope), optionally of one status. */
export const loadInventorySerialUnits = createAction(
  '[Inventory] Load Serial Units',
  props<InventoryPageQuery & { articleId: string; status?: InventorySerialUnitStatus | null }>(),
);

export const loadInventorySliceSuccess = createAction(
  '[Inventory] Load Slice Success',
  props<{ slice: InventorySliceKey; items: unknown[]; total: number }>(),
);
export const loadInventorySliceFailure = createAction(
  '[Inventory] Load Slice Failure',
  props<{ slice: InventorySliceKey; error: string }>(),
);

/** Closes a column (e.g. another warehouse was selected): clears the slice and its scope. */
export const clearInventorySlice = createAction('[Inventory] Clear Slice', props<{ slice: InventorySliceKey }>());

/** Re-requests the current page of loaded slices (after mutations / live events), debounced. */
export const reloadInventorySlices = createAction(
  '[Inventory] Reload Slices',
  props<{ slices: InventorySliceKey[] }>(),
);

export const loadInventorySummary = createAction('[Inventory] Load Summary');
export const loadInventorySummarySuccess = createAction(
  '[Inventory] Load Summary Success',
  props<{ summary: InventorySummary }>(),
);

export const loadInventoryArticle = createAction('[Inventory] Load Article', props<{ articleId: string }>());
export const loadInventoryArticleSuccess = createAction(
  '[Inventory] Load Article Success',
  props<{ article: InventoryArticle }>(),
);

// ---- Mutations ----

export type InventoryMutation =
  | { kind: 'saveWarehouse'; id?: string; dto: InventoryWarehouseInput }
  | { kind: 'deleteWarehouse'; id: string }
  | { kind: 'saveCompartment'; warehouseId: string; id?: string; dto: InventoryCompartmentInput }
  | { kind: 'deleteCompartment'; id: string }
  | { kind: 'saveArticle'; id?: string; dto: InventoryArticleInput }
  | { kind: 'deleteArticle'; id: string }
  | { kind: 'createPlacement'; articleId: string; compartmentId: string }
  | { kind: 'deletePlacement'; id: string }
  | { kind: 'putaway'; dto: InventoryPutawayInput }
  | { kind: 'transfer'; dto: InventoryTransferInput }
  | { kind: 'withdraw'; dto: InventoryWithdrawalInput }
  | { kind: 'acceptRequest'; id: string; allocations: InventoryRequestAllocation[]; note?: string | null }
  | { kind: 'rejectRequest'; id: string; note?: string | null }
  | { kind: 'lend'; dto: InventoryLendingInput }
  | { kind: 'returnLending'; id: string; dto: InventoryLendingReturnInput };

export const runInventoryMutation = createAction('[Inventory] Run Mutation', props<{ mutation: InventoryMutation }>());
export const runInventoryMutationSuccess = createAction(
  '[Inventory] Run Mutation Success',
  props<{ kind: InventoryMutation['kind']; result: unknown }>(),
);
export const runInventoryMutationFailure = createAction(
  '[Inventory] Run Mutation Failure',
  props<{ kind: InventoryMutation['kind']; error: string }>(),
);
export const clearInventoryError = createAction('[Inventory] Clear Error');

// ---- Live updates (socket) ----

export const connectInventorySocket = createAction('[Inventory Socket] Connect');
export const disconnectInventorySocket = createAction('[Inventory Socket] Disconnect');
export const inventorySocketStatus = createAction(
  '[Inventory Socket] Status',
  props<{ connected: boolean; error?: string | null }>(),
);
export const inventoryWarehouseUpsert = createAction(
  '[Inventory Socket] Warehouse Upsert',
  props<{ warehouse: InventoryWarehouse }>(),
);
export const inventoryWarehouseRemoved = createAction('[Inventory Socket] Warehouse Removed', props<{ id: string }>());
export const inventoryCompartmentUpsert = createAction(
  '[Inventory Socket] Compartment Upsert',
  props<{ compartment: InventoryCompartment }>(),
);
export const inventoryCompartmentRemoved = createAction(
  '[Inventory Socket] Compartment Removed',
  props<{ id: string; warehouseId: string }>(),
);
export const inventoryArticleUpsert = createAction(
  '[Inventory Socket] Article Upsert',
  props<{ article: InventoryArticle }>(),
);
export const inventoryArticleRemoved = createAction('[Inventory Socket] Article Removed', props<{ id: string }>());
export const inventoryStockUpsert = createAction('[Inventory Socket] Stock Upsert', props<{ stock: InventoryStock }>());
export const inventoryStockRemoved = createAction(
  '[Inventory Socket] Stock Removed',
  props<{ id: string; compartmentId: string; articleId: string }>(),
);
export const inventoryMovementCreated = createAction(
  '[Inventory Socket] Movement Created',
  props<{ movement: InventoryMovement }>(),
);
export const inventoryRequestUpsert = createAction(
  '[Inventory Socket] Request Upsert',
  props<{ request: InventoryWithdrawalRequest }>(),
);
export const inventoryRequestsChanged = createAction(
  '[Inventory Socket] Requests Changed',
  props<{ pendingCount: number }>(),
);
export const inventoryLendingUpsert = createAction(
  '[Inventory Socket] Lending Upsert',
  props<{ lending: InventoryLending }>(),
);
export const inventorySerialUnitsChanged = createAction(
  '[Inventory Socket] Serial Units Changed',
  props<{ articleId: string }>(),
);
