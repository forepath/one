import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CustomerProfileEntity } from '../entities/customer-profile.entity';

@Injectable()
export class CustomerProfilesRepository {
  constructor(
    @InjectRepository(CustomerProfileEntity)
    private readonly repository: Repository<CustomerProfileEntity>,
  ) {}

  async findByUserId(userId: string): Promise<CustomerProfileEntity | null> {
    return await this.repository.findOne({ where: { userId } });
  }

  async findByIdOrThrow(id: string): Promise<CustomerProfileEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Customer profile with ID ${id} not found`);
    }

    return entity;
  }

  async create(dto: Partial<CustomerProfileEntity>): Promise<CustomerProfileEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<CustomerProfileEntity>): Promise<CustomerProfileEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }
}
