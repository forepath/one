import { UsersRepository } from '@forepath/identity/backend';
import { parseSerialNumberInput } from '@forepath/shared/shared/util-barcode';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import {
  INVENTORY_MOVEMENT_DOCUMENT,
  INVENTORY_MOVEMENTS_WITH_SOURCE,
  INVENTORY_MOVEMENTS_WITH_TARGET,
  INVENTORY_SERIALS_PER_MOVEMENT_MAX,
  InventoryMovementReason,
  InventoryMovementType,
  InventorySerialUnitStatus,
} from '../constants/inventory.constants';
import type {
  InventoryMovementResponseDto,
  InventoryPutawayDto,
  InventoryTransferDto,
  InventoryWithdrawalDto,
  PaginatedInventoryResponseDto,
} from '../dto/inventory.dto';
import type { InventoryArticleEntity } from '../entities/inventory-article.entity';
import type { InventoryCompartmentEntity } from '../entities/inventory-compartment.entity';
import type {
  InventoryLendingSnapshot,
  InventoryMovementEntity,
  InventoryMovementLocationSnapshot,
  InventoryMovementSnapshot,
} from '../entities/inventory-movement.entity';
import { InventoryArticlesRepository } from '../repositories/inventory-articles.repository';
import { InventoryCompartmentsRepository } from '../repositories/inventory-compartments.repository';
import {
  type InventoryMovementFilters,
  InventoryMovementsRepository,
} from '../repositories/inventory-movements.repository';
import { InventoryNumberSequencesRepository } from '../repositories/inventory-number-sequences.repository';
import {
  type LockedSerialUnit,
  InventorySerialUnitsRepository,
} from '../repositories/inventory-serial-units.repository';
import { InventoryStockRepository } from '../repositories/inventory-stock.repository';
import { mapMovement } from '../utils/inventory-mappers';
import { inventoryPage } from '../utils/inventory-query.utils';

import { InventoryMovementPdfService } from './inventory-movement-pdf.service';
import { InventoryRealtimeNotifier } from './inventory-realtime-notifier.service';

/** Thousandths: quantities are numeric(14,3); integer math avoids float drift. */
function toMilli(value: number | string): number {
  return Math.round(Number(value) * 1000);
}

function fromMilli(value: number): number {
  return value / 1000;
}

export interface BookMovementParams {
  type: InventoryMovementType;
  articleId: string;
  quantity: number;
  sourceCompartmentId?: string | null;
  targetCompartmentId?: string | null;
  reason?: InventoryMovementReason | null;
  reference?: string | null;
  note?: string | null;
  performedByUserId?: string | null;
  withdrawalRequestId?: string | null;
  requestSnapshot?: InventoryMovementSnapshot['request'];
  /** Serial-tracked articles: the units moved (singles and ranges). */
  serialNumbers?: string[] | null;
  /** `lending` / `lending_return`: the lending the movement belongs to. */
  lendingId?: string | null;
  lendingSnapshot?: InventoryLendingSnapshot | null;
}

/** At most this many serial numbers are named in an error message. */
const SERIALS_IN_MESSAGES = 10;

function listSerials(serials: string[]): string {
  return serials.length > SERIALS_IN_MESSAGES
    ? `${serials.slice(0, SERIALS_IN_MESSAGES).join(', ')} and ${serials.length - SERIALS_IN_MESSAGES} more`
    : serials.join(', ');
}

/**
 * Books stock movements. Every movement locks the involved placements, changes their quantities, allocates its
 * document number in the same transaction (rolled back movements release their number) and, after commit, renders
 * and archives its document, announces the change live and records audit log + webhook.
 */
@Injectable()
export class InventoryMovementsService {
  private readonly logger = new Logger(InventoryMovementsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly movementsRepository: InventoryMovementsRepository,
    private readonly stockRepository: InventoryStockRepository,
    private readonly articlesRepository: InventoryArticlesRepository,
    private readonly compartmentsRepository: InventoryCompartmentsRepository,
    private readonly numberSequences: InventoryNumberSequencesRepository,
    private readonly serialUnits: InventorySerialUnitsRepository,
    private readonly pdfService: InventoryMovementPdfService,
    private readonly usersRepository: UsersRepository,
    private readonly realtime: InventoryRealtimeNotifier,
    private readonly auditLog: BillingAuditLogService,
    private readonly notifications: BillingNotificationPublisher,
  ) {}

