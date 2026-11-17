import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import type {
  CreateInventoryCompartmentDto,
  CreateInventoryPlacementDto,
  CreateInventoryWarehouseDto,
  InventoryCompartmentResponseDto,
  InventoryStockResponseDto,
  InventoryWarehouseResponseDto,
  PaginatedInventoryResponseDto,
  UpdateInventoryCompartmentDto,
  UpdateInventoryWarehouseDto,
} from '../dto/inventory.dto';
import { InventoryArticlesRepository } from '../repositories/inventory-articles.repository';
import { InventoryCompartmentsRepository } from '../repositories/inventory-compartments.repository';
import { InventoryStockRepository } from '../repositories/inventory-stock.repository';
import { InventoryWarehousesRepository } from '../repositories/inventory-warehouses.repository';
import { mapCompartment, mapStock, mapWarehouse } from '../utils/inventory-mappers';
import { inventoryPage } from '../utils/inventory-query.utils';

import { InventoryRealtimeNotifier } from './inventory-realtime-notifier.service';

/** Warehouses, their compartments and article placements (location mapping without stock change). */
@Injectable()
export class InventoryLocationsService {
  constructor(
    private readonly warehousesRepository: InventoryWarehousesRepository,
    private readonly compartmentsRepository: InventoryCompartmentsRepository,
    private readonly stockRepository: InventoryStockRepository,
    private readonly articlesRepository: InventoryArticlesRepository,
    private readonly realtime: InventoryRealtimeNotifier,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  // ---- Warehouses ----

  async listWarehouses(
    limit?: number,
    offset?: number,
    search?: string,
  ): Promise<PaginatedInventoryResponseDto<InventoryWarehouseResponseDto>> {
    const page = inventoryPage(limit, offset);
    const { items, total } = await this.warehousesRepository.findAll(page.limit, page.offset, search);
    const stats = await this.warehousesRepository.statsFor(items.map((warehouse) => warehouse.id));

    return { items: items.map((warehouse) => mapWarehouse(warehouse, stats.get(warehouse.id))), total };
  }

  async getWarehouse(id: string): Promise<InventoryWarehouseResponseDto> {
    const warehouse = await this.warehousesRepository.findByIdOrThrow(id);
    const stats = await this.warehousesRepository.statsFor([id]);

    return mapWarehouse(warehouse, stats.get(id));
  }

  async createWarehouse(
    dto: CreateInventoryWarehouseDto,
    adminUserId?: string,
  ): Promise<InventoryWarehouseResponseDto> {
    await this.assertWarehouseCodeFree(dto.code);

    const warehouse = await this.warehousesRepository.create({ ...dto, isActive: dto.isActive ?? true });

    await this.audit('inventory.warehouse.created', `Created warehouse ${warehouse.code}`, adminUserId, {
      warehouseId: warehouse.id,
    });
    await this.realtime.warehousesChanged([warehouse.id]);

    return await this.getWarehouse(warehouse.id);
  }

  async updateWarehouse(
    id: string,
    dto: UpdateInventoryWarehouseDto,
    adminUserId?: string,
  ): Promise<InventoryWarehouseResponseDto> {
    const current = await this.warehousesRepository.findByIdOrThrow(id);

    if (dto.code && dto.code.toLowerCase() !== current.code.toLowerCase()) {
      await this.assertWarehouseCodeFree(dto.code);
    }

    await this.warehousesRepository.update(id, dto);
    await this.audit('inventory.warehouse.updated', `Updated warehouse ${dto.code ?? current.code}`, adminUserId, {
      warehouseId: id,
    });
    await this.realtime.warehousesChanged([id]);

    return await this.getWarehouse(id);
  }

  /** Deletes a warehouse with its (empty) compartments and zero-quantity placements. */
  async deleteWarehouse(id: string, adminUserId?: string): Promise<void> {
    const warehouse = await this.warehousesRepository.findByIdOrThrow(id);

    if ((await this.warehousesRepository.totalQuantity(id)) > 0) {
      throw new ConflictException('Warehouse still holds stock; move or withdraw it first');
    }

    await this.warehousesRepository.delete(id);
    await this.audit('inventory.warehouse.deleted', `Deleted warehouse ${warehouse.code}`, adminUserId, {
      warehouseId: id,
    });
    this.realtime.warehouseRemoved(id);
  }

  private async assertWarehouseCodeFree(code: string): Promise<void> {
    if (await this.warehousesRepository.findByCode(code)) {
      throw new ConflictException(`Warehouse code ${code} is already in use`);
    }
  }

  // ---- Compartments ----

  async listCompartments(
    limit: number | undefined,
    offset: number | undefined,
    filters: { warehouseId?: string; search?: string; activeOnly?: boolean },
  ): Promise<PaginatedInventoryResponseDto<InventoryCompartmentResponseDto>> {
    if (filters.warehouseId) {
      await this.warehousesRepository.findByIdOrThrow(filters.warehouseId);
    }

    const page = inventoryPage(limit, offset);
    const { items, total } = await this.compartmentsRepository.findAll(page.limit, page.offset, filters);
    const stats = await this.compartmentsRepository.statsFor(items.map((compartment) => compartment.id));

    return { items: items.map((compartment) => mapCompartment(compartment, stats.get(compartment.id))), total };
  }

  async getCompartment(id: string): Promise<InventoryCompartmentResponseDto> {
    const compartment = await this.compartmentsRepository.findByIdOrThrow(id);
    const stats = await this.compartmentsRepository.statsFor([id]);

    return mapCompartment(compartment, stats.get(id));
  }

  async createCompartment(
    warehouseId: string,
    dto: CreateInventoryCompartmentDto,
    adminUserId?: string,
  ): Promise<InventoryCompartmentResponseDto> {
    const warehouse = await this.warehousesRepository.findByIdOrThrow(warehouseId);

    await this.assertCompartmentCodeFree(warehouseId, dto.code);

    const compartment = await this.compartmentsRepository.create({
      ...dto,
      warehouseId: warehouse.id,
      isActive: dto.isActive ?? true,
    });

    await this.audit(
      'inventory.compartment.created',
      `Created compartment ${warehouse.code}/${compartment.code}`,
      adminUserId,
      { warehouseId, compartmentId: compartment.id },
    );
    await this.realtime.locationsChanged([compartment.id]);

    return await this.getCompartment(compartment.id);
  }

  async updateCompartment(
    id: string,
    dto: UpdateInventoryCompartmentDto,
    adminUserId?: string,
  ): Promise<InventoryCompartmentResponseDto> {
    const current = await this.compartmentsRepository.findByIdOrThrow(id);

    if (dto.code && dto.code.toLowerCase() !== current.code.toLowerCase()) {
      await this.assertCompartmentCodeFree(current.warehouseId, dto.code);
    }

    await this.compartmentsRepository.update(id, dto);
    await this.audit('inventory.compartment.updated', `Updated compartment ${dto.code ?? current.code}`, adminUserId, {
      compartmentId: id,
    });
    await this.realtime.locationsChanged([id]);

    return await this.getCompartment(id);
  }

  /** Deletes an empty compartment (placements with quantity 0 go with it; documents keep their snapshot). */
  async deleteCompartment(id: string, adminUserId?: string): Promise<void> {
    const compartment = await this.compartmentsRepository.findByIdOrThrow(id);
    const stats = await this.compartmentsRepository.statsFor([id]);

    if ((stats.get(id)?.totalQuantity ?? 0) > 0) {
      throw new ConflictException('Compartment still holds stock; move or withdraw it first');
    }

    await this.compartmentsRepository.delete(id);
    await this.audit('inventory.compartment.deleted', `Deleted compartment ${compartment.code}`, adminUserId, {
      compartmentId: id,
      warehouseId: compartment.warehouseId,
    });
    this.realtime.compartmentRemoved(id, compartment.warehouseId);
    await this.realtime.warehousesChanged([compartment.warehouseId]);
  }

  private async assertCompartmentCodeFree(warehouseId: string, code: string): Promise<void> {
    if (await this.compartmentsRepository.findByCode(warehouseId, code)) {
      throw new ConflictException(`Compartment code ${code} already exists in this warehouse`);
    }
  }

  // ---- Placements ----

  async listCompartmentStock(
    compartmentId: string,
    limit?: number,
    offset?: number,
    search?: string,
  ): Promise<PaginatedInventoryResponseDto<InventoryStockResponseDto>> {
    await this.compartmentsRepository.findByIdOrThrow(compartmentId);

    const page = inventoryPage(limit, offset);
    const { items, total } = await this.stockRepository.findByCompartment(
      compartmentId,
      page.limit,
      page.offset,
      search,
    );

    return { items: items.map(mapStock), total };
  }

  async listArticleStock(
    articleId: string,
    limit?: number,
    offset?: number,
    filters: { search?: string; withStockOnly?: boolean } = {},
  ): Promise<PaginatedInventoryResponseDto<InventoryStockResponseDto>> {
    await this.articlesRepository.findByIdOrThrow(articleId);

    const page = inventoryPage(limit, offset);
    const { items, total } = await this.stockRepository.findByArticle(articleId, page.limit, page.offset, filters);

    return { items: items.map(mapStock), total };
  }

  async getPlacement(id: string): Promise<InventoryStockResponseDto> {
    return mapStock(await this.stockRepository.findByIdOrThrow(id));
  }

  /** Maps an article to a compartment with quantity 0 (idempotent). Stock arrives through a putaway. */
  async createPlacement(dto: CreateInventoryPlacementDto, adminUserId?: string): Promise<InventoryStockResponseDto> {
    const article = await this.articlesRepository.findByIdOrThrow(dto.articleId);
    const compartment = await this.compartmentsRepository.findByIdOrThrow(dto.compartmentId);

    if (!compartment.isActive || compartment.warehouse?.isActive === false) {
      throw new BadRequestException(`Compartment ${compartment.code} or its warehouse is inactive`);
    }

    const id = await this.stockRepository.ensurePlacement(compartment.id, article.id);

    await this.audit(
      'inventory.placement.created',
      `Mapped ${article.articleNumber} to ${compartment.code}`,
      adminUserId,
      { articleId: article.id, compartmentId: compartment.id, placementId: id },
    );
    await this.realtime.placementsChanged([{ compartmentId: compartment.id, articleId: article.id }]);
    await this.realtime.articlesChanged([article.id]);

    return await this.getPlacement(id);
  }

  /** Removes an empty placement (stock must be moved / withdrawn first). */
  async deletePlacement(id: string, adminUserId?: string): Promise<void> {
    const placement = await this.stockRepository.findByIdOrThrow(id);

    if (!(await this.stockRepository.deleteIfEmpty(id))) {
      throw new ConflictException('Placement still holds stock; move or withdraw it first');
    }

    await this.audit(
      'inventory.placement.deleted',
      `Unmapped ${placement.article?.articleNumber} from ${placement.compartment?.code}`,
      adminUserId,
      { placementId: id, articleId: placement.articleId, compartmentId: placement.compartmentId },
    );
    this.realtime.stockRemoved(id, placement.compartmentId, placement.articleId);
    await this.realtime.locationsChanged([placement.compartmentId]);
    await this.realtime.articlesChanged([placement.articleId]);
  }

  private async audit(
    process: string,
    message: string,
    adminUserId: string | undefined,
    context: Record<string, unknown>,
  ): Promise<void> {
    // Audit `userId` is the affected customer elsewhere; the acting admin goes into the context.
    await this.auditLog.log({ process, level: 'info', message, context: { ...context, adminUserId } });
  }
}
