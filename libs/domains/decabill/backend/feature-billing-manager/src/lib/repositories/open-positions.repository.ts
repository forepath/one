import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { OpenPositionEntity } from '../entities/open-position.entity';
import {
  configChangeCarrySourceRef,
  configChangePrimarySourceRef,
} from '../utils/config-change-billing-source-ref.util';
import { isUniqueConstraintViolation } from '../utils/postgres-unique-violation.util';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class OpenPositionsRepository {
  constructor(
    @InjectRepository(OpenPositionEntity)
    private readonly repository: Repository<OpenPositionEntity>,
  ) {}

  async create(dto: Partial<OpenPositionEntity>): Promise<OpenPositionEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async findBySourceRef(sourceRef: string): Promise<OpenPositionEntity | null> {
    const qb = this.repository
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .where('pos.source_ref = :sourceRef', { sourceRef })
      .take(1);

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async createUniqueBySourceRef(
    dto: Partial<OpenPositionEntity> & { sourceRef: string },
    manager?: EntityManager,
  ): Promise<{ entity: OpenPositionEntity; created: boolean }> {
    const repository = manager ? manager.getRepository(OpenPositionEntity) : this.repository;
    const entity = repository.create(dto);

    try {
      const saved = await repository.save(entity);

      return { entity: saved, created: true };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }

      const existing = await this.findBySourceRef(dto.sourceRef);

      if (!existing) {
        throw error;
      }

      return { entity: existing, created: false };
    }
  }

  async findUnbilledByUserId(userId: string, manager?: EntityManager): Promise<OpenPositionEntity[]> {
    const repository = manager ? manager.getRepository(OpenPositionEntity) : this.repository;
    const qb = repository
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .where('pos.user_id = :userId', { userId })
      .andWhere('pos.invoice_ref_id IS NULL')
      .orderBy('pos.createdAt', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async findUnbilledByUserIdForUpdate(userId: string, manager: EntityManager): Promise<OpenPositionEntity[]> {
    const qb = manager
      .getRepository(OpenPositionEntity)
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .where('pos.user_id = :userId', { userId })
      .andWhere('pos.invoice_ref_id IS NULL')
      .orderBy('pos.createdAt', 'ASC')
      .setLock('pessimistic_write');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async hasUnbilledForSubscription(subscriptionId: string): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .where('pos.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('pos.invoice_ref_id IS NULL');

    applyUserTenantFilter(qb, 'user');

    const count = await qb.getCount();

    return count > 0;
  }

  /**
   * True when the subscription still has an unbilled recurring period charge.
   * Period charges never set `adjustment_net`; one-shot corrections always do.
   * Use this for prepaid period-price settlement so leftover adjustment OPs do not
   * steal an already-invoiced period off the partial-credit path.
   */
  async hasUnbilledPeriodChargeForSubscription(subscriptionId: string): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .where('pos.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('pos.invoice_ref_id IS NULL')
      .andWhere('pos.adjustment_net IS NULL');

    applyUserTenantFilter(qb, 'user');

    const count = await qb.getCount();

    return count > 0;
  }

  async findUnbilledBySubscription(subscriptionId: string): Promise<OpenPositionEntity[]> {
    const qb = this.repository
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .where('pos.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('pos.invoice_ref_id IS NULL')
      .orderBy('pos.createdAt', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  /**
   * Finds a config-change adjustment whether or not it has already been invoiced.
   * Used as a durable idempotency marker across billing retries.
   */
  async findConfigChangeAdjustment(subscriptionId: string, configChangeId: string): Promise<OpenPositionEntity | null> {
    const bySourceRef = await this.findBySourceRef(configChangePrimarySourceRef(configChangeId));

    if (bySourceRef?.subscriptionId === subscriptionId) {
      return bySourceRef;
    }

    const carry = await this.findBySourceRef(configChangeCarrySourceRef(configChangeId));

    if (carry?.subscriptionId === subscriptionId) {
      return carry;
    }

    const qb = this.repository
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .where('pos.subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('pos.adjustment_kind LIKE :kindPrefix', { kindPrefix: 'config_change_%' })
      .andWhere('pos.description LIKE :marker', { marker: `%${configChangeId}%` })
      .orderBy('pos.createdAt', 'ASC')
      .take(1);

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async updateUnbilledBillUntil(subscriptionId: string, billUntil: Date): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(OpenPositionEntity)
      .set({ billUntil })
      .where('subscription_id = :subscriptionId', { subscriptionId })
      .andWhere('invoice_ref_id IS NULL')
      .andWhere(`user_id IN (SELECT id FROM users WHERE tenant_id = :tenantId)`, { tenantId: getRequiredTenantId() })
      .execute();

    return result.affected ?? 0;
  }

  async findDistinctUserIdsWithUnbilled(): Promise<string[]> {
    const qb = this.repository
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .select('DISTINCT pos.user_id', 'userId')
      .where('pos.invoice_ref_id IS NULL');

    applyUserTenantFilter(qb, 'user');

    const rows = await qb.getRawMany<{ userId: string }>();

    return rows.map((row) => row.userId);
  }

  async markBilled(id: string, invoiceRefId: string, manager?: EntityManager): Promise<OpenPositionEntity> {
    const entity = await this.findByIdInTenant(id, manager);

    entity.invoiceRefId = invoiceRefId;

    const repository = manager ? manager.getRepository(OpenPositionEntity) : this.repository;

    return await repository.save(entity);
  }

  async markManyBilled(ids: string[], invoiceRefId: string, manager?: EntityManager): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    for (const id of ids) {
      await this.findByIdInTenant(id, manager);
    }

    const repository = manager ? manager.getRepository(OpenPositionEntity) : this.repository;

    await repository
      .createQueryBuilder()
      .update(OpenPositionEntity)
      .set({ invoiceRefId })
      .whereInIds(ids)
      .andWhere('invoice_ref_id IS NULL')
      .execute();
  }

  private async findByIdInTenant(id: string, manager?: EntityManager): Promise<OpenPositionEntity> {
    const repository = manager ? manager.getRepository(OpenPositionEntity) : this.repository;
    const entity = await repository
      .createQueryBuilder('pos')
      .innerJoin('users', 'user', 'user.id = pos.user_id')
      .where('pos.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Open position ${id} not found`);
    }

    return entity;
  }
}
