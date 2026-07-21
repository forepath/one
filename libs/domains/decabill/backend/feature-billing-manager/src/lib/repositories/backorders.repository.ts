import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BackorderEntity, BackorderStatus } from '../entities/backorder.entity';
import { applyUserTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class BackordersRepository {
  constructor(
    @InjectRepository(BackorderEntity)
    private readonly repository: Repository<BackorderEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<BackorderEntity> {
    const entity = await this.repository
      .createQueryBuilder('backorder')
      .innerJoin('users', 'user', 'user.id = backorder.user_id')
      .where('backorder.id = :id', { id })
      .andWhere('user.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Backorder with ID ${id} not found`);
    }

    return entity;
  }

  async findAllByUser(userId: string, limit = 10, offset = 0): Promise<BackorderEntity[]> {
    return await this.repository.find({
      where: { userId },
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  async countFailedByUserId(userId: string): Promise<number> {
    const qb = this.repository
      .createQueryBuilder('backorder')
      .innerJoin('users', 'user', 'user.id = backorder.user_id')
      .where('backorder.user_id = :userId', { userId })
      .andWhere('backorder.status = :status', { status: BackorderStatus.FAILED });

    applyUserTenantFilter(qb, 'user');

    return await qb.getCount();
  }

  async findAllPending(limit = 100, offset = 0): Promise<BackorderEntity[]> {
    const qb = this.repository
      .createQueryBuilder('backorder')
      .innerJoin('users', 'user', 'user.id = backorder.user_id')
      .where('backorder.status IN (:...statuses)', { statuses: [BackorderStatus.PENDING, BackorderStatus.RETRYING] })
      .orderBy('backorder.createdAt', 'ASC')
      .take(limit)
      .skip(offset);

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }

  async create(dto: Partial<BackorderEntity>): Promise<BackorderEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<BackorderEntity>): Promise<BackorderEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async cancelPendingForUserPlan(userId: string, planId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(BackorderEntity)
      .set({ status: BackorderStatus.CANCELLED })
      .where('user_id = :userId', { userId })
      .andWhere('plan_id = :planId', { planId })
      .andWhere('status IN (:...statuses)', { statuses: [BackorderStatus.PENDING, BackorderStatus.RETRYING] })
      .execute();
  }
}
