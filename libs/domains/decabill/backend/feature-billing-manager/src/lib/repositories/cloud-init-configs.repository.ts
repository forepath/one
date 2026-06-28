import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CloudInitConfigEntity } from '../entities/cloud-init-config.entity';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class CloudInitConfigsRepository {
  constructor(
    @InjectRepository(CloudInitConfigEntity)
    private readonly repository: Repository<CloudInitConfigEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<CloudInitConfigEntity> {
    const entity = await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });

    if (!entity) {
      throw new NotFoundException(`CloudInit config with ID ${id} not found`);
    }

    return entity;
  }

  async findById(id: string): Promise<CloudInitConfigEntity | null> {
    return await this.repository.findOne({ where: { id, tenantId: getRequiredTenantId() } });
  }

  async findByKey(key: string): Promise<CloudInitConfigEntity | null> {
    return await this.repository.findOne({ where: { key, tenantId: getRequiredTenantId() } });
  }

  async findAll(limit = 10, offset = 0): Promise<CloudInitConfigEntity[]> {
    return await this.repository.find({
      where: { tenantId: getRequiredTenantId() },
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  async create(dto: Partial<CloudInitConfigEntity>): Promise<CloudInitConfigEntity> {
    const { tenantId: _ignoredTenantId, ...rest } = dto;
    const entity = this.repository.create({
      ...rest,
      tenantId: getRequiredTenantId(),
    });

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<CloudInitConfigEntity>): Promise<CloudInitConfigEntity> {
    const entity = await this.findByIdOrThrow(id);
    const { tenantId: _ignoredTenantId, ...safeDto } = dto;

    Object.assign(entity, safeDto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    const entity = await this.findByIdOrThrow(id);

    await this.repository.remove(entity);
  }
}
