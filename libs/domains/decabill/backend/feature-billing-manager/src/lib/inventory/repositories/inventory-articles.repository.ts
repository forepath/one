import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { InventoryArticleEntity } from '../entities/inventory-article.entity';
import { inventoryLikeTerm } from '../utils/inventory-query.utils';

export interface InventoryArticleStockTotals {
  totalQuantity: number;
  locationCount: number;
}

@Injectable()
export class InventoryArticlesRepository {
  constructor(
    @InjectRepository(InventoryArticleEntity)
    private readonly repository: Repository<InventoryArticleEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<InventoryArticleEntity> {
    const entity = await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });

    if (!entity) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }

    return entity;
  }

  async findByIds(ids: string[]): Promise<InventoryArticleEntity[]> {
    if (ids.length === 0) {
      return [];
    }

    return await this.repository.find({ where: { id: In(ids), tenantId: getRequiredTenantId() } });
  }

  async findByEan(ean: string): Promise<InventoryArticleEntity | null> {
    return await this.repository.findOne({ where: { ean, tenantId: getRequiredTenantId() } });
  }

  /**
   * Paged articles. `search` matches article number, name, EAN, MPN, supplier article number and the serial numbers
   * of the article's units (scanning a device's serial finds its article); `lowStockOnly`
   * keeps articles whose total on-hand stock is at or below their reorder point.
   */
  async findAll(
    limit: number,
    offset: number,
    filters: { search?: string; activeOnly?: boolean; lowStockOnly?: boolean },
  ): Promise<{ items: InventoryArticleEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('article')
      .where('article.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .orderBy('article.articleNumber', 'ASC')
      .addOrderBy('article.id', 'ASC');

    if (filters.activeOnly) {
      qb.andWhere('article.is_active = true');
    }

    if (filters.lowStockOnly) {
      qb.andWhere('article.reorder_point IS NOT NULL').andWhere(
        `(SELECT COALESCE(SUM(s.quantity), 0) FROM billing_inventory_stock s WHERE s.article_id = article.id)
           <= article.reorder_point`,
      );
    }

    if (filters.search?.trim()) {
      qb.andWhere(
        `(article.article_number ILIKE :term OR article.name ILIKE :term OR COALESCE(article.ean, '') ILIKE :term
          OR COALESCE(article.manufacturer_part_number, '') ILIKE :term
          OR COALESCE(article.supplier_article_number, '') ILIKE :term
          OR EXISTS (SELECT 1 FROM billing_inventory_serial_units u
            WHERE u.article_id = article.id AND u.serial_number ILIKE :term))`,
        { term: inventoryLikeTerm(filters.search) },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  async stockTotalsFor(ids: string[]): Promise<Map<string, InventoryArticleStockTotals>> {
    const totals = new Map<string, InventoryArticleStockTotals>();

    for (const id of ids) {
      totals.set(id, { totalQuantity: 0, locationCount: 0 });
    }

    if (ids.length === 0) {
      return totals;
    }

    const rows: Array<{ article_id: string; total: string | null; locations: string }> = await this.repository.query(
      `
      SELECT s.article_id, COALESCE(SUM(s.quantity), 0) AS total, COUNT(*) AS locations
      FROM billing_inventory_stock s
      WHERE s.article_id = ANY($1::uuid[]) AND s.tenant_id = $2
      GROUP BY s.article_id
      `,
      [ids, getRequiredTenantId()],
    );

    for (const row of rows) {
      totals.set(row.article_id, { totalQuantity: Number(row.total ?? 0), locationCount: Number(row.locations) });
    }

    return totals;
  }

  /** Quantity requested but not yet decided (pending withdrawal requests) per article. */
  async pendingRequestQuantityFor(ids: string[]): Promise<Map<string, number>> {
    const totals = new Map<string, number>();

    if (ids.length === 0) {
      return totals;
    }

    const rows: Array<{ article_id: string; total: string | null }> = await this.repository.query(
      `
      SELECT r.article_id, COALESCE(SUM(r.quantity), 0) AS total
      FROM billing_inventory_withdrawal_requests r
      WHERE r.article_id = ANY($1::uuid[]) AND r.tenant_id = $2 AND r.status = 'pending'
      GROUP BY r.article_id
      `,
      [ids, getRequiredTenantId()],
    );

    for (const row of rows) {
      totals.set(row.article_id, Number(row.total ?? 0));
    }

    return totals;
  }

  /** Quantity currently on loan (open lendings, not yet returned) per article. */
  async lentQuantityFor(ids: string[]): Promise<Map<string, number>> {
    const totals = new Map<string, number>();

    if (ids.length === 0) {
      return totals;
    }

    const rows: Array<{ article_id: string; total: string | null }> = await this.repository.query(
      `
      SELECT l.article_id, COALESCE(SUM(l.quantity - l.returned_quantity), 0) AS total
      FROM billing_inventory_lendings l
      WHERE l.article_id = ANY($1::uuid[]) AND l.tenant_id = $2 AND l.status = 'open'
      GROUP BY l.article_id
      `,
      [ids, getRequiredTenantId()],
    );

    for (const row of rows) {
      totals.set(row.article_id, Number(row.total ?? 0));
    }

    return totals;
  }

  /**
   * Share-locks the article while a movement is booked and returns its current serial tracking flag: switching the
   * flag (exclusive lock) waits for running bookings and vice versa.
   */
  async lockForBooking(manager: EntityManager, id: string): Promise<{ serialTracking: boolean }> {
    const rows: Array<{ serial_tracking: boolean }> = await manager.query(
      `SELECT serial_tracking FROM billing_inventory_articles WHERE id = $1 AND tenant_id = $2 FOR SHARE`,
      [id, getRequiredTenantId()],
    );

    if (!rows[0]) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }

    return { serialTracking: rows[0].serial_tracking === true };
  }

  /**
   * Switches serial tracking under an exclusive lock; refused (false) while the article has stock or open lendings,
   * checked in the same transaction.
   */
  async switchSerialTracking(manager: EntityManager, id: string, serialTracking: boolean): Promise<boolean> {
    await manager.query(`SELECT id FROM billing_inventory_articles WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [
      id,
      getRequiredTenantId(),
    ]);

    const rows: Array<{ blocked: boolean }> = await manager.query(
      `SELECT (
        EXISTS (SELECT 1 FROM billing_inventory_stock s WHERE s.article_id = $1 AND s.quantity > 0)
        OR EXISTS (SELECT 1 FROM billing_inventory_lendings l WHERE l.article_id = $1 AND l.status = 'open')
      ) AS blocked`,
      [id],
    );

    if (rows[0]?.blocked) {
      return false;
    }

    await manager.query(
      `UPDATE billing_inventory_articles SET serial_tracking = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`,
      [id, getRequiredTenantId(), serialTracking],
    );

    return true;
  }

  async create(dto: Partial<InventoryArticleEntity>): Promise<InventoryArticleEntity> {
    return await this.repository.save(this.repository.create({ ...dto, tenantId: getRequiredTenantId() }));
  }

  async update(id: string, dto: Partial<InventoryArticleEntity>): Promise<InventoryArticleEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete({ id, tenantId: getRequiredTenantId() });
  }

  /** Movements, requests and on-hand stock keep an article (documents must stay resolvable). */
  async hasHistory(id: string): Promise<boolean> {
    const rows: Array<{ used: boolean }> = await this.repository.query(
      `
      SELECT (
        EXISTS (SELECT 1 FROM billing_inventory_movements m WHERE m.article_id = $1)
        OR EXISTS (SELECT 1 FROM billing_inventory_withdrawal_requests r WHERE r.article_id = $1)
        OR EXISTS (SELECT 1 FROM billing_inventory_stock s WHERE s.article_id = $1 AND s.quantity > 0)
      ) AS used
      `,
      [id],
    );

    return rows[0]?.used === true;
  }
}
