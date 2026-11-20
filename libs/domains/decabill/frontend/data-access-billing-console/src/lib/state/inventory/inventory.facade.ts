import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type {
  InventoryLendingFilters,
  InventoryMovementFilters,
  InventorySerialUnitStatus,
  InventoryWithdrawalRequestStatus,
} from '../../types/inventory.types';

import {
  clearInventoryError,
  clearInventorySlice,
  connectInventorySocket,
  disconnectInventorySocket,
  type InventoryMutation,
  type InventoryPageQuery,
  type InventorySliceKey,
  loadInventoryArticle,
  loadInventoryArticles,
  loadInventoryArticleStock,
  loadInventoryCompartments,
  loadInventoryCompartmentStock,
  loadInventoryLendings,
  loadInventoryMovements,
  loadInventoryRequests,
  loadInventorySerialUnits,
  loadInventorySummary,
  loadInventoryWarehouses,
  runInventoryMutation,
} from './inventory.actions';
import {
  selectInventoryArticleFilters,
  selectInventoryArticles,
  selectInventoryArticleStock,
  selectInventoryCompartments,
  selectInventoryCompartmentStock,
  selectInventoryLendingFilters,
  selectInventoryLendings,
  selectInventoryMovementFilters,
  selectInventoryMovements,
  selectInventoryMutating,
  selectInventoryMutationError,
  selectInventoryRequests,
  selectInventoryRequestStatus,
  selectInventorySelectedArticle,
  selectInventorySerialUnits,
  selectInventorySocketConnected,
  selectInventorySummary,
  selectInventoryWarehouses,
} from './inventory.selectors';

@Injectable()
export class InventoryFacade {
  private readonly store = inject(Store);

  readonly warehouses$ = this.store.select(selectInventoryWarehouses);
  readonly compartments$ = this.store.select(selectInventoryCompartments);
  readonly compartmentStock$ = this.store.select(selectInventoryCompartmentStock);
  readonly articles$ = this.store.select(selectInventoryArticles);
  readonly articleStock$ = this.store.select(selectInventoryArticleStock);
  readonly requests$ = this.store.select(selectInventoryRequests);
  readonly movements$ = this.store.select(selectInventoryMovements);
  readonly lendings$ = this.store.select(selectInventoryLendings);
  readonly lendingFilters$ = this.store.select(selectInventoryLendingFilters);
  readonly serialUnits$ = this.store.select(selectInventorySerialUnits);
  readonly articleFilters$ = this.store.select(selectInventoryArticleFilters);
  readonly requestStatus$ = this.store.select(selectInventoryRequestStatus);
  readonly movementFilters$ = this.store.select(selectInventoryMovementFilters);
  readonly summary$ = this.store.select(selectInventorySummary);
  readonly selectedArticle$ = this.store.select(selectInventorySelectedArticle);
  readonly mutating$ = this.store.select(selectInventoryMutating);
  readonly mutationError$ = this.store.select(selectInventoryMutationError);
  readonly socketConnected$ = this.store.select(selectInventorySocketConnected);

  loadWarehouses(query: InventoryPageQuery): void {
    this.store.dispatch(loadInventoryWarehouses(query));
  }

  loadCompartments(warehouseId: string, query: InventoryPageQuery): void {
    this.store.dispatch(loadInventoryCompartments({ ...query, warehouseId }));
  }

  loadCompartmentStock(compartmentId: string, query: InventoryPageQuery): void {
    this.store.dispatch(loadInventoryCompartmentStock({ ...query, compartmentId }));
  }

  loadArticles(query: InventoryPageQuery & { lowStockOnly?: boolean; activeOnly?: boolean }): void {
    this.store.dispatch(loadInventoryArticles(query));
  }

  loadArticleStock(articleId: string, query: InventoryPageQuery): void {
    this.store.dispatch(loadInventoryArticleStock({ ...query, articleId }));
  }

  loadRequests(query: InventoryPageQuery & { status?: InventoryWithdrawalRequestStatus | null }): void {
    this.store.dispatch(loadInventoryRequests(query));
  }

  loadMovements(query: InventoryPageQuery & { filters?: Omit<InventoryMovementFilters, 'search'> }): void {
    this.store.dispatch(loadInventoryMovements(query));
  }

  loadLendings(query: InventoryPageQuery & { filters?: InventoryLendingFilters }): void {
    this.store.dispatch(loadInventoryLendings(query));
  }

  loadSerialUnits(articleId: string, query: InventoryPageQuery & { status?: InventorySerialUnitStatus | null }): void {
    this.store.dispatch(loadInventorySerialUnits({ ...query, articleId }));
  }

  loadSummary(): void {
    this.store.dispatch(loadInventorySummary());
  }

  loadArticle(articleId: string): void {
    this.store.dispatch(loadInventoryArticle({ articleId }));
  }

  clear(slice: InventorySliceKey): void {
    this.store.dispatch(clearInventorySlice({ slice }));
  }

  mutate(mutation: InventoryMutation): void {
    this.store.dispatch(runInventoryMutation({ mutation }));
  }

  clearError(): void {
    this.store.dispatch(clearInventoryError());
  }

  private liveUsers = 0;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Reference-counted: inventory pages share one socket while the admin moves between them. */
  connectLive(): void {
    this.liveUsers++;

    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;

      return;
    }

    if (this.liveUsers === 1) {
      this.store.dispatch(connectInventorySocket());
    }
  }

  disconnectLive(): void {
    this.liveUsers = Math.max(0, this.liveUsers - 1);

    if (this.liveUsers > 0 || this.disconnectTimer) return;

    // Grace period: page swaps inside the inventory section keep the connection.
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null;

      if (this.liveUsers === 0) this.store.dispatch(disconnectInventorySocket());
    }, 1000);
  }
}
