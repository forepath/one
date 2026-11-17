import { createReducer, on } from '@ngrx/store';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';
import type {
  InventoryArticle,
  InventoryCompartment,
  InventoryLending,
  InventoryLendingFilters,
  InventoryMovement,
  InventoryMovementFilters,
  InventorySerialUnit,
  InventorySerialUnitStatus,
  InventoryStock,
  InventorySummary,
  InventoryWarehouse,
  InventoryWithdrawalRequest,
  InventoryWithdrawalRequestStatus,
} from '../../types/inventory.types';

import {
  clearInventoryError,
  clearInventorySlice,
  type InventoryPageQuery,
  type InventorySliceKey,
  inventoryArticleRemoved,
  inventoryArticleUpsert,
  inventoryCompartmentRemoved,
  inventoryCompartmentUpsert,
  inventoryLendingUpsert,
  inventoryMovementCreated,
  inventoryRequestsChanged,
  inventoryRequestUpsert,
  inventorySocketStatus,
  inventoryStockRemoved,
  inventoryStockUpsert,
  inventoryWarehouseRemoved,
  inventoryWarehouseUpsert,
  loadInventoryArticle,
  loadInventoryArticles,
  loadInventoryArticleStock,
  loadInventoryArticleSuccess,
  loadInventoryCompartments,
  loadInventoryCompartmentStock,
  loadInventoryLendings,
  loadInventoryMovements,
  loadInventoryRequests,
  loadInventorySerialUnits,
  loadInventorySliceFailure,
  loadInventorySliceSuccess,
  loadInventorySummarySuccess,
  loadInventoryWarehouses,
  runInventoryMutation,
  runInventoryMutationFailure,
  runInventoryMutationSuccess,
} from './inventory.actions';

/** One replace-page list: the current page only (never accumulated). */
export interface InventoryPageSlice<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  search: string | null;
  /** Parent of the list (warehouse of compartments, compartment of stock, article of locations). */
  scopeId: string | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

export interface InventoryState {
  warehouses: InventoryPageSlice<InventoryWarehouse>;
  compartments: InventoryPageSlice<InventoryCompartment>;
  compartmentStock: InventoryPageSlice<InventoryStock>;
  articles: InventoryPageSlice<InventoryArticle>;
  articleStock: InventoryPageSlice<InventoryStock>;
  requests: InventoryPageSlice<InventoryWithdrawalRequest>;
  movements: InventoryPageSlice<InventoryMovement>;
  lendings: InventoryPageSlice<InventoryLending>;
  serialUnits: InventoryPageSlice<InventorySerialUnit>;
  lendingFilters: InventoryLendingFilters;
  serialUnitStatus: InventorySerialUnitStatus | null;
  articleFilters: { lowStockOnly: boolean; activeOnly: boolean };
  requestStatus: InventoryWithdrawalRequestStatus | null;
  movementFilters: Omit<InventoryMovementFilters, 'search'>;
  summary: InventorySummary | null;
  selectedArticle: InventoryArticle | null;
  mutating: boolean;
  mutationError: string | null;
  socketConnected: boolean;
}

function emptySlice<T>(): InventoryPageSlice<T> {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: BILLING_LIST_PAGE_SIZE,
    search: null,
    scopeId: null,
    loading: false,
    error: null,
    loaded: false,
  };
}

export const initialInventoryState: InventoryState = {
  warehouses: emptySlice(),
  compartments: emptySlice(),
  compartmentStock: emptySlice(),
  articles: emptySlice(),
  articleStock: emptySlice(),
  requests: emptySlice(),
  movements: emptySlice(),
  lendings: emptySlice(),
  serialUnits: emptySlice(),
  lendingFilters: { status: 'open' },
  serialUnitStatus: null,
  articleFilters: { lowStockOnly: false, activeOnly: false },
  requestStatus: 'pending',
  movementFilters: {},
  summary: null,
  selectedArticle: null,
  mutating: false,
  mutationError: null,
  socketConnected: false,
};

function startLoad<T>(
  slice: InventoryPageSlice<T>,
  query: InventoryPageQuery,
  scopeId: string | null = null,
): InventoryPageSlice<T> {
  const window = billingPageWindow(query.page ?? slice.page, query.pageSize ?? slice.pageSize);
  const search = query.search !== undefined ? query.search.trim() || null : slice.search;
  // A different parent starts empty (no rows of the previous warehouse / compartment / article).
  const scopeChanged = slice.scopeId !== scopeId;

  return {
    ...slice,
    items: scopeChanged ? [] : slice.items,
    total: scopeChanged ? 0 : slice.total,
    page: window.page,
    pageSize: window.pageSize,
    search,
    scopeId,
    loading: query.silent ? slice.loading : true,
    error: null,
  };
}

