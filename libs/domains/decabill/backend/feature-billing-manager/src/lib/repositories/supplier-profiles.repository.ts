import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SupplierProfileEntity } from '../entities/supplier-profile.entity';
import { applySupplierTenantFilter, getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class SupplierProfilesRepository {
  constructor(
    @InjectRepository(SupplierProfileEntity)
    private readonly repository: Repository<SupplierProfileEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<SupplierProfileEntity> {
    const entity = await this.repository
      .createQueryBuilder('supplier')
      .where('supplier.id = :id', { id })
      .andWhere('supplier.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .getOne();

    if (!entity) {
      throw new NotFoundException(`Supplier profile with ID ${id} not found`);
    }

    return entity;
  }

  async findAll(
    limit: number,
    offset: number,
    search?: string,
  ): Promise<{ items: SupplierProfileEntity[]; total: number }> {
    const qb = this.repository.createQueryBuilder('supplier').orderBy('supplier.updatedAt', 'DESC');

    applySupplierTenantFilter(qb, 'supplier');

    if (search?.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;

      qb.andWhere(
        `(LOWER(COALESCE(supplier.email, '')) LIKE :term
                  OR LOWER(COALESCE(supplier.company, '')) LIKE :term
                  OR LOWER(supplier.supplier_number) LIKE :term
                  OR LOWER(supplier.id::text) LIKE :term
                  OR LOWER(COALESCE(supplier.first_name, '')) LIKE :term
                  OR LOWER(COALESCE(supplier.last_name, '')) LIKE :term)`,
        { term },
      );
    }

    const total = await qb.getCount();
    const items = await qb.take(limit).skip(offset).getMany();

    return { items, total };
  }

  async create(dto: Partial<SupplierProfileEntity>): Promise<SupplierProfileEntity> {
    const entity = this.repository.create({
      ...dto,
      tenantId: dto.tenantId ?? getRequiredTenantId(),
    });

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<SupplierProfileEntity>): Promise<SupplierProfileEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }
}