  async list(
    limit: number | undefined,
    offset: number | undefined,
    filters: InventoryMovementFilters,
  ): Promise<PaginatedInventoryResponseDto<InventoryMovementResponseDto>> {
    const page = inventoryPage(limit, offset);
    const { items, total } = await this.movementsRepository.findAll(page.limit, page.offset, filters);

    return { items: items.map(mapMovement), total };
  }

  async get(id: string): Promise<InventoryMovementResponseDto> {
    return mapMovement(await this.movementsRepository.findByIdOrThrow(id));
  }

  /** Archived document; a missing or unreadable file is rendered and archived again (like offers / invoices). */
  async getPdf(id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const movement = await this.movementsRepository.findByIdOrThrow(id);
    const fileName = `${movement.documentNumber}.pdf`;

    if (movement.pdfStorageKey && process.env.BILLING_SKIP_FILE_CACHE !== 'true') {
      try {
        return { buffer: await this.pdfService.readPdf(movement.pdfStorageKey), fileName };
      } catch {
        // Missing file: regenerate below.
      }
    }

    const storageKey = await this.pdfService.generateAndStore(movement);

    await this.movementsRepository.setPdfStorageKey(movement.id, storageKey);

    return { buffer: await this.pdfService.readPdf(storageKey), fileName };
  }

  async putaway(dto: InventoryPutawayDto, performedByUserId?: string): Promise<InventoryMovementResponseDto> {
    return await this.bookOne({
      type: InventoryMovementType.PUTAWAY,
      articleId: dto.articleId,
      quantity: dto.quantity,
      targetCompartmentId: dto.targetCompartmentId,
      serialNumbers: dto.serialNumbers,
      reason: dto.reason ?? InventoryMovementReason.RECEIPT,
      reference: dto.reference,
      note: dto.note,
      performedByUserId,
    });
  }

  async transfer(dto: InventoryTransferDto, performedByUserId?: string): Promise<InventoryMovementResponseDto> {
    if (dto.sourceCompartmentId === dto.targetCompartmentId) {
      throw new BadRequestException('Source and target compartment must differ');
    }

    return await this.bookOne({
      type: InventoryMovementType.TRANSFER,
      articleId: dto.articleId,
      quantity: dto.quantity,
      sourceCompartmentId: dto.sourceCompartmentId,
      targetCompartmentId: dto.targetCompartmentId,
      serialNumbers: dto.serialNumbers,
      reference: dto.reference,
      note: dto.note,
      performedByUserId,
    });
  }

  async withdraw(dto: InventoryWithdrawalDto, performedByUserId?: string): Promise<InventoryMovementResponseDto> {
    return await this.bookOne({
      type: InventoryMovementType.WITHDRAWAL,
      articleId: dto.articleId,
      quantity: dto.quantity,
      sourceCompartmentId: dto.sourceCompartmentId,
      serialNumbers: dto.serialNumbers,
      reason: dto.reason ?? InventoryMovementReason.OTHER,
      reference: dto.reference,
      note: dto.note,
      performedByUserId,
    });
  }

  private async bookOne(params: BookMovementParams): Promise<InventoryMovementResponseDto> {
    const before = await this.articleTotal(params.articleId);
    const movement = await this.dataSource.transaction((manager) => this.book(manager, params));

    await this.afterCommit([movement], { [params.articleId]: before });

    return mapMovement(movement);
  }

  /** On-hand total before a booking (low-stock transition detection). */
  async articleTotal(articleId: string): Promise<number> {
    return (await this.articlesRepository.stockTotalsFor([articleId])).get(articleId)?.totalQuantity ?? 0;
  }

