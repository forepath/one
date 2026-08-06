import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { MeterEntity } from '../entities/meter.entity';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class MetersRepository {
  constructor(
    @InjectRepository(MeterEntity)
    private readonly repository: Repository<MeterEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<MeterEntity> {
    const entity = await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });

    if (!entity) {
      throw new NotFoundException(`Meter with ID ${id} not found`);
    }

    return entity;
  }

  async findById(id: string): Promise<MeterEntity | null> {
    return await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });
  }

  async findByIds(ids: string[]): Promise<MeterEntity[]> {
    if (ids.length === 0) {
      return [];
    }

    return await this.repository.find({
      where: { id: In(ids), tenantId: getRequiredTenantId() },
    });
  }

  async findByKey(key: string): Promise<MeterEntity | null> {
    return await this.repository.findOne({ where: { key, tenantId: getRequiredTenantId() } });
  }

  async findAll(limit = 10, offset = 0): Promise<MeterEntity[]> {
    return await this.repository.find({
      where: { tenantId: getRequiredTenantId() },
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  async findActive(limit = 100, offset = 0): Promise<MeterEntity[]> {
    return await this.repository.find({
      where: { tenantId: getRequiredTenantId(), isActive: true },
      take: limit,
      skip: offset,
      order: { name: 'ASC' },
    });
  }

  async create(dto: Partial<MeterEntity>): Promise<MeterEntity> {
    const { tenantId: _ignoredTenantId, ...rest } = dto;
    const entity = this.repository.create({
      ...rest,
      tenantId: getRequiredTenantId(),
    });

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<MeterEntity>): Promise<MeterEntity> {
    const entity = await this.findByIdOrThrow(id);
    const { tenantId: _ignoredTenantId, ...safeDto } = dto;

    Object.assign(entity, safeDto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id, tenantId: getRequiredTenantId() });
  }
}
