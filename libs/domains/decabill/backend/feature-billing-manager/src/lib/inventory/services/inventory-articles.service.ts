import { parseSerialNumberInput } from '@forepath/shared/shared/util-barcode';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { SupplierProfilesRepository } from '../../repositories/supplier-profiles.repository';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { INVENTORY_SERIALS_PER_MOVEMENT_MAX, InventoryMovementReason } from '../constants/inventory.constants';
import type {
  CreateInventoryArticleDto,
  InventoryArticleResponseDto,
  InventorySummaryResponseDto,
  PaginatedInventoryResponseDto,
  UpdateInventoryArticleDto,
} from '../dto/inventory.dto';
import type { InventoryArticleEntity } from '../entities/inventory-article.entity';
import { InventoryArticlesRepository } from '../repositories/inventory-articles.repository';
import { InventoryCompartmentsRepository } from '../repositories/inventory-compartments.repository';
import { InventoryLendingsRepository } from '../repositories/inventory-lendings.repository';
import { InventoryNumberSequencesRepository } from '../repositories/inventory-number-sequences.repository';
import { InventoryStockRepository } from '../repositories/inventory-stock.repository';
import { InventoryWarehousesRepository } from '../repositories/inventory-warehouses.repository';
import { InventoryWithdrawalRequestsRepository } from '../repositories/inventory-withdrawal-requests.repository';
import { mapArticle } from '../utils/inventory-mappers';
import { inventoryPage } from '../utils/inventory-query.utils';

import { InventoryMovementsService } from './inventory-movements.service';
import { InventoryRealtimeNotifier } from './inventory-realtime-notifier.service';

type ArticleFields = Omit<UpdateInventoryArticleDto, 'name'> & { name?: string };