  /**
   * Books one movement inside the caller's transaction. Callers must run {@link afterCommit} with the returned
   * movements once the transaction committed.
   */
  async book(manager: EntityManager, params: BookMovementParams): Promise<InventoryMovementEntity> {
    const quantityMilli = toMilli(params.quantity);

    if (!Number.isFinite(quantityMilli) || quantityMilli <= 0) {
      throw new BadRequestException('Quantity must be greater than zero');
    }

    const article = await this.articlesRepository.findByIdOrThrow(params.articleId);
    // The flag as of this transaction (a concurrent switch waits for the booking, or the booking for the switch).
    const { serialTracking } = await this.articlesRepository.lockForBooking(manager, article.id);
    const source = params.sourceCompartmentId
      ? await this.compartmentsRepository.findByIdOrThrow(params.sourceCompartmentId)
      : null;
    const target = params.targetCompartmentId
      ? await this.compartmentsRepository.findByIdOrThrow(params.targetCompartmentId)
      : null;

    this.assertBookable(params.type, article, source, target);

    const serials = this.resolveSerials(article, serialTracking, params.serialNumbers, quantityMilli);
    const sourcePlacement = source ? await this.stockRepository.findPlacement(source.id, article.id) : null;

    if (source && !sourcePlacement) {
      throw new BadRequestException(`Article ${article.articleNumber} is not stored in compartment ${source.code}`);
    }

    const targetPlacementId = target
      ? await this.stockRepository.ensurePlacement(target.id, article.id, manager)
      : null;
    const locked = await this.stockRepository.lockPlacements(
      manager,
      [sourcePlacement?.id, targetPlacementId].filter((id): id is string => Boolean(id)),
    );
    // Named units are checked before any quantity changes: nothing moves unless every serial number matches.
    const units = serials ? await this.serialUnits.lockForArticle(manager, article.id, serials) : null;

    if (serials && units) {
      this.assertSerialsAvailable(params, serials, units, source);
    }

    let sourceAfter: number | null = null;
    let targetAfter: number | null = null;

    if (sourcePlacement) {
      const current = locked.get(sourcePlacement.id);

      if (!current) {
        throw new ConflictException('Stock placement changed concurrently; please retry');
      }

      const remaining = toMilli(current.quantity) - quantityMilli;

      if (remaining < 0) {
        throw new BadRequestException(
          `Insufficient stock in ${source!.code}: ${fromMilli(toMilli(current.quantity))} ${article.unit} available`,
        );
      }

      sourceAfter = fromMilli(remaining);
      await this.stockRepository.setQuantity(manager, sourcePlacement.id, sourceAfter);
    }

    if (targetPlacementId) {
      const current = locked.get(targetPlacementId);

      if (!current) {
        throw new ConflictException('Stock placement changed concurrently; please retry');
      }

      targetAfter = fromMilli(toMilli(current.quantity) + quantityMilli);
      await this.stockRepository.setQuantity(manager, targetPlacementId, targetAfter);
    }

    const createdAt = new Date();
    const { number, numberScope } = await this.numberSequences.nextDocumentNumber(
      INVENTORY_MOVEMENT_DOCUMENT[params.type].prefix,
      createdAt.getUTCFullYear(),
      manager,
    );
    const performedBy = params.performedByUserId
      ? await this.usersRepository.findByIdForTenant(params.performedByUserId)
      : null;
    const movement = await this.movementsRepository.insert(manager, {
      type: params.type,
      documentNumber: number,
      numberScope,
      articleId: article.id,
      quantity: fromMilli(quantityMilli),
      reason: params.reason ?? null,
      sourceCompartmentId: source?.id ?? null,
      targetCompartmentId: target?.id ?? null,
      sourceQuantityAfter: sourceAfter,
      targetQuantityAfter: targetAfter,
      reference: params.reference ?? null,
      note: params.note ?? null,
      withdrawalRequestId: params.withdrawalRequestId ?? null,
      serialNumbers: serials,
      lendingId: params.lendingId ?? null,
      performedByUserId: params.performedByUserId ?? null,
      createdAt,
      snapshot: {
        article: {
          articleNumber: article.articleNumber,
          name: article.name,
          ean: article.ean ?? null,
          unit: article.unit,
        },
        source: source ? locationSnapshot(source) : null,
        target: target ? locationSnapshot(target) : null,
        performedByEmail: performedBy?.email ?? null,
        request: params.requestSnapshot ?? null,
        lending: params.lendingSnapshot ?? null,
      },
    });

    if (serials && units) {
      await this.moveSerialUnits(manager, params, article.id, serials, units, target, movement.id);
    }

    return movement;
  }

