import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ServiceTypeEntity } from '../entities/service-type.entity';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class ServiceTypesRepository {
  constructor(
    @InjectRepository(ServiceTypeEntity)
    private readonly repository: Repository<ServiceTypeEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<ServiceTypeEntity> {
    const entity = await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });

    if (!entity) {
      throw new NotFoundException(`Service type with ID ${id} not found`);
    }

    return entity;
  }

  async findById(id: string): Promise<ServiceTypeEntity | null> {
    return await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });
  }

  async findByKey(key: string): Promise<ServiceTypeEntity | null> {
    return await this.repository.findOne({ where: { key, tenantId: getRequiredTenantId() } });
  }

  async findAll(limit = 10, offset = 0): Promise<ServiceTypeEntity[]> {
    return await this.repository.find({
      where: { tenantId: getRequiredTenantId() },
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  async create(dto: Partial<ServiceTypeEntity>): Promise<ServiceTypeEntity> {
    const entity = this.repository.create({
      ...dto,
      tenantId: dto.tenantId ?? getRequiredTenantId(),
    });

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<ServiceTypeEntity>): Promise<ServiceTypeEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    const entity = await this.findByIdOrThrow(id);

    await this.repository.remove(entity);
  }
}
