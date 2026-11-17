import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { InventoryWarehouseEntity } from '../entities/inventory-warehouse.entity';
import { inventoryLikeTerm } from '../utils/inventory-query.utils';

export interface InventoryWarehouseStats {
  compartmentCount: number;
  articleCount: number;
  totalQuantity: number;
}

@Injectable()
export class InventoryWarehousesRepository {
  constructor(
    @InjectRepository(InventoryWarehouseEntity)
    private readonly repository: Repository<InventoryWarehouseEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<InventoryWarehouseEntity> {
    const entity = await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });

    if (!entity) {
      throw new NotFoundException(`Warehouse with ID ${id} not found`);
    }

    return entity;
  }

  async findByCode(code: string): Promise<InventoryWarehouseEntity | null> {
    return await this.repository
      .createQueryBuilder('warehouse')
      .where('warehouse.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere('LOWER(warehouse.code) = LOWER(:code)', { code })
      .getOne();
  }

  async findAll(
    limit: number,
    offset: number,
    search?: string,
  ): Promise<{ items: InventoryWarehouseEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('warehouse')
      .where('warehouse.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .orderBy('warehouse.code', 'ASC')
      .addOrderBy('warehouse.id', 'ASC');

    if (search?.trim()) {
      qb.andWhere(
        `(warehouse.code ILIKE :term OR warehouse.name ILIKE :term OR COALESCE(warehouse.city, '') ILIKE :term)`,
        { term: inventoryLikeTerm(search) },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  /** Compartment / distinct article counts and on-hand total per warehouse (only the given ids). */
  async statsFor(ids: string[]): Promise<Map<string, InventoryWarehouseStats>> {
    const stats = new Map<string, InventoryWarehouseStats>();

    if (ids.length === 0) {
      return stats;
    }

    const rows: Array<{ id: string; compartments: string; articles: string; total: string | null }> =
      await this.repository.query(
        `
        SELECT w.id,
               (SELECT COUNT(*) FROM billing_inventory_compartments c WHERE c.warehouse_id = w.id) AS compartments,
               (SELECT COUNT(DISTINCT s.article_id)
                  FROM billing_inventory_stock s
                  INNER JOIN billing_inventory_compartments c ON c.id = s.compartment_id
                  WHERE c.warehouse_id = w.id AND s.quantity > 0) AS articles,
               (SELECT COALESCE(SUM(s.quantity), 0)
                  FROM billing_inventory_stock s
                  INNER JOIN billing_inventory_compartments c ON c.id = s.compartment_id
                  WHERE c.warehouse_id = w.id) AS total
        FROM billing_inventory_warehouses w
        WHERE w.id = ANY($1::uuid[]) AND w.tenant_id = $2
        `,
        [ids, getRequiredTenantId()],
      );

    for (const row of rows) {
      stats.set(row.id, {
        compartmentCount: Number(row.compartments),
        articleCount: Number(row.articles),
        totalQuantity: Number(row.total ?? 0),
      });
    }

    return stats;
  }

  async create(dto: Partial<InventoryWarehouseEntity>): Promise<InventoryWarehouseEntity> {
    return await this.repository.save(this.repository.create({ ...dto, tenantId: getRequiredTenantId() }));
  }

  async update(id: string, dto: Partial<InventoryWarehouseEntity>): Promise<InventoryWarehouseEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete({ id, tenantId: getRequiredTenantId() });
  }

  /** On-hand quantity stored anywhere in the warehouse (deletion guard). */
  async totalQuantity(id: string): Promise<number> {
    const rows: Array<{ total: string | null }> = await this.repository.query(
      `
      SELECT COALESCE(SUM(s.quantity), 0) AS total
      FROM billing_inventory_stock s
      INNER JOIN billing_inventory_compartments c ON c.id = s.compartment_id
      WHERE c.warehouse_id = $1 AND c.tenant_id = $2
      `,
      [id, getRequiredTenantId()],
    );

    return Number(rows[0]?.total ?? 0);
  }
}