  /**
   * Expanded serial numbers of a booking (null for articles without serial tracking). Serial-tracked articles move
   * whole, named units: the count must equal the quantity.
   */
  private resolveSerials(
    article: InventoryArticleEntity,
    serialTracking: boolean,
    input: string[] | null | undefined,
    quantityMilli: number,
  ): string[] | null {
    const given = (input ?? []).length > 0;

    if (!serialTracking) {
      if (given) {
        throw new BadRequestException(`Article ${article.articleNumber} does not track serial numbers`);
      }

      return null;
    }

    const parsed = parseSerialNumberInput(input ?? [], { max: INVENTORY_SERIALS_PER_MOVEMENT_MAX });

    if (parsed.errors.length > 0) {
      throw new BadRequestException(
        `Invalid serial numbers: ${listSerials(parsed.errors.map((error) => `${error.token} (${error.code})`))}`,
      );
    }

    if (parsed.serialNumbers.length === 0) {
      throw new BadRequestException(`Article ${article.articleNumber} requires serial numbers`);
    }

    if (parsed.serialNumbers.length * 1000 !== quantityMilli) {
      throw new BadRequestException(
        `Quantity (${fromMilli(quantityMilli)}) must equal the number of serial numbers (${parsed.serialNumbers.length})`,
      );
    }

    return parsed.serialNumbers;
  }

  /** Every named unit must be where the movement takes it from; nothing is moved unless all of them match. */
  private assertSerialsAvailable(
    params: BookMovementParams,
    serials: string[],
    units: Map<string, LockedSerialUnit>,
    source: InventoryCompartmentEntity | null,
  ): void {
    if (params.type === InventoryMovementType.PUTAWAY) {
      const tracked = serials.filter((serial) => {
        const unit = units.get(serial);

        return unit && unit.status !== InventorySerialUnitStatus.WITHDRAWN;
      });

      if (tracked.length > 0) {
        throw new ConflictException(`Serial numbers already in stock or on loan: ${listSerials(tracked)}`);
      }

      return;
    }

    if (params.type === InventoryMovementType.LENDING_RETURN) {
      const notLent = serials.filter((serial) => {
        const unit = units.get(serial);

        return (
          !unit ||
          unit.status !== InventorySerialUnitStatus.LENT ||
          !params.lendingId ||
          unit.lendingId !== params.lendingId
        );
      });

      if (notLent.length > 0) {
        throw new BadRequestException(`Serial numbers not on this lending: ${listSerials(notLent)}`);
      }

      return;
    }

    const missing = serials.filter((serial) => {
      const unit = units.get(serial);

      return !unit || unit.status !== InventorySerialUnitStatus.IN_STOCK || unit.compartmentId !== source?.id;
    });

    if (missing.length > 0) {
      throw new BadRequestException(`Serial numbers not in stock in ${source?.code ?? '?'}: ${listSerials(missing)}`);
    }
  }

  private async moveSerialUnits(
    manager: EntityManager,
    params: BookMovementParams,
    articleId: string,
    serials: string[],
    units: Map<string, LockedSerialUnit>,
    target: InventoryCompartmentEntity | null,
    movementId: string,
  ): Promise<void> {
    const existingIds = serials.map((serial) => units.get(serial)?.id).filter((id): id is string => Boolean(id));

    switch (params.type) {
      case InventoryMovementType.PUTAWAY: {
        const fresh = serials.filter((serial) => !units.has(serial));
        const inserted = await this.serialUnits.insertInStock(manager, articleId, fresh, target!.id, movementId);

        if (inserted !== fresh.length) {
          throw new ConflictException('Serial numbers were registered concurrently; please retry');
        }

        // Withdrawn units come back into stock (history continues on the same unit).
        await this.serialUnits.updateUnits(manager, existingIds, {
          status: InventorySerialUnitStatus.IN_STOCK,
          compartmentId: target!.id,
          lendingId: null,
          lastMovementId: movementId,
        });
        break;
      }

      case InventoryMovementType.TRANSFER:
      case InventoryMovementType.LENDING_RETURN:
        await this.serialUnits.updateUnits(manager, existingIds, {
          status: InventorySerialUnitStatus.IN_STOCK,
          compartmentId: target!.id,
          lendingId: null,
          lastMovementId: movementId,
        });
        break;
      case InventoryMovementType.WITHDRAWAL:
        await this.serialUnits.updateUnits(manager, existingIds, {
          status: InventorySerialUnitStatus.WITHDRAWN,
          compartmentId: null,
          lendingId: null,
          lastMovementId: movementId,
        });
        break;
      case InventoryMovementType.LENDING:
        await this.serialUnits.updateUnits(manager, existingIds, {
          status: InventorySerialUnitStatus.LENT,
          compartmentId: null,
          lendingId: params.lendingId ?? null,
          lastMovementId: movementId,
        });
        break;
    }
  }

