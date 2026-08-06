import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ServicePlanMeterEntity } from '../entities/service-plan-meter.entity';

@Injectable()
export class ServicePlanMetersRepository {
  constructor(
    @InjectRepository(ServicePlanMeterEntity)
    private readonly repository: Repository<ServicePlanMeterEntity>,
  ) {}

  async findByPlanId(servicePlanId: string): Promise<ServicePlanMeterEntity[]> {
    return await this.repository.find({
      where: { servicePlanId },
      relations: ['meter'],
      order: { createdAt: 'ASC' },
    });
  }

  async findByPlanIds(servicePlanIds: string[]): Promise<ServicePlanMeterEntity[]> {
    if (servicePlanIds.length === 0) {
      return [];
    }

    return await this.repository.find({
      where: { servicePlanId: In(servicePlanIds) },
      relations: ['meter'],
      order: { createdAt: 'ASC' },
    });
  }

  async findByPlanAndMeter(servicePlanId: string, meterId: string): Promise<ServicePlanMeterEntity | null> {
    return await this.repository.findOne({
      where: { servicePlanId, meterId },
      relations: ['meter'],
    });
  }

  async findByPlanAndMeterOrThrow(servicePlanId: string, meterId: string): Promise<ServicePlanMeterEntity> {
    const row = await this.findByPlanAndMeter(servicePlanId, meterId);

    if (!row) {
      throw new NotFoundException('Plan meter attachment not found');
    }

    return row;
  }

  async countByMeterId(meterId: string): Promise<number> {
    return await this.repository.count({ where: { meterId } });
  }

  async create(dto: Partial<ServicePlanMeterEntity>): Promise<ServicePlanMeterEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<ServicePlanMeterEntity>): Promise<ServicePlanMeterEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException('Plan meter attachment not found');
    }

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async deleteByPlanAndMeter(servicePlanId: string, meterId: string): Promise<void> {
    await this.repository.delete({ servicePlanId, meterId });
  }

  async replaceForPlan(
    servicePlanId: string,
    attachments: Array<{ meterId: string; unitPriceNet?: string | null }>,
  ): Promise<ServicePlanMeterEntity[]> {
    await this.repository.delete({ servicePlanId });

    if (attachments.length === 0) {
      return [];
    }

    const entities = attachments.map((item) =>
      this.repository.create({
        servicePlanId,
        meterId: item.meterId,
        unitPriceNet: item.unitPriceNet ?? null,
      }),
    );

    return await this.repository.save(entities);
  }
}
