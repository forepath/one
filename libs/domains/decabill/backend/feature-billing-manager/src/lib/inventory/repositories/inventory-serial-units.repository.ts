import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { InventorySerialUnitStatus } from '../constants/inventory.constants';
import { InventorySerialUnitEntity } from '../entities/inventory-serial-unit.entity';
import { inventoryLikeTerm } from '../utils/inventory-query.utils';

/** Unit row as read under lock while booking a movement. */
export interface LockedSerialUnit {
  id: string;
  serialNumber: string;
  status: InventorySerialUnitStatus;
  compartmentId: string | null;
  lendingId: string | null;
}

export interface InventorySerialUnitFilters {
  articleId?: string;
  status?: InventorySerialUnitStatus;
  statuses?: InventorySerialUnitStatus[];
  compartmentId?: string;
  lendingId?: string;
  ids?: string[];
  search?: string;
}

@Injectable()
export class InventorySerialUnitsRepository {
  constructor(
    @InjectRepository(InventorySerialUnitEntity)
    private readonly repository: Repository<InventorySerialUnitEntity>,
  ) {}

  /** Paged units with their article, location and lending (for lists, pickers and labels). */
  async findAll(
    limit: number,
    offset: number,
    filters: InventorySerialUnitFilters,
  ): Promise<{ items: InventorySerialUnitEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('unit')
      .innerJoinAndSelect('unit.article', 'article')
      .leftJoinAndSelect('unit.compartment', 'compartment')
      .leftJoinAndSelect('compartment.warehouse', 'warehouse')
      .leftJoinAndSelect('unit.lending', 'lending')
      .where('unit.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      // Property names (paginated join query); serial numbers sort like their notation.
      .orderBy('unit.serialNumber', 'ASC')
      .addOrderBy('unit.id', 'ASC');

    if (filters.articleId) {
      qb.andWhere('unit.article_id = :articleId', { articleId: filters.articleId });
    }

    if (filters.status) {
      qb.andWhere('unit.status = :status', { status: filters.status });
    }

    if (filters.statuses?.length) {
      qb.andWhere('unit.status IN (:...statuses)', { statuses: filters.statuses });
    }

    if (filters.compartmentId) {
      qb.andWhere('unit.compartment_id = :compartmentId', { compartmentId: filters.compartmentId });
    }

    if (filters.lendingId) {
      qb.andWhere('unit.lending_id = :lendingId', { lendingId: filters.lendingId });
    }

    if (filters.ids) {
      if (filters.ids.length === 0) {
        return { items: [], total: 0 };
      }

      qb.andWhere('unit.id IN (:...ids)', { ids: filters.ids });
    }

    if (filters.search?.trim()) {
      qb.andWhere(
        `(unit.serial_number ILIKE :term OR article.article_number ILIKE :term OR article.name ILIKE :term
          OR COALESCE(lending.borrower_name, '') ILIKE :term OR COALESCE(lending.document_number, '') ILIKE :term)`,
        { term: inventoryLikeTerm(filters.search) },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  /** Serial numbers in a compartment / on a lending, without paging (lending responses, documents). */
  async serialNumbersWhere(filters: { lendingId: string }): Promise<string[]> {
    const rows: Array<{ serial_number: string }> = await this.repository.query(
      `SELECT serial_number FROM billing_inventory_serial_units
       WHERE tenant_id = $1 AND lending_id = $2 ORDER BY serial_number`,
      [getRequiredTenantId(), filters.lendingId],
    );

    return rows.map((row) => row.serial_number);
  }

  /** Row-locks the article's units with these serial numbers (missing ones are simply absent). */
  async lockForArticle(
    manager: EntityManager,
    articleId: string,
    serialNumbers: string[],
  ): Promise<Map<string, LockedSerialUnit>> {
    const rows: Array<{
      id: string;
      serial_number: string;
      status: InventorySerialUnitStatus;
      compartment_id: string | null;
      lending_id: string | null;
    }> = await manager.query(
      `SELECT id, serial_number, status, compartment_id, lending_id
       FROM billing_inventory_serial_units
       WHERE tenant_id = $1 AND article_id = $2 AND serial_number = ANY($3::text[])
       ORDER BY id FOR UPDATE`,
      [getRequiredTenantId(), articleId, serialNumbers],
    );

    return new Map(
      rows.map((row) => [
        row.serial_number,
        {
          id: row.id,
          serialNumber: row.serial_number,
          status: row.status,
          compartmentId: row.compartment_id,
          lendingId: row.lending_id,
        },
      ]),
    );
  }

  /**
   * Registers new units in stock. Returns how many were inserted: fewer than requested means a concurrent putaway
   * registered one of them first (the caller rolls back).
   */
  async insertInStock(
    manager: EntityManager,
    articleId: string,
    serialNumbers: string[],
    compartmentId: string,
    movementId: string,
  ): Promise<number> {
    if (serialNumbers.length === 0) {
      return 0;
    }

    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO billing_inventory_serial_units
         (tenant_id, article_id, serial_number, status, compartment_id, last_movement_id)
       SELECT $1, $2, serial, 'in_stock', $4, $5 FROM unnest($3::text[]) AS serial
       ON CONFLICT (tenant_id, article_id, serial_number) DO NOTHING
       RETURNING id`,
      [getRequiredTenantId(), articleId, serialNumbers, compartmentId, movementId],
    );

    return rows.length;
  }

  async updateUnits(
    manager: EntityManager,
    ids: string[],
    values: {
      status: InventorySerialUnitStatus;
      compartmentId: string | null;
      lendingId: string | null;
      lastMovementId: string;
    },
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await manager.query(
      `UPDATE billing_inventory_serial_units
       SET status = $3, compartment_id = $4, lending_id = $5, last_movement_id = $6, updated_at = now()
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [getRequiredTenantId(), ids, values.status, values.compartmentId, values.lendingId, values.lastMovementId],
    );
  }

  /** Units in stock or on loan (blocks switching serial tracking off while devices are tracked). */
  async countTracked(articleId: string): Promise<number> {
    const rows: Array<{ count: string }> = await this.repository.query(
      `SELECT COUNT(*) AS count FROM billing_inventory_serial_units
       WHERE tenant_id = $1 AND article_id = $2 AND status IN ('in_stock', 'lent')`,
      [getRequiredTenantId(), articleId],
    );

    return Number(rows[0]?.count ?? 0);
  }
}
