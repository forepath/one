import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ServiceTypeEntity } from '../entities/service-type.entity';

@Injectable()
export class ServiceTypesRepository {
  constructor(
    @InjectRepository(ServiceTypeEntity)
    private readonly repository: Repository<ServiceTypeEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<ServiceTypeEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Service type with ID ${id} not found`);
    }

    return entity;
  }

  async findById(id: string): Promise<ServiceTypeEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findByKey(key: string): Promise<ServiceTypeEntity | null> {
    return await this.repository.findOne({ where: { key } });
  }

  async findAll(limit = 10, offset = 0): Promise<ServiceTypeEntity[]> {
    return await this.repository.find({ take: limit, skip: offset, order: { createdAt: 'DESC' } });
  }

  async create(dto: Partial<ServiceTypeEntity>): Promise<ServiceTypeEntity> {
    const entity = this.repository.create(dto);

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
