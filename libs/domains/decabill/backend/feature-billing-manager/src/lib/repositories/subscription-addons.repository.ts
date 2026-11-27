import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { SubscriptionAddonEntity, SubscriptionAddonStatus } from '../entities/subscription-addon.entity';

@Injectable()
export class SubscriptionAddonsRepository {
  constructor(
    @InjectRepository(SubscriptionAddonEntity)
    private readonly repository: Repository<SubscriptionAddonEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<SubscriptionAddonEntity> {
    const entity = await this.repository.findOne({ where: { id }, relations: { addon: true } });

    if (!entity) {
      throw new NotFoundException(`Subscription addon with ID ${id} not found`);
    }

    return entity;
  }

  async findBySubscriptionId(subscriptionId: string): Promise<SubscriptionAddonEntity[]> {
    return await this.repository.find({
      where: { subscriptionId },
      relations: { addon: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findActiveBySubscriptionId(subscriptionId: string): Promise<SubscriptionAddonEntity[]> {
    return await this.repository.find({
      where: { subscriptionId, status: In(['pending', 'active'] as SubscriptionAddonStatus[]) },
      relations: { addon: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findBillableBySubscriptionId(subscriptionId: string): Promise<SubscriptionAddonEntity[]> {
    return await this.repository.find({
      where: { subscriptionId, status: In(['pending', 'active'] as SubscriptionAddonStatus[]) },
      order: { createdAt: 'ASC' },
    });
  }

  async createMany(rows: Partial<SubscriptionAddonEntity>[]): Promise<SubscriptionAddonEntity[]> {
    if (rows.length === 0) {
      return [];
    }

    const entities = this.repository.create(rows);

    return await this.repository.save(entities);
  }

  async update(id: string, dto: Partial<SubscriptionAddonEntity>): Promise<SubscriptionAddonEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async save(entity: SubscriptionAddonEntity): Promise<SubscriptionAddonEntity> {
    return await this.repository.save(entity);
  }

  async countByAddonId(addonId: string): Promise<number> {
    return await this.repository.count({ where: { addonId } });
  }
}
