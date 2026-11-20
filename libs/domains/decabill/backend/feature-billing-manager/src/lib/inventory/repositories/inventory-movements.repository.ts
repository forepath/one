import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import type { InventoryMovementType } from '../constants/inventory.constants';
import { InventoryMovementEntity } from '../entities/inventory-movement.entity';
import { inventoryLikeTerm } from '../utils/inventory-query.utils';

export interface InventoryMovementFilters {
  search?: string;
  type?: InventoryMovementType;
  articleId?: string;
  compartmentId?: string;
  warehouseId?: string;
  withdrawalRequestId?: string;
  lendingId?: string;
  /** Movements that moved this exact serial number (history of one unit; combine with `articleId`). */
  serialNumber?: string;
}

@Injectable()
export class InventoryMovementsRepository {
  constructor(
    @InjectRepository(InventoryMovementEntity)
    private readonly repository: Repository<InventoryMovementEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<InventoryMovementEntity> {
    const entity = await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });

    if (!entity) {
      throw new NotFoundException(`Inventory movement with ID ${id} not found`);
    }

    return entity;
  }

  async findAll(
    limit: number,
    offset: number,
    filters: InventoryMovementFilters,
  ): Promise<{ items: InventoryMovementEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('movement')
      .where('movement.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .orderBy('movement.createdAt', 'DESC')
      .addOrderBy('movement.documentNumber', 'DESC');

    if (filters.type) {
      qb.andWhere('movement.type = :type', { type: filters.type });
    }

    if (filters.articleId) {
      qb.andWhere('movement.article_id = :articleId', { articleId: filters.articleId });
    }

    if (filters.withdrawalRequestId) {
      qb.andWhere('movement.withdrawal_request_id = :requestId', { requestId: filters.withdrawalRequestId });
    }

    if (filters.lendingId) {
      qb.andWhere('movement.lending_id = :lendingId', { lendingId: filters.lendingId });
    }

    if (filters.serialNumber) {
      qb.andWhere('movement.serial_numbers @> CAST(:serial AS jsonb)', {
        serial: JSON.stringify([filters.serialNumber]),
      });
    }

    if (filters.compartmentId) {
      qb.andWhere(
        '(movement.source_compartment_id = :compartmentId OR movement.target_compartment_id = :compartmentId)',
        { compartmentId: filters.compartmentId },
      );
    }

    if (filters.warehouseId) {
      qb.andWhere(
        `(movement.snapshot -> 'source' ->> 'warehouseId' = :warehouseId
          OR movement.snapshot -> 'target' ->> 'warehouseId' = :warehouseId)`,
        { warehouseId: filters.warehouseId },
      );
    }

    if (filters.search?.trim()) {
      qb.andWhere(
        `(movement.document_number ILIKE :term
          OR movement.snapshot -> 'article' ->> 'articleNumber' ILIKE :term
          OR movement.snapshot -> 'article' ->> 'name' ILIKE :term
          OR COALESCE(movement.reference, '') ILIKE :term
          OR COALESCE(movement.serial_numbers::text, '') ILIKE :term
          OR COALESCE(movement.snapshot -> 'lending' ->> 'borrowerName', '') ILIKE :term
          OR CONCAT_WS(' / ', movement.snapshot -> 'source' ->> 'warehouseCode',
            movement.snapshot -> 'source' ->> 'compartmentCode') ILIKE :term
          OR CONCAT_WS(' / ', movement.snapshot -> 'target' ->> 'warehouseCode',
            movement.snapshot -> 'target' ->> 'compartmentCode') ILIKE :term)`,
        { term: inventoryLikeTerm(filters.search) },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  async insert(manager: EntityManager, dto: Partial<InventoryMovementEntity>): Promise<InventoryMovementEntity> {
    const repository = manager.getRepository(InventoryMovementEntity);

    return await repository.save(repository.create({ ...dto, tenantId: getRequiredTenantId() }));
  }

  async setPdfStorageKey(id: string, pdfStorageKey: string): Promise<void> {
    await this.repository.update({ id, tenantId: getRequiredTenantId() }, { pdfStorageKey });
  }

  /** Movements a compartment took part in (deletion guard is stock-based; this is informational). */
  async countForCompartment(compartmentId: string): Promise<number> {
    return await this.repository
      .createQueryBuilder('movement')
      .where('movement.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere(
        '(movement.source_compartment_id = :compartmentId OR movement.target_compartment_id = :compartmentId)',
        { compartmentId },
      )
      .getCount();
  }
}
