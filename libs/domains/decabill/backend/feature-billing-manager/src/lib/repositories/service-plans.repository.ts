import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';

import { ServicePlanEntity } from '../entities/service-plan.entity';
import { applyServiceTypeTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class ServicePlansRepository {
  constructor(
    @InjectRepository(ServicePlanEntity)
    private readonly repository: Repository<ServicePlanEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<ServicePlanEntity> {
    const entity = await this.repository
      .createQueryBuilder('plan')
      .innerJoinAndSelect('plan.serviceType', 'st')
      .where('plan.id = :id', { id })
      .andWhere('st.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Service plan with ID ${id} not found`);
    }

    return entity;
  }

  async findById(id: string): Promise<ServicePlanEntity | null> {
    return await this.repository
      .createQueryBuilder('plan')
      .innerJoinAndSelect('plan.serviceType', 'st')
      .where('plan.id = :id', { id })
      .andWhere('st.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();
  }

  async findAll(limit = 10, offset = 0): Promise<ServicePlanEntity[]> {
    const qb = this.repository
      .createQueryBuilder('plan')
      .innerJoinAndSelect('plan.serviceType', 'st')
      .orderBy('plan.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyServiceTypeTenantFilter(qb, 'st');

    return await qb.getMany();
  }

  /**
   * Active plans with service type relation for public catalog (no inactive or config filtering here).
   */
  async findActiveWithServiceType(limit: number, offset: number, serviceTypeId?: string): Promise<ServicePlanEntity[]> {
    const qb = this.repository
      .createQueryBuilder('plan')
      .innerJoinAndSelect('plan.serviceType', 'st')
      .where('plan.is_active = :isActive', { isActive: true })
      .orderBy('plan.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyServiceTypeTenantFilter(qb, 'st');

    const trimmedTypeId = serviceTypeId?.trim();

    if (trimmedTypeId) {
      qb.andWhere('plan.service_type_id = :serviceTypeId', { serviceTypeId: trimmedTypeId });
    }

    return await qb.getMany();
  }

  /**
   * All active plans with service type (no pagination). Used to pick lowest customer price in application code.
   */
  async findAllActiveWithServiceType(serviceTypeId?: string): Promise<ServicePlanEntity[]> {
    const qb = this.repository
      .createQueryBuilder('plan')
      .innerJoinAndSelect('plan.serviceType', 'st')
      .where('plan.is_active = :isActive', { isActive: true })
      .orderBy('plan.id', 'ASC');

    applyServiceTypeTenantFilter(qb, 'st');

    const trimmedTypeId = serviceTypeId?.trim();

    if (trimmedTypeId) {
      qb.andWhere('plan.service_type_id = :serviceTypeId', { serviceTypeId: trimmedTypeId });
    }

    return await qb.getMany();
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
