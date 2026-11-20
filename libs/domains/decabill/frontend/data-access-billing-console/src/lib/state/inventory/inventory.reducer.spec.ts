import type {
  InventoryLending,
  InventoryStock,
  InventoryWarehouse,
  InventoryWithdrawalRequest,
} from '../../types/inventory.types';

import {
  clearInventorySlice,
  inventoryCompartmentRemoved,
  inventoryLendingUpsert,
  inventoryRequestUpsert,
  inventorySerialUnitsChanged,
  inventoryStockRemoved,
  inventoryStockUpsert,
  inventoryWarehouseRemoved,
  inventoryWarehouseUpsert,
  loadInventoryCompartments,
  loadInventoryLendings,
  loadInventorySerialUnits,
  loadInventorySliceFailure,
  loadInventorySliceSuccess,
  loadInventoryWarehouses,
} from './inventory.actions';
import { reloadActionFor } from './inventory.effects';
import {
  initialInventoryState,
  inventoryReducer,
  inventorySlicesAffectedBy,
  type InventoryState,
} from './inventory.reducer';

const warehouse = (id: string, name = id): InventoryWarehouse =>
  ({ id, code: id.toUpperCase(), name, isActive: true }) as InventoryWarehouse;
const stock = (id: string, quantity: number): InventoryStock =>
  ({
    id,
    quantity,
    article: { id: 'a1' },
    compartment: { id: 'c1' },
    warehouse: { id: 'w1' },
  }) as InventoryStock;

function loaded(state: InventoryState, slice: 'warehouses', items: unknown[], total = items.length): InventoryState {
  return inventoryReducer(state, loadInventorySliceSuccess({ slice, items, total }));
}

describe('inventoryReducer', () => {
  it('replaces the page instead of accumulating rows', () => {
    let state = inventoryReducer(initialInventoryState, loadInventoryWarehouses({ page: 1, pageSize: 25 }));

    state = loaded(state, 'warehouses', [warehouse('a'), warehouse('b')], 30);
    state = inventoryReducer(state, loadInventoryWarehouses({ page: 2 }));
    expect(state.warehouses.loading).toBe(true);
    state = loaded(state, 'warehouses', [warehouse('c')], 30);

    expect(state.warehouses.items.map((item) => item.id)).toEqual(['c']);
    expect(state.warehouses.page).toBe(2);
    expect(state.warehouses.total).toBe(30);
  });

  it('starts a different parent empty (no rows of the previous warehouse)', () => {
    let state = inventoryReducer(initialInventoryState, loadInventoryCompartments({ warehouseId: 'w1' }));

    state = inventoryReducer(
      state,
      loadInventorySliceSuccess({ slice: 'compartments', items: [{ id: 'c1' }], total: 1 }),
    );
    state = inventoryReducer(state, loadInventoryCompartments({ warehouseId: 'w2' }));

    expect(state.compartments.items).toEqual([]);
    expect(state.compartments.scopeId).toBe('w2');
  });

  it('keeps rows during silent reloads', () => {
    let state = loaded(initialInventoryState, 'warehouses', [warehouse('a')]);

    state = inventoryReducer(state, loadInventoryWarehouses({ silent: true }));

    expect(state.warehouses.loading).toBe(false);
    expect(state.warehouses.items).toHaveLength(1);
  });

  it('patches live upserts of rows on the page and ignores others', () => {
    let state = loaded(initialInventoryState, 'warehouses', [warehouse('a', 'Old')]);

    state = inventoryReducer(state, inventoryWarehouseUpsert({ warehouse: warehouse('a', 'New') }));
    state = inventoryReducer(state, inventoryWarehouseUpsert({ warehouse: warehouse('z') }));

    expect(state.warehouses.items).toEqual([warehouse('a', 'New')]);
  });

  it('closes the columns of a removed warehouse / compartment', () => {
    let state = inventoryReducer(initialInventoryState, loadInventoryCompartments({ warehouseId: 'w1' }));

    state = { ...state, compartmentStock: { ...state.compartmentStock, scopeId: 'c1', items: [stock('s1', 1)] } };
    state = inventoryReducer(state, inventoryCompartmentRemoved({ id: 'c1', warehouseId: 'w1' }));
    expect(state.compartmentStock.items).toEqual([]);

    state = inventoryReducer(state, inventoryWarehouseRemoved({ id: 'w1' }));
    expect(state.compartments.scopeId).toBeNull();
  });

  it('patches and removes stock rows in both stock lists', () => {
    let state: InventoryState = {
      ...initialInventoryState,
      compartmentStock: { ...initialInventoryState.compartmentStock, items: [stock('s1', 1)], total: 1 },
      articleStock: { ...initialInventoryState.articleStock, items: [stock('s1', 1)], total: 1 },
    };

    state = inventoryReducer(state, inventoryStockUpsert({ stock: stock('s1', 5) }));
    expect(state.compartmentStock.items[0]?.quantity).toBe(5);
    expect(state.articleStock.items[0]?.quantity).toBe(5);

    state = inventoryReducer(state, inventoryStockRemoved({ id: 's1', compartmentId: 'c1', articleId: 'a1' }));
    expect(state.compartmentStock.items).toEqual([]);
    expect(state.articleStock.total).toBe(0);
  });

  it('drops decided requests from the pending list', () => {
    const request = { id: 'r1', status: 'pending' } as InventoryWithdrawalRequest;
    let state: InventoryState = {
      ...initialInventoryState,
      requests: { ...initialInventoryState.requests, items: [request], total: 1 },
    };

    state = inventoryReducer(state, inventoryRequestUpsert({ request: { ...request, status: 'accepted' } }));

    expect(state.requests.items).toEqual([]);
  });

  it('records load failures and clears slices', () => {
    let state = inventoryReducer(
      initialInventoryState,
      loadInventorySliceFailure({ slice: 'articles', error: 'Forbidden' }),
    );

    expect(state.articles.error).toBe('Forbidden');
    state = inventoryReducer(state, clearInventorySlice({ slice: 'articles' }));
    expect(state.articles.error).toBeNull();
  });
});

