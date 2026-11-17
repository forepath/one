import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { InventoryCompartmentEntity } from '../entities/inventory-compartment.entity';
import { inventoryLikeTerm } from '../utils/inventory-query.utils';

export interface InventoryCompartmentStats {
  articleCount: number;
  totalQuantity: number;
}

@Injectable()
export class InventoryCompartmentsRepository {
  constructor(
    @InjectRepository(InventoryCompartmentEntity)
    private readonly repository: Repository<InventoryCompartmentEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<InventoryCompartmentEntity> {
    const entity = await this.repository
      .createQueryBuilder('compartment')
      .innerJoinAndSelect('compartment.warehouse', 'warehouse')
      .where('compartment.id = :id', { id })
      .andWhere('compartment.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Compartment with ID ${id} not found`);
    }

    return entity;
  }

  async findByCode(warehouseId: string, code: string): Promise<InventoryCompartmentEntity | null> {
    return await this.repository
      .createQueryBuilder('compartment')
      .where('compartment.warehouse_id = :warehouseId', { warehouseId })
      .andWhere('compartment.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere('LOWER(compartment.code) = LOWER(:code)', { code })
      .getOne();
  }

  /**
   * Compartments of one warehouse, or (without `warehouseId`) of all warehouses of the tenant — the latter is the
   * typeahead for move targets. Search matches compartment code / name and warehouse code / name.
   */
  async findAll(
    limit: number,
    offset: number,
    filters: { warehouseId?: string; search?: string; activeOnly?: boolean },
  ): Promise<{ items: InventoryCompartmentEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('compartment')
      .innerJoinAndSelect('compartment.warehouse', 'warehouse')
      .where('compartment.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .orderBy('warehouse.code', 'ASC')
      .addOrderBy('compartment.code', 'ASC')
      .addOrderBy('compartment.id', 'ASC');

    if (filters.warehouseId) {
      qb.andWhere('compartment.warehouse_id = :warehouseId', { warehouseId: filters.warehouseId });
    }

    if (filters.activeOnly) {
      qb.andWhere('compartment.is_active = true').andWhere('warehouse.is_active = true');
    }

    if (filters.search?.trim()) {
      qb.andWhere(
        `(compartment.code ILIKE :term OR COALESCE(compartment.name, '') ILIKE :term
          OR warehouse.code ILIKE :term OR warehouse.name ILIKE :term)`,
        { term: inventoryLikeTerm(filters.search) },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  async statsFor(ids: string[]): Promise<Map<string, InventoryCompartmentStats>> {
    const stats = new Map<string, InventoryCompartmentStats>();

    if (ids.length === 0) {
      return stats;
    }

    const rows: Array<{ compartment_id: string; articles: string; total: string | null }> = await this.repository.query(
      `
      SELECT s.compartment_id,
             COUNT(*) FILTER (WHERE s.quantity > 0) AS articles,
             COALESCE(SUM(s.quantity), 0) AS total
      FROM billing_inventory_stock s
      WHERE s.compartment_id = ANY($1::uuid[]) AND s.tenant_id = $2
      GROUP BY s.compartment_id
      `,
      [ids, getRequiredTenantId()],
    );

    for (const id of ids) {
      stats.set(id, { articleCount: 0, totalQuantity: 0 });
    }

    for (const row of rows) {
      stats.set(row.compartment_id, { articleCount: Number(row.articles), totalQuantity: Number(row.total ?? 0) });
    }

    return stats;
  }

  async create(dto: Partial<InventoryCompartmentEntity>): Promise<InventoryCompartmentEntity> {
    const saved = await this.repository.save(this.repository.create({ ...dto, tenantId: getRequiredTenantId() }));

    return await this.findByIdOrThrow(saved.id);
  }

  async update(id: string, dto: Partial<InventoryCompartmentEntity>): Promise<InventoryCompartmentEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);
    delete entity.warehouse;
    await this.repository.save(entity);

    return await this.findByIdOrThrow(id);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete({ id, tenantId: getRequiredTenantId() });
  }
}
