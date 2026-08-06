import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ServiceTypeMeterEntity } from '../entities/service-type-meter.entity';

@Injectable()
export class ServiceTypeMetersRepository {
  constructor(
    @InjectRepository(ServiceTypeMeterEntity)
    private readonly repository: Repository<ServiceTypeMeterEntity>,
  ) {}

  async findByServiceTypeId(serviceTypeId: string): Promise<ServiceTypeMeterEntity[]> {
    return await this.repository.find({
      where: { serviceTypeId },
      relations: ['meter'],
      order: { createdAt: 'ASC' },
    });
  }

  async findByServiceTypeIds(serviceTypeIds: string[]): Promise<ServiceTypeMeterEntity[]> {
    if (serviceTypeIds.length === 0) {
      return [];
    }

    return await this.repository.find({
      where: { serviceTypeId: In(serviceTypeIds) },
      relations: ['meter'],
      order: { createdAt: 'ASC' },
    });
  }

  async findByServiceTypeAndMeter(serviceTypeId: string, meterId: string): Promise<ServiceTypeMeterEntity | null> {
    return await this.repository.findOne({
      where: { serviceTypeId, meterId },
      relations: ['meter'],
    });
  }

  async findByServiceTypeAndMeterOrThrow(serviceTypeId: string, meterId: string): Promise<ServiceTypeMeterEntity> {
    const row = await this.findByServiceTypeAndMeter(serviceTypeId, meterId);

    if (!row) {
      throw new NotFoundException('Service type meter attachment not found');
    }

    return row;
  }

  async countByMeterId(meterId: string): Promise<number> {
    return await this.repository.count({ where: { meterId } });
  }

  async create(dto: Partial<ServiceTypeMeterEntity>): Promise<ServiceTypeMeterEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<ServiceTypeMeterEntity>): Promise<ServiceTypeMeterEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException('Service type meter attachment not found');
    }

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async deleteByServiceTypeAndMeter(serviceTypeId: string, meterId: string): Promise<void> {
    await this.repository.delete({ serviceTypeId, meterId });
  }

  async deleteById(id: string): Promise<void> {
    await this.repository.delete({ id });
  }
}
