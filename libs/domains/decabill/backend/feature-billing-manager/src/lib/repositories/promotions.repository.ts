import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { PromotionEntity } from '../entities/promotion.entity';
import { applyPromotionTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class PromotionsRepository {
  constructor(
    @InjectRepository(PromotionEntity)
    private readonly repository: Repository<PromotionEntity>,
  ) {}

  private resolveRepository(manager?: EntityManager): Repository<PromotionEntity> {
    return manager ? manager.getRepository(PromotionEntity) : this.repository;
  }

  async findByIdOrThrow(id: string): Promise<PromotionEntity> {
    const qb = this.repository.createQueryBuilder('promotion').where('promotion.id = :id', { id });

    applyPromotionTenantFilter(qb, 'promotion');

    const entity = await qb.getOne();

    if (!entity) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    return entity;
  }

  async findByCode(code: string): Promise<PromotionEntity | null> {
    const normalized = code.trim().toUpperCase();
    const qb = this.repository
      .createQueryBuilder('promotion')
      .where('promotion.code = :code', { code: normalized })
      .andWhere('promotion.tenant_id = :tenantId', { tenantId: getRequiredTenantId() });

    return await qb.getOne();
  }

  async findAll(limit = 10, offset = 0): Promise<{ items: PromotionEntity[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('promotion')
      .orderBy('promotion.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyPromotionTenantFilter(qb, 'promotion');

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }

  async create(data: Partial<PromotionEntity>): Promise<PromotionEntity> {
    const entity = this.repository.create({
      ...data,
      tenantId: getRequiredTenantId(),
      code: data.code?.trim().toUpperCase(),
    });

    return await this.repository.save(entity);
  }

  async update(id: string, data: Partial<PromotionEntity>): Promise<PromotionEntity> {
    await this.findByIdOrThrow(id);
    const payload = { ...data };

    if (payload.code) {
      payload.code = payload.code.trim().toUpperCase();
    }

    await this.repository.update(id, payload);

    return await this.findByIdOrThrow(id);
  }

  async findByIdForUpdate(id: string, manager?: EntityManager): Promise<PromotionEntity | null> {
    const repository = this.resolveRepository(manager);
    const qb = repository
      .createQueryBuilder('promotion')
      .setLock('pessimistic_write')
      .where('promotion.id = :id', { id });

    applyPromotionTenantFilter(qb, 'promotion');

    return await qb.getOne();
  }
}
