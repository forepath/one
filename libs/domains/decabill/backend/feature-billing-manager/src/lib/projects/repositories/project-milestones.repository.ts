import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { applyProjectTenantFilter } from '../../utils/tenant-query.utils';
import { ProjectMilestoneEntity } from '../entities/project-milestone.entity';

@Injectable()
export class ProjectMilestonesRepository {
  constructor(
    @InjectRepository(ProjectMilestoneEntity)
    private readonly repository: Repository<ProjectMilestoneEntity>,
  ) {}

  private baseQuery(alias = 'milestone') {
    return this.repository
      .createQueryBuilder(alias)
      .innerJoin('billing_projects', 'project', `project.id = ${alias}.project_id`);
  }

  async findByIdOrThrow(id: string): Promise<ProjectMilestoneEntity> {
    const qb = this.baseQuery('milestone').where('milestone.id = :id', { id });

    applyProjectTenantFilter(qb, 'project');

    const entity = await qb.getOne();

    if (!entity) {
      throw new NotFoundException(`Project milestone with ID ${id} not found`);
    }

    return entity;
  }

  async findAllByProject(projectId: string): Promise<ProjectMilestoneEntity[]> {
    const qb = this.baseQuery('milestone')
      .where('milestone.project_id = :projectId', { projectId })
      .orderBy('milestone.sortOrder', 'ASC')
      .addOrderBy('milestone.createdAt', 'ASC');

    applyProjectTenantFilter(qb, 'project');

    return await qb.getMany();
  }

  async create(dto: Partial<ProjectMilestoneEntity>): Promise<ProjectMilestoneEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<ProjectMilestoneEntity>): Promise<ProjectMilestoneEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }
}
