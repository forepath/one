import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionItemEntity } from '../entities/subscription-item.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';

@Injectable()
export class SubscriptionItemsRepository {
  constructor(
    @InjectRepository(SubscriptionItemEntity)
    private readonly repository: Repository<SubscriptionItemEntity>,
  ) {}

  async create(dto: Partial<SubscriptionItemEntity>): Promise<SubscriptionItemEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async updateProviderReference(id: string, providerReference: string): Promise<SubscriptionItemEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new Error(`Subscription item ${id} not found`);
    }

    entity.providerReference = providerReference;

    return await this.repository.save(entity);
  }

  async updateProvisioningStatus(id: string, status: 'pending' | 'active' | 'failed'): Promise<SubscriptionItemEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new Error(`Subscription item ${id} not found`);
    }

    entity.provisioningStatus = status as any;

    return await this.repository.save(entity);
  }

  async findBySubscription(subscriptionId: string): Promise<SubscriptionItemEntity[]> {
    return await this.repository.find({
      where: { subscriptionId },
      relations: ['serviceType'],
    });
  }

  async findByIdWithRelations(id: string): Promise<SubscriptionItemEntity | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['serviceType', 'subscription'],
    });
  }

  async findByIdAndSubscriptionId(id: string, subscriptionId: string): Promise<SubscriptionItemEntity | null> {
    return await this.repository.findOne({
      where: { id, subscriptionId },
      relations: ['serviceType', 'subscription'],
    });
  }

  async updateServerInfoSnapshot(id: string, snapshot: Record<string, unknown>): Promise<SubscriptionItemEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new Error(`Subscription item ${id} not found`);
    }

    entity.serverInfoSnapshot = snapshot;

    return await this.repository.save(entity);
  }

  async updateHostname(id: string, hostname: string | null): Promise<SubscriptionItemEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new Error(`Subscription item ${id} not found`);
    }

    entity.hostname = hostname ?? undefined;

    return await this.repository.save(entity);
  }

  async updateSshPrivateKey(id: string, privateKeyPlain: string): Promise<SubscriptionItemEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new Error(`Subscription item ${id} not found`);
    }

    entity.sshPrivateKey = privateKeyPlain;

    return await this.repository.save(entity);
  }

  /**
   * Returns provisioned subscription items that have an SSH private key and belong to an active subscription.
   * Used by the update scheduler to run docker compose pull/up over SSH.
   */
  async findProvisionedWithSshKey(): Promise<SubscriptionItemEntity[]> {
    return await this.repository
      .createQueryBuilder('item')
      .innerJoinAndSelect('item.subscription', 'sub')
      .innerJoinAndSelect('item.serviceType', 'st')
      .where('item.provisioning_status = :status', { status: 'active' })
      .andWhere('item.provider_reference IS NOT NULL')
      .andWhere('item.ssh_private_key IS NOT NULL')
      .andWhere('sub.status = :subStatus', { subStatus: SubscriptionStatus.ACTIVE })
      .getMany();
  }
}
