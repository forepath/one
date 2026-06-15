import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';

import { OpenPositionEntity } from '../entities/open-position.entity';

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

  async findUnbilledByUserId(userId: string, manager?: EntityManager): Promise<OpenPositionEntity[]> {
    const repository = manager ? manager.getRepository(OpenPositionEntity) : this.repository;

    return await repository.find({
      where: { userId, invoiceRefId: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  async findUnbilledByUserIdForUpdate(userId: string, manager: EntityManager): Promise<OpenPositionEntity[]> {
    return await manager.getRepository(OpenPositionEntity).find({
      where: { userId, invoiceRefId: IsNull() },
      order: { createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async hasUnbilledForSubscription(subscriptionId: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { subscriptionId, invoiceRefId: IsNull() },
    });

    return count > 0;
  }

  async findDistinctUserIdsWithUnbilled(): Promise<string[]> {
    const rows = await this.repository
      .createQueryBuilder('pos')
      .select('DISTINCT pos.user_id', 'userId')
      .where('pos.invoice_ref_id IS NULL')
      .getRawMany<{ userId: string }>();

    return rows.map((row) => row.userId);
  }

  async markBilled(id: string, invoiceRefId: string, manager?: EntityManager): Promise<OpenPositionEntity> {
    const repository = manager ? manager.getRepository(OpenPositionEntity) : this.repository;
    const entity = await repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Open position ${id} not found`);
    }

    entity.invoiceRefId = invoiceRefId;

    return await repository.save(entity);
  }

  async markManyBilled(ids: string[], invoiceRefId: string, manager?: EntityManager): Promise<void> {
    if (ids.length === 0) {
      return;
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
}