  private assertBookable(
    type: InventoryMovementType,
    article: InventoryArticleEntity,
    source: InventoryCompartmentEntity | null,
    target: InventoryCompartmentEntity | null,
  ): void {
    const needsSource = INVENTORY_MOVEMENTS_WITH_SOURCE.includes(type);
    const needsTarget = INVENTORY_MOVEMENTS_WITH_TARGET.includes(type);

    if (needsSource !== Boolean(source) || needsTarget !== Boolean(target)) {
      throw new BadRequestException(`Invalid compartments for a ${type}`);
    }

    if (source && target && source.id === target.id) {
      throw new BadRequestException('Source and target compartment must differ');
    }

    // New stock only goes to active articles and active locations; stock can always leave.
    if (target && (!target.isActive || target.warehouse?.isActive === false)) {
      throw new BadRequestException(`Compartment ${target.code} or its warehouse is inactive`);
    }

    if (type === InventoryMovementType.PUTAWAY && !article.isActive) {
      throw new BadRequestException(`Article ${article.articleNumber} is inactive`);
    }
  }

  /**
   * Post-commit work of booked movements: archive documents (failures are logged; the PDF endpoint regenerates),
   * live updates, audit log, webhooks and low-stock notifications.
   */
  async afterCommit(movements: InventoryMovementEntity[], totalsBefore: Record<string, number>): Promise<void> {
    for (const movement of movements) {
      try {
        const storageKey = await this.pdfService.generateAndStore(movement);

        await this.movementsRepository.setPdfStorageKey(movement.id, storageKey);
        movement.pdfStorageKey = storageKey;
      } catch (error) {
        this.logger.error(
          `Archiving inventory document ${movement.documentNumber} failed: ${(error as Error).message}`,
        );
      }

      await this.auditLog.log({
        process: `inventory.movement.${movement.type}`,
        level: 'info',
        message: `Booked ${movement.type} ${movement.documentNumber}`,
        correlationId: movement.withdrawalRequestId ? `inventory-request:${movement.withdrawalRequestId}` : undefined,
        context: {
          movementId: movement.id,
          documentNumber: movement.documentNumber,
          articleId: movement.articleId,
          quantity: Number(movement.quantity),
          sourceCompartmentId: movement.sourceCompartmentId,
          targetCompartmentId: movement.targetCompartmentId,
          withdrawalRequestId: movement.withdrawalRequestId,
          adminUserId: movement.performedByUserId,
        },
      });

      const response = mapMovement(movement);

      this.notifications.publish('inventory_movement.created', { ...response });
      this.realtime.movementCreated(response);
    }

    await this.realtime.locationsChanged(
      movements.flatMap((movement) =>
        [movement.sourceCompartmentId, movement.targetCompartmentId].filter((id): id is string => Boolean(id)),
      ),
    );
    await this.realtime.placementsChanged(
      movements.flatMap((movement) =>
        [movement.sourceCompartmentId, movement.targetCompartmentId]
          .filter((id): id is string => Boolean(id))
          .map((compartmentId) => ({ compartmentId, articleId: movement.articleId })),
      ),
    );

    const articleIds = [...new Set(movements.map((movement) => movement.articleId))];

    this.realtime.serialUnitsChanged(
      movements.filter((movement) => (movement.serialNumbers ?? []).length > 0).map((movement) => movement.articleId),
    );
    const articles = await this.realtime.articlesChanged(articleIds);

    for (const article of articles) {
      const before = totalsBefore[article.id];

      if (
        article.reorderPoint !== null &&
        before !== undefined &&
        before > article.reorderPoint &&
        article.totalQuantity <= article.reorderPoint
      ) {
        this.notifications.publish('article.low_stock', {
          id: article.id,
          articleNumber: article.articleNumber,
          name: article.name,
          totalQuantity: article.totalQuantity,
          reorderPoint: article.reorderPoint,
          reorderQuantity: article.reorderQuantity,
        });
      }
    }
  }
}

function locationSnapshot(compartment: InventoryCompartmentEntity): InventoryMovementLocationSnapshot {
  if (!compartment.warehouse) {
    throw new NotFoundException(`Warehouse of compartment ${compartment.code} not found`);
  }

  return {
    warehouseId: compartment.warehouse.id,
    warehouseCode: compartment.warehouse.code,
    warehouseName: compartment.warehouse.name,
    compartmentId: compartment.id,
    compartmentCode: compartment.code,
    compartmentName: compartment.name ?? null,
  };
}
