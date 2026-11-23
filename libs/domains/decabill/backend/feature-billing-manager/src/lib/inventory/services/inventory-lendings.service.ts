import { isAdministrativeRole, UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { CustomerProfilesRepository } from '../../repositories/customer-profiles.repository';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { InventoryLendingStatus, InventoryMovementType } from '../constants/inventory.constants';
import type {
  CreateInventoryLendingDto,
  InventoryLendingResponseDto,
  PaginatedInventoryResponseDto,
  ReturnInventoryLendingDto,
} from '../dto/inventory.dto';
import type { InventoryLendingEntity } from '../entities/inventory-lending.entity';
import type { InventoryLendingSnapshot, InventoryMovementEntity } from '../entities/inventory-movement.entity';
import { InventoryArticlesRepository } from '../repositories/inventory-articles.repository';
import { InventoryCompartmentsRepository } from '../repositories/inventory-compartments.repository';
import {
  type InventoryLendingFilters,
  InventoryLendingsRepository,
} from '../repositories/inventory-lendings.repository';
import { InventoryMovementsRepository } from '../repositories/inventory-movements.repository';
import { InventorySerialUnitsRepository } from '../repositories/inventory-serial-units.repository';
import { mapLending } from '../utils/inventory-mappers';
import { inventoryPage, inventoryToday } from '../utils/inventory-query.utils';

import { InventoryMovementsService } from './inventory-movements.service';
import { InventoryRealtimeNotifier } from './inventory-realtime-notifier.service';

interface Borrower {
  userId: string | null;
  name: string;
  email: string | null;
  customerNumber: string | null;
  kind: 'customer' | 'staff';
}

/**
 * Lendings: stock handed out on loan to a customer or a member of staff (`LND-…` document) and returned in one or
 * more steps (`RTN-…` documents). Serial-tracked articles lend and return named units; lent stock is no longer
 * on hand but stays tracked (article `lentQuantity`, unit status `lent`) until it comes back.
 */
@Injectable()
export class InventoryLendingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly lendingsRepository: InventoryLendingsRepository,
    private readonly articlesRepository: InventoryArticlesRepository,
    private readonly compartmentsRepository: InventoryCompartmentsRepository,
    private readonly movementsRepository: InventoryMovementsRepository,
    private readonly serialUnits: InventorySerialUnitsRepository,
    private readonly movementsService: InventoryMovementsService,
    private readonly usersRepository: UsersRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly realtime: InventoryRealtimeNotifier,
    private readonly auditLog: BillingAuditLogService,
    private readonly notifications: BillingNotificationPublisher,
  ) {}

  async list(
    limit: number | undefined,
    offset: number | undefined,
    filters: InventoryLendingFilters,
  ): Promise<PaginatedInventoryResponseDto<InventoryLendingResponseDto>> {
    const page = inventoryPage(limit, offset);
    const { items, total } = await this.lendingsRepository.findAll(page.limit, page.offset, filters);

    return { items: await Promise.all(items.map((lending) => this.toResponse(lending))), total };
  }

  async get(id: string): Promise<InventoryLendingResponseDto> {
    return await this.toResponse(await this.lendingsRepository.findByIdOrThrow(id));
  }

  /** Books the lending document and opens the lending in one transaction. */
  async lend(dto: CreateInventoryLendingDto, adminUserId?: string): Promise<InventoryLendingResponseDto> {
    // Tenant-scoped lookups before anything is written (unknown ids are "not found", never a constraint error).
    await this.articlesRepository.findByIdOrThrow(dto.articleId);
    await this.compartmentsRepository.findByIdOrThrow(dto.sourceCompartmentId);

    const borrower = await this.resolveBorrower(dto);

    if (dto.dueDate && dto.dueDate < inventoryToday()) {
      throw new BadRequestException('The due date must not be in the past');
    }

    if (dto.dueDate && Number.isNaN(Date.parse(`${dto.dueDate}T00:00:00Z`))) {
      throw new BadRequestException('dueDate must be a valid date');
    }

    const before = await this.movementsService.articleTotal(dto.articleId);
    const { lending, movement } = await this.dataSource.transaction(async (manager) => {
      const created = await this.lendingsRepository.insert(manager, {
        articleId: dto.articleId,
        quantity: dto.quantity,
        returnedQuantity: 0,
        status: InventoryLendingStatus.OPEN,
        borrowerUserId: borrower.userId,
        borrowerName: borrower.name,
        borrowerEmail: borrower.email,
        borrowerCustomerNumber: borrower.customerNumber,
        borrowerKind: borrower.kind,
        sourceCompartmentId: dto.sourceCompartmentId,
        dueDate: dto.dueDate ?? null,
        note: dto.note ?? null,
        lentByUserId: adminUserId ?? null,
      });
      const booked = await this.movementsService.book(manager, {
        type: InventoryMovementType.LENDING,
        articleId: dto.articleId,
        quantity: dto.quantity,
        sourceCompartmentId: dto.sourceCompartmentId,
        serialNumbers: dto.serialNumbers,
        reference: dto.reference,
        note: dto.note,
        performedByUserId: adminUserId ?? null,
        lendingId: created.id,
        lendingSnapshot: this.snapshot(borrower, dto.dueDate ?? null, null),
      });

      // The lending carries its document number; the snapshot of its own document names it too.
      booked.snapshot.lending = this.snapshot(borrower, dto.dueDate ?? null, booked.documentNumber);
      await manager.query(`UPDATE billing_inventory_movements SET snapshot = $2 WHERE id = $1`, [
        booked.id,
        JSON.stringify(booked.snapshot),
      ]);
      await this.lendingsRepository.update(manager, created.id, { documentNumber: booked.documentNumber });

      return { lending: created, movement: booked };
    });

    await this.movementsService.afterCommit([movement], { [dto.articleId]: before });

    const response = await this.get(lending.id);

    await this.auditLog.log({
      process: 'inventory.lending.created',
      level: 'info',
      message: `Lent ${response.quantity} × ${response.article.articleNumber} to ${borrower.name} (${movement.documentNumber})`,
      userId: borrower.userId ?? undefined,
      context: {
        lendingId: lending.id,
        movementId: movement.id,
        borrowerKind: borrower.kind,
        serialNumbers: movement.serialNumbers ?? [],
        adminUserId,
      },
    });
    this.notifications.publish('inventory_lending.created', { ...response });
    this.realtime.lendingChanged(response);

    return response;
  }

  /** Books a return document into the target compartment; the lending closes once everything is back. */
  async returnLending(
    id: string,
    dto: ReturnInventoryLendingDto,
    adminUserId?: string,
  ): Promise<InventoryLendingResponseDto> {
    const lending = await this.lendingsRepository.findByIdOrThrow(id);

    if (lending.status !== InventoryLendingStatus.OPEN) {
      throw new ConflictException('Lending was already returned');
    }

    const before = await this.movementsService.articleTotal(lending.articleId);
    const movement = await this.dataSource.transaction(async (manager) => {
      // Re-read under lock: concurrent returns must not exceed the lent quantity.
      const locked = await this.lendingsRepository.lockOpen(manager, id);

      if (!locked) {
        throw new ConflictException('Lending was already returned');
      }

      const outstandingMilli = Math.round((locked.quantity - locked.returnedQuantity) * 1000);
      const returningMilli = Math.round(dto.quantity * 1000);

      if (returningMilli > outstandingMilli) {
        throw new BadRequestException(
          `Only ${outstandingMilli / 1000} ${lending.article?.unit ?? ''} are still on loan`,
        );
      }

      const booked = await this.movementsService.book(manager, {
        type: InventoryMovementType.LENDING_RETURN,
        articleId: lending.articleId,
        quantity: dto.quantity,
        targetCompartmentId: dto.targetCompartmentId,
        serialNumbers: dto.serialNumbers,
        reference: dto.reference,
        note: dto.note,
        performedByUserId: adminUserId ?? null,
        lendingId: lending.id,
        lendingSnapshot: this.snapshot(
          this.borrowerOf(lending),
          lending.dueDate ?? null,
          lending.documentNumber ?? null,
        ),
      });
      const returnedMilli = Math.round(locked.returnedQuantity * 1000) + returningMilli;
      const complete = returnedMilli === Math.round(locked.quantity * 1000);

      await this.lendingsRepository.update(manager, id, {
        returnedQuantity: returnedMilli / 1000,
        ...(complete ? { status: InventoryLendingStatus.RETURNED, returnedAt: new Date() } : {}),
      });

      return booked;
    });

    await this.movementsService.afterCommit([movement], { [lending.articleId]: before });

    const response = await this.get(id);

    await this.auditLog.log({
      process: 'inventory.lending.returned',
      level: 'info',
      message: `Returned ${Number(movement.quantity)} × ${response.article.articleNumber} from ${response.borrower.name} (${movement.documentNumber})`,
      userId: response.borrower.userId ?? undefined,
      context: {
        lendingId: id,
        movementId: movement.id,
        serialNumbers: movement.serialNumbers ?? [],
        complete: response.status === InventoryLendingStatus.RETURNED,
        adminUserId,
      },
    });
    this.notifications.publish('inventory_lending.returned', { ...response, returnMovementId: movement.id });
    this.realtime.lendingChanged(response);

    return response;
  }

  private async resolveBorrower(dto: CreateInventoryLendingDto): Promise<Borrower> {
    const hasUser = Boolean(dto.borrowerUserId);
    const hasName = Boolean(dto.borrowerName?.trim());

    if (hasUser === hasName) {
      throw new BadRequestException('Name either a borrower account (borrowerUserId) or a borrower (borrowerName)');
    }

    if (!hasUser) {
      return { userId: null, name: dto.borrowerName!.trim(), email: null, customerNumber: null, kind: 'staff' };
    }

    // Tenant-scoped lookup: another tenant's user is "not found".
    const user = await this.usersRepository.findByIdForTenant(dto.borrowerUserId!);

    if (!user) {
      throw new NotFoundException(`User with ID ${dto.borrowerUserId} not found`);
    }

    const profile = await this.customerProfilesRepository.findByUserId(user.id);
    const profileName = profile
      ? profile.company?.trim() || [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || null
      : null;

    return {
      userId: user.id,
      name: profileName ?? user.email,
      email: user.email ?? null,
      customerNumber: profile?.customerNumber ?? null,
      kind: isAdministrativeRole(user.role) ? 'staff' : 'customer',
    };
  }

  private borrowerOf(lending: InventoryLendingEntity): Borrower {
    return {
      userId: lending.borrowerUserId ?? null,
      name: lending.borrowerName,
      email: lending.borrowerEmail ?? null,
      customerNumber: lending.borrowerCustomerNumber ?? null,
      kind: lending.borrowerKind,
    };
  }

  private snapshot(
    borrower: Borrower,
    dueDate: string | null,
    documentNumber: string | null,
  ): InventoryLendingSnapshot {
    return {
      documentNumber,
      borrowerName: borrower.name,
      borrowerEmail: borrower.email,
      borrowerCustomerNumber: borrower.customerNumber,
      borrowerKind: borrower.kind,
      dueDate,
    };
  }

  private async toResponse(lending: InventoryLendingEntity): Promise<InventoryLendingResponseDto> {
    const [serials, movements] = await Promise.all([
      this.serialUnits.serialNumbersWhere({ lendingId: lending.id }),
      this.movementsRepository.findAll(100, 0, { lendingId: lending.id }),
    ]);

    return mapLending(lending, {
      outstandingSerialNumbers: serials,
      movementIds: [...movements.items]
        .sort((a: InventoryMovementEntity, b: InventoryMovementEntity) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((movement) => movement.id),
    });
  }
}
