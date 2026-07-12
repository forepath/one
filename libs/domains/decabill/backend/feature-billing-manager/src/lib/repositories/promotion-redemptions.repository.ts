import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { PromotionRedemptionStatus } from '../constants/promotion.constants';
import { PromotionRedemptionEntity } from '../entities/promotion-redemption.entity';
import { applyPromotionTenantFilter, applyUserTenantFilter } from '../utils/tenant-query.utils';

@Injectable()
export class PromotionRedemptionsRepository {
  constructor(
    @InjectRepository(PromotionRedemptionEntity)
    private readonly repository: Repository<PromotionRedemptionEntity>,
  ) {}

  private resolveRepository(manager?: EntityManager): Repository<PromotionRedemptionEntity> {
    return manager ? manager.getRepository(PromotionRedemptionEntity) : this.repository;
  }

  async findById(id: string): Promise<PromotionRedemptionEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['promotion', 'subscription'],
    });
  }

  async findByIdOrThrow(id: string): Promise<PromotionRedemptionEntity> {
    const entity = await this.findById(id);

    if (!entity) {
      throw new Error(`Promotion redemption ${id} not found`);
    }

    return entity;
  }

  async create(data: Partial<PromotionRedemptionEntity>, manager?: EntityManager): Promise<PromotionRedemptionEntity> {
    const repository = this.resolveRepository(manager);
    const entity = repository.create(data);

    return await repository.save(entity);
  }

  async update(id: string, data: Partial<PromotionRedemptionEntity>): Promise<PromotionRedemptionEntity> {
    await this.repository.update(id, data);

    return await this.repository.findOneOrFail({ where: { id } });
  }

  async countByPromotion(promotionId: string): Promise<number> {
    return await this.repository.count({ where: { promotionId } });
  }

  async countByPromotionAndUser(promotionId: string, userId: string): Promise<number> {
    return await this.repository.count({ where: { promotionId, userId } });
  }

  async hasActiveRedemptionForSubscription(
    promotionId: string,
    subscriptionId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repository = this.resolveRepository(manager);
    const count = await repository.count({
      where: {
        promotionId,
        subscriptionId,
        status: PromotionRedemptionStatus.ACTIVE,
      },
    });

    return count > 0;
  }

  async findActiveBySubscription(subscriptionId: string): Promise<PromotionRedemptionEntity[]> {
    return await this.repository.find({
      where: { subscriptionId, status: PromotionRedemptionStatus.ACTIVE },
      relations: ['promotion', 'subscription'],
      order: { redeemedAt: 'ASC' },
    });
  }

  async findActiveByUser(
    userId: string,
    limit = 10,
    offset = 0,
  ): Promise<{ items: PromotionRedemptionEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('redemption')
      .innerJoinAndSelect('redemption.promotion', 'promotion')
      .innerJoin('users', 'user', 'user.id = redemption.user_id')
      .leftJoinAndSelect('redemption.subscription', 'subscription')
      .where('redemption.user_id = :userId', { userId })
      .andWhere('redemption.status = :status', { status: PromotionRedemptionStatus.ACTIVE })
      .orderBy('redemption.redeemedAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }

  async findByUser(
    userId: string,
    limit = 10,
    offset = 0,
  ): Promise<{ items: PromotionRedemptionEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('redemption')
      .innerJoinAndSelect('redemption.promotion', 'promotion')
      .innerJoin('users', 'user', 'user.id = redemption.user_id')
      .leftJoinAndSelect('redemption.subscription', 'subscription')
      .where('redemption.user_id = :userId', { userId })
      .orderBy('redemption.redeemedAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }

  async findByPromotion(
    promotionId: string,
    limit = 10,
    offset = 0,
  ): Promise<{ items: PromotionRedemptionEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('redemption')
      .innerJoinAndSelect('redemption.promotion', 'promotion')
      .leftJoinAndSelect('redemption.subscription', 'subscription')
      .where('redemption.promotion_id = :promotionId', { promotionId })
      .orderBy('redemption.redeemedAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyPromotionTenantFilter(qb, 'promotion');

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }
}
