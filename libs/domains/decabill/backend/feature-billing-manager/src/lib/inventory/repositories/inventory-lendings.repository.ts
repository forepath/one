import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { InventoryLendingStatus } from '../constants/inventory.constants';
import { InventoryLendingEntity } from '../entities/inventory-lending.entity';
import { inventoryLikeTerm, inventoryToday } from '../utils/inventory-query.utils';

export interface InventoryLendingFilters {
  status?: InventoryLendingStatus;
  /** Open lendings past their due date. */
  overdueOnly?: boolean;
  articleId?: string;
  borrowerUserId?: string;
  search?: string;
}

@Injectable()
export class InventoryLendingsRepository {
  constructor(
    @InjectRepository(InventoryLendingEntity)
    private readonly repository: Repository<InventoryLendingEntity>,
  ) {}

  private detailQuery() {
    return this.repository
      .createQueryBuilder('lending')
      .innerJoinAndSelect('lending.article', 'article')
      .leftJoinAndSelect('lending.sourceCompartment', 'compartment')
      .leftJoinAndSelect('compartment.warehouse', 'warehouse')
      .where('lending.tenant_id = :tenantId', { tenantId: getRequiredTenantId() });
  }

  async findByIdOrThrow(id: string): Promise<InventoryLendingEntity> {
    const entity = await this.detailQuery().andWhere('lending.id = :id', { id }).getOne();

    if (!entity) {
      throw new NotFoundException(`Lending with ID ${id} not found`);
    }

    return entity;
  }

  /**
   * Paged lendings, open ones by due date first. `search` matches the document number, borrower, article and the
   * serial numbers on the lending's documents.
   */
  async findAll(
    limit: number,
    offset: number,
    filters: InventoryLendingFilters,
  ): Promise<{ items: InventoryLendingEntity[]; total: number }> {
    const qb = this.detailQuery()
      // Property names (paginated join query).
      .orderBy('lending.status', 'ASC')
      .addOrderBy('lending.dueDate', 'ASC', 'NULLS LAST')
      .addOrderBy('lending.createdAt', 'DESC')
      .addOrderBy('lending.id', 'ASC');

    if (filters.status) {
      qb.andWhere('lending.status = :status', { status: filters.status });
    }

    if (filters.overdueOnly) {
      qb.andWhere(`lending.status = 'open' AND lending.due_date < :today`, { today: inventoryToday() });
    }

    if (filters.articleId) {
      qb.andWhere('lending.article_id = :articleId', { articleId: filters.articleId });
    }

    if (filters.borrowerUserId) {
      qb.andWhere('lending.borrower_user_id = :borrowerUserId', { borrowerUserId: filters.borrowerUserId });
    }

    if (filters.search?.trim()) {
      qb.andWhere(
        `(COALESCE(lending.document_number, '') ILIKE :term OR lending.borrower_name ILIKE :term
          OR COALESCE(lending.borrower_email, '') ILIKE :term
          OR COALESCE(lending.borrower_customer_number, '') ILIKE :term
          OR article.article_number ILIKE :term OR article.name ILIKE :term
          OR EXISTS (SELECT 1 FROM billing_inventory_movements m
            WHERE m.lending_id = lending.id AND m.serial_numbers::text ILIKE :term))`,
        { term: inventoryLikeTerm(filters.search) },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  async insert(manager: EntityManager, values: Partial<InventoryLendingEntity>): Promise<InventoryLendingEntity> {
    const repository = manager.getRepository(InventoryLendingEntity);

    return await repository.save(repository.create({ ...values, tenantId: getRequiredTenantId() }));
  }

  /** Locks an open lending for a return; null when it is unknown (this tenant) or already returned. */
  async lockOpen(
    manager: EntityManager,
    id: string,
  ): Promise<{ id: string; quantity: number; returnedQuantity: number } | null> {
    const rows: Array<{ id: string; quantity: string; returned_quantity: string }> = await manager.query(
      `SELECT id, quantity, returned_quantity FROM billing_inventory_lendings
       WHERE id = $1 AND tenant_id = $2 AND status = 'open' FOR UPDATE`,
      [id, getRequiredTenantId()],
    );
    const row = rows[0];

    return row ? { id: row.id, quantity: Number(row.quantity), returnedQuantity: Number(row.returned_quantity) } : null;
  }

  async update(manager: EntityManager, id: string, values: Partial<InventoryLendingEntity>): Promise<void> {
    await manager.getRepository(InventoryLendingEntity).update({ id, tenantId: getRequiredTenantId() }, values);
  }

  async countOpenForArticle(articleId: string): Promise<number> {
    return await this.repository.count({
      where: { tenantId: getRequiredTenantId(), articleId, status: InventoryLendingStatus.OPEN },
    });
  }

  async countOverdue(): Promise<number> {
    return await this.repository
      .createQueryBuilder('lending')
      .where('lending.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere(`lending.status = 'open' AND lending.due_date < :today`, { today: inventoryToday() })
      .getCount();
  }

  async countOpen(): Promise<number> {
    return await this.repository.count({
      where: { tenantId: getRequiredTenantId(), status: InventoryLendingStatus.OPEN },
    });
  }
}