describe('inventory live reload rules', () => {
  it('reloads lists only when a new row belongs to the open scope', () => {
    const state: InventoryState = {
      ...initialInventoryState,
      warehouses: { ...initialInventoryState.warehouses, loaded: true, items: [warehouse('a')] },
      compartments: { ...initialInventoryState.compartments, loaded: true, scopeId: 'w1' },
    };

    expect(inventorySlicesAffectedBy(state, { kind: 'warehouse', id: 'a' })).toEqual([]);
    expect(inventorySlicesAffectedBy(state, { kind: 'warehouse', id: 'new' })).toEqual(['warehouses']);
    expect(inventorySlicesAffectedBy(state, { kind: 'compartment', id: 'c9', warehouseId: 'w1' })).toEqual([
      'compartments',
    ]);
    expect(inventorySlicesAffectedBy(state, { kind: 'compartment', id: 'c9', warehouseId: 'other' })).toEqual([]);
  });

  it('re-requests the current page silently and skips closed slices', () => {
    const state: InventoryState = {
      ...initialInventoryState,
      compartments: { ...initialInventoryState.compartments, loaded: true, scopeId: 'w1', page: 3, pageSize: 50 },
    };

    expect(reloadActionFor('compartments', state)).toEqual(
      loadInventoryCompartments({ page: 3, pageSize: 50, silent: true, warehouseId: 'w1' }),
    );
    expect(reloadActionFor('articles', state)).toBeNull();
  });

  describe('lendings and serial units', () => {
    const lending = (id: string, status: 'open' | 'returned'): InventoryLending =>
      ({ id, status, overdue: false }) as InventoryLending;

    it('keeps the lending filters and drops returned lendings from the open list', () => {
      let state = inventoryReducer(initialInventoryState, loadInventoryLendings({ filters: { status: 'open' } }));

      state = inventoryReducer(
        state,
        loadInventorySliceSuccess({
          slice: 'lendings',
          items: [lending('l1', 'open'), lending('l2', 'open')],
          total: 2,
        }),
      );
      expect(state.lendingFilters).toEqual({ status: 'open' });

      state = inventoryReducer(state, inventoryLendingUpsert({ lending: lending('l1', 'returned') }));
      expect(state.lendings.items.map((item) => item.id)).toEqual(['l2']);
      expect(state.lendings.total).toBe(1);

      expect(inventorySlicesAffectedBy(state, { kind: 'lending', id: 'l9' })).toEqual(['lendings']);
      expect(reloadActionFor('lendings', state)).toEqual(
        loadInventoryLendings({ page: 1, pageSize: state.lendings.pageSize, silent: true }),
      );
    });

    it('scopes serial units to their article and reloads them on live changes of that article', () => {
      let state = inventoryReducer(
        initialInventoryState,
        loadInventorySerialUnits({ articleId: 'a1', status: 'in_stock' }),
      );

      state = inventoryReducer(state, loadInventorySliceSuccess({ slice: 'serialUnits', items: [], total: 0 }));
      expect(state.serialUnits.scopeId).toBe('a1');
      expect(state.serialUnitStatus).toBe('in_stock');
      expect(inventorySlicesAffectedBy(state, { kind: 'serialUnits', articleId: 'a1' })).toEqual(['serialUnits']);
      expect(inventorySlicesAffectedBy(state, { kind: 'serialUnits', articleId: 'a2' })).toEqual([]);
      expect(reloadActionFor('serialUnits', state)).toEqual(
        loadInventorySerialUnits({ articleId: 'a1', page: 1, pageSize: state.serialUnits.pageSize, silent: true }),
      );
      expect(inventoryReducer(state, inventorySerialUnitsChanged({ articleId: 'a1' }))).toBe(state);
    });
  });
});
