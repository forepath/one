import { Injectable } from '@nestjs/common';

import type {
  InventoryArticleResponseDto,
  InventoryLendingResponseDto,
  InventoryMovementResponseDto,
  InventoryWithdrawalRequestResponseDto,
} from '../dto/inventory.dto';
import { InventoryArticlesRepository } from '../repositories/inventory-articles.repository';
import { InventoryCompartmentsRepository } from '../repositories/inventory-compartments.repository';
import { InventoryStockRepository } from '../repositories/inventory-stock.repository';
import { InventoryWarehousesRepository } from '../repositories/inventory-warehouses.repository';
import { mapArticle, mapCompartment, mapStock, mapWarehouse } from '../utils/inventory-mappers';

import { INVENTORY_EVENTS } from './inventory-realtime.constants';
import { InventoryRealtimeService } from './inventory-realtime.service';

/**
 * Re-reads changed inventory records and pushes their current state (same shape as REST) to connected
 * administrators, so open warehouse / article / request views update without reloading.
 */
@Injectable()
export class InventoryRealtimeNotifier {
  constructor(
    private readonly realtime: InventoryRealtimeService,
    private readonly warehousesRepository: InventoryWarehousesRepository,
    private readonly compartmentsRepository: InventoryCompartmentsRepository,
    private readonly articlesRepository: InventoryArticlesRepository,
    private readonly stockRepository: InventoryStockRepository,
  ) {}

  warehouseRemoved(id: string): void {
    this.realtime.emit(INVENTORY_EVENTS.warehouseRemoved, { id });
  }

  compartmentRemoved(id: string, warehouseId: string): void {
    this.realtime.emit(INVENTORY_EVENTS.compartmentRemoved, { id, warehouseId });
  }

  articleRemoved(id: string): void {
    this.realtime.emit(INVENTORY_EVENTS.articleRemoved, { id });
  }

  stockRemoved(id: string, compartmentId: string, articleId: string): void {
    this.realtime.emit(INVENTORY_EVENTS.stockRemoved, { id, compartmentId, articleId });
  }

  movementCreated(movement: InventoryMovementResponseDto): void {
    this.realtime.emit(INVENTORY_EVENTS.movementCreated, movement);
  }

  lendingChanged(lending: InventoryLendingResponseDto): void {
    this.realtime.emit(INVENTORY_EVENTS.lendingUpsert, lending);
  }

  serialUnitsChanged(articleIds: string[]): void {
    for (const articleId of new Set(articleIds)) {
      this.realtime.emit(INVENTORY_EVENTS.serialUnitsChanged, { articleId });
    }
  }

  requestChanged(request: InventoryWithdrawalRequestResponseDto): void {
    this.realtime.emit(INVENTORY_EVENTS.requestUpsert, request);
  }

  async warehousesChanged(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];

    if (unique.length === 0) {
      return;
    }

    const stats = await this.warehousesRepository.statsFor(unique);

    for (const id of unique) {
      const warehouse = await this.warehousesRepository.findByIdOrThrow(id).catch(() => null);

      if (warehouse) {
        this.realtime.emit(INVENTORY_EVENTS.warehouseUpsert, mapWarehouse(warehouse, stats.get(id)));
      }
    }
  }

  /** Compartments (and their warehouses, whose counts change with them). */
  async locationsChanged(compartmentIds: string[]): Promise<void> {
    const unique = [...new Set(compartmentIds)];

    if (unique.length === 0) {
      return;
    }

    const stats = await this.compartmentsRepository.statsFor(unique);
    const warehouseIds: string[] = [];

    for (const id of unique) {
      const compartment = await this.compartmentsRepository.findByIdOrThrow(id).catch(() => null);

      if (compartment) {
        warehouseIds.push(compartment.warehouseId);
        this.realtime.emit(INVENTORY_EVENTS.compartmentUpsert, mapCompartment(compartment, stats.get(id)));
      }
    }

    await this.warehousesChanged(warehouseIds);
  }

  async placementsChanged(placements: Array<{ compartmentId: string; articleId: string }>): Promise<void> {
    const seen = new Set<string>();

    for (const { compartmentId, articleId } of placements) {
      const key = `${compartmentId}:${articleId}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const placement = await this.stockRepository.findPlacement(compartmentId, articleId);

      if (placement) {
        this.realtime.emit(INVENTORY_EVENTS.stockUpsert, mapStock(placement));
      }
    }
  }

  async articlesChanged(ids: string[]): Promise<InventoryArticleResponseDto[]> {
    const unique = [...new Set(ids)];
    const articles = await this.articlesRepository.findByIds(unique);
    const totals = await this.articlesRepository.stockTotalsFor(unique);
    const requested = await this.articlesRepository.pendingRequestQuantityFor(unique);
    const lent = await this.articlesRepository.lentQuantityFor(unique);
    const mapped = articles.map((article) =>
      mapArticle(article, totals.get(article.id), requested.get(article.id) ?? 0, lent.get(article.id) ?? 0),
    );

    for (const article of mapped) {
      this.realtime.emit(INVENTORY_EVENTS.articleUpsert, article);
    }

    return mapped;
  }
}