/** Replaces a row of the current page with its live state; rows not on the page are left to a reload. */
function patchRows<T extends { id: string }>(slice: InventoryPageSlice<T>, row: T): InventoryPageSlice<T> {
  return slice.items.some((item) => item.id === row.id)
    ? { ...slice, items: slice.items.map((item) => (item.id === row.id ? row : item)) }
    : slice;
}

function dropRow<T extends { id: string }>(slice: InventoryPageSlice<T>, id: string): InventoryPageSlice<T> {
  return slice.items.some((item) => item.id === id)
    ? { ...slice, items: slice.items.filter((item) => item.id !== id), total: Math.max(0, slice.total - 1) }
    : slice;
}

export const inventoryReducer = createReducer(
  initialInventoryState,
  on(loadInventoryWarehouses, (state, query) => ({ ...state, warehouses: startLoad(state.warehouses, query) })),
  on(loadInventoryCompartments, (state, query) => ({
    ...state,
    compartments: startLoad(state.compartments, query, query.warehouseId),
  })),
  on(loadInventoryCompartmentStock, (state, query) => ({
    ...state,
    compartmentStock: startLoad(state.compartmentStock, query, query.compartmentId),
  })),
  on(loadInventoryArticles, (state, query) => ({
    ...state,
    articles: startLoad(state.articles, query),
    articleFilters: {
      lowStockOnly: query.lowStockOnly ?? state.articleFilters.lowStockOnly,
      activeOnly: query.activeOnly ?? state.articleFilters.activeOnly,
    },
  })),
  on(loadInventoryArticleStock, (state, query) => ({
    ...state,
    articleStock: startLoad(state.articleStock, query, query.articleId),
  })),
  on(loadInventoryRequests, (state, query) => ({
    ...state,
    requests: startLoad(state.requests, query),
    requestStatus: query.status !== undefined ? query.status : state.requestStatus,
  })),
  on(loadInventoryMovements, (state, query) => ({
    ...state,
    movements: startLoad(state.movements, query),
    movementFilters: query.filters ?? state.movementFilters,
  })),
  on(loadInventoryLendings, (state, query) => ({
    ...state,
    lendings: startLoad(state.lendings, query),
    lendingFilters: query.filters ?? state.lendingFilters,
  })),
  on(loadInventorySerialUnits, (state, query) => ({
    ...state,
    serialUnits: startLoad(state.serialUnits, query, query.articleId),
    serialUnitStatus: query.status !== undefined ? query.status : state.serialUnitStatus,
  })),
  on(loadInventorySliceSuccess, (state, { slice, items, total }) => ({
    ...state,
    [slice]: { ...state[slice], items, total, loading: false, error: null, loaded: true },
  })),
  on(loadInventorySliceFailure, (state, { slice, error }) => ({
    ...state,
    [slice]: { ...state[slice], items: [], total: 0, loading: false, error, loaded: true },
  })),
  on(clearInventorySlice, (state, { slice }) => ({
    ...state,
    [slice]: { ...emptySlice(), pageSize: state[slice].pageSize },
  })),
  on(loadInventorySummarySuccess, (state, { summary }) => ({ ...state, summary })),
  on(loadInventoryArticle, (state, { articleId }) => ({
    ...state,
    selectedArticle: state.selectedArticle?.id === articleId ? state.selectedArticle : null,
  })),
  on(loadInventoryArticleSuccess, (state, { article }) => ({ ...state, selectedArticle: article })),
  on(runInventoryMutation, (state) => ({ ...state, mutating: true, mutationError: null })),
  on(runInventoryMutationSuccess, (state) => ({ ...state, mutating: false })),
  on(runInventoryMutationFailure, (state, { error }) => ({ ...state, mutating: false, mutationError: error })),
  on(clearInventoryError, (state) => ({ ...state, mutationError: null })),
  on(inventorySocketStatus, (state, { connected }) => ({ ...state, socketConnected: connected })),
  on(inventoryWarehouseUpsert, (state, { warehouse }) => ({
    ...state,
    warehouses: patchRows(state.warehouses, warehouse),
  })),
  on(inventoryWarehouseRemoved, (state, { id }) => ({
    ...state,
    warehouses: dropRow(state.warehouses, id),
    // The open columns of a deleted warehouse close.
    ...(state.compartments.scopeId === id
      ? { compartments: emptySlice<InventoryCompartment>(), compartmentStock: emptySlice<InventoryStock>() }
      : {}),
  })),
  on(inventoryCompartmentUpsert, (state, { compartment }) => ({
    ...state,
    compartments: patchRows(state.compartments, compartment),
  })),
  on(inventoryCompartmentRemoved, (state, { id }) => ({
    ...state,
    compartments: dropRow(state.compartments, id),
    ...(state.compartmentStock.scopeId === id ? { compartmentStock: emptySlice<InventoryStock>() } : {}),
  })),
  on(inventoryArticleUpsert, (state, { article }) => ({
    ...state,
    articles: patchRows(state.articles, article),
    selectedArticle: state.selectedArticle?.id === article.id ? article : state.selectedArticle,
  })),
  on(inventoryArticleRemoved, (state, { id }) => ({
    ...state,
    articles: dropRow(state.articles, id),
    selectedArticle: state.selectedArticle?.id === id ? null : state.selectedArticle,
  })),
  on(inventoryStockUpsert, (state, { stock }) => ({
    ...state,
    compartmentStock: patchRows(state.compartmentStock, stock),
    articleStock: patchRows(state.articleStock, stock),
  })),
  on(inventoryStockRemoved, (state, { id }) => ({
    ...state,
    compartmentStock: dropRow(state.compartmentStock, id),
    articleStock: dropRow(state.articleStock, id),
  })),
  on(inventoryRequestUpsert, (state, { request }) => ({
    ...state,
    // A decided request leaves a status-filtered list.
    requests:
      state.requestStatus && request.status !== state.requestStatus
        ? dropRow(state.requests, request.id)
        : patchRows(state.requests, request),
  })),
  on(inventoryRequestsChanged, (state, { pendingCount }) => ({
    ...state,
    summary: state.summary ? { ...state.summary, pendingRequestCount: pendingCount } : state.summary,
  })),
  on(inventoryMovementCreated, (state) => state),
  on(inventoryLendingUpsert, (state, { lending }) => ({
    ...state,
    // A returned lending leaves the "open" list.
    lendings:
      state.lendingFilters.status && lending.status !== state.lendingFilters.status
        ? dropRow(state.lendings, lending.id)
        : patchRows(state.lendings, lending),
  })),
);