@Injectable()
export class InventoryArticlesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly articlesRepository: InventoryArticlesRepository,
    private readonly lendingsRepository: InventoryLendingsRepository,
    private readonly numberSequences: InventoryNumberSequencesRepository,
    private readonly compartmentsRepository: InventoryCompartmentsRepository,
    private readonly warehousesRepository: InventoryWarehousesRepository,
    private readonly stockRepository: InventoryStockRepository,
    private readonly requestsRepository: InventoryWithdrawalRequestsRepository,
    private readonly supplierProfilesRepository: SupplierProfilesRepository,
    private readonly movementsService: InventoryMovementsService,
    private readonly realtime: InventoryRealtimeNotifier,
    private readonly auditLog: BillingAuditLogService,
    private readonly notifications: BillingNotificationPublisher,
  ) {}

  async list(
    limit: number | undefined,
    offset: number | undefined,
    filters: { search?: string; activeOnly?: boolean; lowStockOnly?: boolean },
  ): Promise<PaginatedInventoryResponseDto<InventoryArticleResponseDto>> {
    const page = inventoryPage(limit, offset);
    const { items, total } = await this.articlesRepository.findAll(page.limit, page.offset, filters);

    return { items: await this.mapMany(items), total };
  }

  async get(id: string): Promise<InventoryArticleResponseDto> {
    const [mapped] = await this.mapMany([await this.articlesRepository.findByIdOrThrow(id)]);

    return mapped!;
  }

  /**
   * Creates an article with the next `ART-` number. Optional placements map it to compartments; a placement with a
   * quantity books a putaway (document) for it.
   */
  async create(dto: CreateInventoryArticleDto, adminUserId?: string): Promise<InventoryArticleResponseDto> {
    const { placements, ...fields } = dto;

    await this.validateReferences(fields);

    // Validate every placement target before anything is written.
    const compartments = await Promise.all(
      (placements ?? []).map((placement) => this.compartmentsRepository.findByIdOrThrow(placement.compartmentId)),
    );

    if (new Set(compartments.map((compartment) => compartment.id)).size !== compartments.length) {
      throw new BadRequestException('Each compartment may only be listed once');
    }

    this.assertInitialSerials(fields.serialTracking === true, placements ?? []);

    const { number, numberScope } = await this.numberSequences.nextArticleNumber();
    const article = await this.articlesRepository.create({
      ...this.toColumns(fields),
      serialTracking: fields.serialTracking === true,
      name: fields.name,
      articleNumber: number,
      numberScope,
    });

    await this.auditLog.log({
      process: 'inventory.article.created',
      level: 'info',
      message: `Created article ${article.articleNumber}`,
      context: { articleId: article.id, adminUserId },
    });

    for (const placement of placements ?? []) {
      if ((placement.quantity ?? 0) > 0) {
        await this.movementsService.putaway(
          {
            articleId: article.id,
            targetCompartmentId: placement.compartmentId,
            quantity: placement.quantity!,
            serialNumbers: placement.serialNumbers,
            reason: InventoryMovementReason.RECEIPT,
          },
          adminUserId,
        );
      } else {
        await this.stockRepository.ensurePlacement(placement.compartmentId, article.id);
      }
    }

    const response = await this.get(article.id);

    this.notifications.publish('article.created', { ...response });
    await this.realtime.articlesChanged([article.id]);

    if ((placements ?? []).length > 0) {
      await this.realtime.locationsChanged(compartments.map((compartment) => compartment.id));
      await this.realtime.placementsChanged(
        compartments.map((compartment) => ({ compartmentId: compartment.id, articleId: article.id })),
      );
    }

    return response;
  }

  async update(id: string, dto: UpdateInventoryArticleDto, adminUserId?: string): Promise<InventoryArticleResponseDto> {
    const current = await this.articlesRepository.findByIdOrThrow(id);

    await this.validateReferences(dto, current.id);

    if (dto.serialTracking !== undefined && dto.serialTracking !== current.serialTracking) {
      const switched = await this.dataSource.transaction((manager) =>
        this.articlesRepository.switchSerialTracking(manager, id, dto.serialTracking!),
      );

      if (!switched) {
        throw new ConflictException(
          'Serial tracking can only be switched while the article has no stock and nothing is on loan',
        );
      }
    }

    await this.articlesRepository.update(id, { ...this.toColumns(dto), ...(dto.name ? { name: dto.name } : {}) });
    await this.auditLog.log({
      process: 'inventory.article.updated',
      level: 'info',
      message: `Updated article ${current.articleNumber}`,
      context: { articleId: id, adminUserId },
    });

    const response = await this.get(id);

    this.notifications.publish('article.updated', { ...response });
    await this.realtime.articlesChanged([id]);

    return response;
  }

  /** Only articles without history may be deleted; others are deactivated instead (documents reference them). */
  async delete(id: string, adminUserId?: string): Promise<void> {
    const article = await this.articlesRepository.findByIdOrThrow(id);

    if (await this.articlesRepository.hasHistory(id)) {
      throw new ConflictException('Article has stock, movements or requests; deactivate it instead');
    }

    await this.articlesRepository.delete(id);
    await this.auditLog.log({
      process: 'inventory.article.deleted',
      level: 'info',
      message: `Deleted article ${article.articleNumber}`,
      context: { articleId: id, adminUserId },
    });
    this.notifications.publish('article.deleted', { id, articleNumber: article.articleNumber });
    this.realtime.articleRemoved(id);
  }

  async summary(): Promise<InventorySummaryResponseDto> {
    const [warehouses, compartments, articles, lowStock, pending, openLendings, overdueLendings] = await Promise.all([
      this.warehousesRepository.findAll(1, 0),
      this.compartmentsRepository.findAll(1, 0, {}),
      this.articlesRepository.findAll(1, 0, {}),
      this.articlesRepository.findAll(1, 0, { lowStockOnly: true, activeOnly: true }),
      this.requestsRepository.countPending(),
      this.lendingsRepository.countOpen(),
      this.lendingsRepository.countOverdue(),
    ]);

    return {
      warehouseCount: warehouses.total,
      compartmentCount: compartments.total,
      articleCount: articles.total,
      lowStockArticleCount: lowStock.total,
      pendingRequestCount: pending,
      openLendingCount: openLendings,
      overdueLendingCount: overdueLendings,
    };
  }

  /**
   * Initial placements of a new article are validated before anything is written: serial-tracked articles name
   * one serial number per unit put away (unique across all placements), others none.
   */
  private assertInitialSerials(
    serialTracking: boolean,
    placements: NonNullable<CreateInventoryArticleDto['placements']>,
  ): void {
    const seen = new Set<string>();

    for (const placement of placements) {
      const quantity = placement.quantity ?? 0;
      const given = (placement.serialNumbers ?? []).length > 0;

      if (!serialTracking) {
        if (given) {
          throw new BadRequestException('Serial numbers require serial tracking on the article');
        }

        continue;
      }

      const parsed = parseSerialNumberInput(placement.serialNumbers ?? [], {
        max: INVENTORY_SERIALS_PER_MOVEMENT_MAX,
      });

      if (parsed.serialNumbers.length !== quantity || (quantity === 0 && given)) {
        throw new BadRequestException(
          `Serial-tracked placements need one serial number per unit (${quantity} units, ${parsed.serialNumbers.length} serial numbers)`,
        );
      }

      for (const serial of parsed.serialNumbers) {
        if (seen.has(serial)) {
          throw new BadRequestException(`Serial number ${serial} is listed in more than one placement`);
        }

        seen.add(serial);
      }
    }
  }

  private async validateReferences(fields: ArticleFields, articleId?: string): Promise<void> {
    if (fields.supplierId) {
      // Tenant-scoped lookup: a foreign tenant's supplier is "not found".
      await this.supplierProfilesRepository.findByIdOrThrow(fields.supplierId);
    }

    if (fields.ean) {
      const existing = await this.articlesRepository.findByEan(fields.ean);

      if (existing && existing.id !== articleId) {
        throw new ConflictException(`EAN ${fields.ean} is already assigned to article ${existing.articleNumber}`);
      }
    }
  }

  private toColumns(fields: ArticleFields): Partial<InventoryArticleEntity> {
    const columns: Partial<InventoryArticleEntity> = {};
    const keys: Array<keyof ArticleFields> = [
      'description',
      'ean',
      'unit',
      'manufacturer',
      'manufacturerPartNumber',
      'supplierId',
      'supplierArticleNumber',
      'purchasePriceNet',
      'salesPriceNet',
      'currency',
      'taxCategory',
      'reorderPoint',
      'reorderQuantity',
      'weightKg',
      'lengthCm',
      'widthCm',
      'heightCm',
      'hsCode',
      'countryOfOrigin',
      'isActive',
    ];

    for (const key of keys) {
      if (fields[key] !== undefined) {
        (columns as Record<string, unknown>)[key] = fields[key];
      }
    }

    return columns;
  }

  private async mapMany(articles: InventoryArticleEntity[]): Promise<InventoryArticleResponseDto[]> {
    const ids = articles.map((article) => article.id);
    const totals = await this.articlesRepository.stockTotalsFor(ids);
    const requested = await this.articlesRepository.pendingRequestQuantityFor(ids);
    const lent = await this.articlesRepository.lentQuantityFor(ids);

    return articles.map((article) =>
      mapArticle(article, totals.get(article.id), requested.get(article.id) ?? 0, lent.get(article.id) ?? 0),
    );
  }
}
