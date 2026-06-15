import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';

import { ServicePlanEntity } from '../entities/service-plan.entity';

@Injectable()
export class ServicePlansRepository {
  constructor(
    @InjectRepository(ServicePlanEntity)
    private readonly repository: Repository<ServicePlanEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<ServicePlanEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Service plan with ID ${id} not found`);
    }

    return entity;
  }

  async findById(id: string): Promise<ServicePlanEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findAll(limit = 10, offset = 0): Promise<ServicePlanEntity[]> {
    return await this.repository.find({ take: limit, skip: offset, order: { createdAt: 'DESC' } });
  }

  /**
   * Active plans with service type relation for public catalog (no inactive or config filtering here).
   */
  async findActiveWithServiceType(limit: number, offset: number, serviceTypeId?: string): Promise<ServicePlanEntity[]> {
    const where: FindOptionsWhere<ServicePlanEntity> = { isActive: true };
    const trimmedTypeId = serviceTypeId?.trim();

    if (trimmedTypeId) {
      where.serviceTypeId = trimmedTypeId;
    }

    return await this.repository.find({
      where,
      relations: ['serviceType'],
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * All active plans with service type (no pagination). Used to pick lowest customer price in application code.
   */
  async findAllActiveWithServiceType(serviceTypeId?: string): Promise<ServicePlanEntity[]> {
    const where: FindOptionsWhere<ServicePlanEntity> = { isActive: true };
    const trimmedTypeId = serviceTypeId?.trim();

    if (trimmedTypeId) {
      where.serviceTypeId = trimmedTypeId;
    }

    return await this.repository.find({
      where,
      relations: ['serviceType'],
      order: { id: 'ASC' },
    });
  }

  async create(dto: Partial<ServicePlanEntity>): Promise<ServicePlanEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<ServicePlanEntity>): Promise<ServicePlanEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    const entity = await this.findByIdOrThrow(id);

    await this.repository.remove(entity);
  }
}