/** Slices whose current page a live event may change in ways a patch cannot express (new / moved rows). */
export function inventorySlicesAffectedBy(
  state: InventoryState,
  event:
    | { kind: 'warehouse'; id: string }
    | { kind: 'compartment'; id: string; warehouseId: string }
    | { kind: 'article'; id: string }
    | { kind: 'stock'; id: string; compartmentId: string; articleId: string }
    | { kind: 'movement'; articleId: string; compartmentIds: string[] }
    | { kind: 'request'; id: string }
    | { kind: 'lending'; id: string }
    | { kind: 'serialUnits'; articleId: string },
): InventorySliceKey[] {
  const slices: InventorySliceKey[] = [];
  const missing = <T extends { id: string }>(slice: InventoryPageSlice<T>, id: string) =>
    slice.loaded && !slice.items.some((item) => item.id === id);

  switch (event.kind) {
    case 'warehouse':
      if (missing(state.warehouses, event.id)) slices.push('warehouses');

      break;
    case 'compartment':
      if (state.compartments.scopeId === event.warehouseId && missing(state.compartments, event.id)) {
        slices.push('compartments');
      }

      break;
    case 'article':
      if (missing(state.articles, event.id)) slices.push('articles');

      break;
    case 'stock':
      if (state.compartmentStock.scopeId === event.compartmentId && missing(state.compartmentStock, event.id)) {
        slices.push('compartmentStock');
      }

      if (state.articleStock.scopeId === event.articleId) {
        // Location order follows the quantity: re-read the page.
        slices.push('articleStock');
      }

      break;
    case 'movement':
      if (state.movements.loaded) slices.push('movements');

      break;
    case 'request':
      if (missing(state.requests, event.id)) slices.push('requests');

      break;
    case 'lending':
      if (missing(state.lendings, event.id)) slices.push('lendings');

      break;
    case 'serialUnits':
      if (state.serialUnits.scopeId === event.articleId) slices.push('serialUnits');

      break;
  }

  return slices;
}
