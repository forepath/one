import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { InventoryStockEntity } from '../entities/inventory-stock.entity';
import { inventoryLikeTerm } from '../utils/inventory-query.utils';

@Injectable()
export class InventoryStockRepository {
  constructor(
    @InjectRepository(InventoryStockEntity)
    private readonly repository: Repository<InventoryStockEntity>,
  ) {}

  private detailQuery() {
    return this.repository
      .createQueryBuilder('stock')
      .innerJoinAndSelect('stock.article', 'article')
      .innerJoinAndSelect('stock.compartment', 'compartment')
      .innerJoinAndSelect('compartment.warehouse', 'warehouse')
      .where('stock.tenant_id = :tenantId', { tenantId: getRequiredTenantId() });
  }

  async findByIdOrThrow(id: string): Promise<InventoryStockEntity> {
    const entity = await this.detailQuery().andWhere('stock.id = :id', { id }).getOne();

    if (!entity) {
      throw new NotFoundException(`Stock placement with ID ${id} not found`);
    }

    return entity;
  }

  async findPlacement(compartmentId: string, articleId: string): Promise<InventoryStockEntity | null> {
    return await this.detailQuery()
      .andWhere('stock.compartment_id = :compartmentId', { compartmentId })
      .andWhere('stock.article_id = :articleId', { articleId })
      .getOne();
  }

  /** Articles placed in a compartment (search: article number / name / EAN). */
  async findByCompartment(
    compartmentId: string,
    limit: number,
    offset: number,
    search?: string,
  ): Promise<{ items: InventoryStockEntity[]; total: number }> {
    const qb = this.detailQuery()
      .andWhere('stock.compartment_id = :compartmentId', { compartmentId })
      .orderBy('article.articleNumber', 'ASC')
      .addOrderBy('stock.id', 'ASC');

    if (search?.trim()) {
      qb.andWhere(
        `(article.article_number ILIKE :term OR article.name ILIKE :term OR COALESCE(article.ean, '') ILIKE :term)`,
        {
          term: inventoryLikeTerm(search),
        },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  /**
   * Placements of an article across all warehouses, most stock first — the location list of the article page and
   * the suggested source / target compartments of moves.
   */
  async findByArticle(
    articleId: string,
    limit: number,
    offset: number,
    filters: { search?: string; withStockOnly?: boolean } = {},
  ): Promise<{ items: InventoryStockEntity[]; total: number }> {
    const qb = this.detailQuery()
      .andWhere('stock.article_id = :articleId', { articleId })
      .orderBy('stock.quantity', 'DESC')
      .addOrderBy('warehouse.code', 'ASC')
      .addOrderBy('compartment.code', 'ASC')
      .addOrderBy('stock.id', 'ASC');

    if (filters.withStockOnly) {
      qb.andWhere('stock.quantity > 0');
    }

    if (filters.search?.trim()) {
      qb.andWhere(
        `(compartment.code ILIKE :term OR COALESCE(compartment.name, '') ILIKE :term OR warehouse.code ILIKE :term
          OR warehouse.name ILIKE :term)`,
        { term: inventoryLikeTerm(filters.search) },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  /** Creates the placement with quantity 0 unless it exists; returns its id. */
  async ensurePlacement(compartmentId: string, articleId: string, manager?: EntityManager): Promise<string> {
    const em = manager ?? this.repository.manager;

    await em.query(
      `
      INSERT INTO billing_inventory_stock (tenant_id, compartment_id, article_id, quantity)
      VALUES ($1, $2, $3, 0)
      ON CONFLICT (compartment_id, article_id) DO NOTHING
      `,
      [getRequiredTenantId(), compartmentId, articleId],
    );

    const rows: Array<{ id: string }> = await em.query(
      `SELECT id FROM billing_inventory_stock WHERE compartment_id = $1 AND article_id = $2`,
      [compartmentId, articleId],
    );

    return rows[0]!.id;
  }

  /** Row-locks placements (deterministic order prevents deadlocks between crossing transfers). */
  async lockPlacements(
    manager: EntityManager,
    placementIds: string[],
  ): Promise<Map<string, { id: string; quantity: number }>> {
    const sorted = [...new Set(placementIds)].sort();
    const rows: Array<{ id: string; quantity: string }> = await manager.query(
      `SELECT id, quantity FROM billing_inventory_stock WHERE id = ANY($1::uuid[]) AND tenant_id = $2 ORDER BY id FOR UPDATE`,
      [sorted, getRequiredTenantId()],
    );

    return new Map(rows.map((row) => [row.id, { id: row.id, quantity: Number(row.quantity) }]));
  }

  async setQuantity(manager: EntityManager, placementId: string, quantity: number): Promise<void> {
    await manager.query(`UPDATE billing_inventory_stock SET quantity = $2, updated_at = now() WHERE id = $1`, [
      placementId,
      quantity.toFixed(3),
    ]);
  }

  /** Removes an empty placement; false when it holds stock (checked atomically with the delete). */
  async deleteIfEmpty(id: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(InventoryStockEntity)
      .where('id = :id', { id })
      .andWhere('tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere('quantity = 0')
      .execute();

    return (result.affected ?? 0) > 0;
  }
}
