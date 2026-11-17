import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { InventoryWithdrawalRequestStatus } from '../constants/inventory.constants';
import { InventoryWithdrawalRequestEntity } from '../entities/inventory-withdrawal-request.entity';
import { inventoryLikeTerm } from '../utils/inventory-query.utils';

@Injectable()
export class InventoryWithdrawalRequestsRepository {
  constructor(
    @InjectRepository(InventoryWithdrawalRequestEntity)
    private readonly repository: Repository<InventoryWithdrawalRequestEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<InventoryWithdrawalRequestEntity> {
    const entity = await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });

    if (!entity) {
      throw new NotFoundException(`Withdrawal request with ID ${id} not found`);
    }

    return entity;
  }

  async findAll(
    limit: number,
    offset: number,
    filters: { status?: InventoryWithdrawalRequestStatus; search?: string; articleId?: string },
  ): Promise<{ items: InventoryWithdrawalRequestEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('request')
      .innerJoin('billing_inventory_articles', 'article', 'article.id = request.article_id')
      .where('request.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .orderBy('request.createdAt', filters.status === InventoryWithdrawalRequestStatus.PENDING ? 'ASC' : 'DESC')
      .addOrderBy('request.id', 'ASC');

    if (filters.status) {
      qb.andWhere('request.status = :status', { status: filters.status });
    }

    if (filters.articleId) {
      qb.andWhere('request.article_id = :articleId', { articleId: filters.articleId });
    }

    if (filters.search?.trim()) {
      qb.andWhere(
        `(request.source_label ILIKE :term OR article.article_number ILIKE :term OR article.name ILIKE :term)`,
        { term: inventoryLikeTerm(filters.search) },
      );
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();

    return { items, total };
  }

  /**
   * Cheap change marker of a tenant's requests (count, pending count, last update). Requests raised by worker
   * processes (subscription billing runs) have no socket server; the gateway polls this to push them live.
   */
  async changeSignature(tenantId: string): Promise<{ signature: string; pendingCount: number }> {
    const rows: Array<{ total: string; pending: string; updated: Date | null }> = await this.repository.query(
      `
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'pending') AS pending,
             MAX(updated_at) AS updated
      FROM billing_inventory_withdrawal_requests
      WHERE tenant_id = $1
      `,
      [tenantId],
    );
    const row = rows[0];
    const pendingCount = Number(row?.pending ?? 0);

    return {
      signature: `${row?.total ?? 0}:${pendingCount}:${row?.updated ? new Date(row.updated).toISOString() : ''}`,
      pendingCount,
    };
  }

  async countPending(): Promise<number> {
    return await this.repository.count({
      where: { tenantId: getRequiredTenantId(), status: InventoryWithdrawalRequestStatus.PENDING },
    });
  }

  /** Inserts unless a request with the same source ref exists (idempotent re-runs). Returns the new row or null. */
  async createIfAbsent(
    dto: Omit<Partial<InventoryWithdrawalRequestEntity>, 'sourceRef'> & { sourceRef: string },
  ): Promise<InventoryWithdrawalRequestEntity | null> {
    const result = await this.repository
      .createQueryBuilder()
      .insert()
      .into(InventoryWithdrawalRequestEntity)
      .values({ ...dto, tenantId: getRequiredTenantId(), status: InventoryWithdrawalRequestStatus.PENDING })
      .orIgnore()
      .returning('id')
      .execute();
    const id = (result.raw as Array<{ id: string }> | undefined)?.[0]?.id;

    return id ? await this.findByIdOrThrow(id) : null;
  }

  /** Locks a pending request for a decision; null when it is no longer pending. */
  async lockPending(manager: EntityManager, id: string): Promise<InventoryWithdrawalRequestEntity | null> {
    return await manager
      .getRepository(InventoryWithdrawalRequestEntity)
      .createQueryBuilder('request')
      .setLock('pessimistic_write')
      .where('request.id = :id', { id })
      .andWhere('request.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .andWhere('request.status = :status', { status: InventoryWithdrawalRequestStatus.PENDING })
      .getOne();
  }

  async decide(
    manager: EntityManager,
    id: string,
    patch: Pick<InventoryWithdrawalRequestEntity, 'status' | 'decidedAt' | 'decidedByUserId' | 'decisionNote'>,
  ): Promise<void> {
    await manager.getRepository(InventoryWithdrawalRequestEntity).update({ id }, patch);
  }
}
