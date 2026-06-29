import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { applyProjectTenantFilter } from '../../utils/tenant-query.utils';
import { ProjectTicketEntity } from '../entities/project-ticket.entity';
import { ProjectTicketStatus } from '../entities/project.enums';

@Injectable()
export class ProjectTicketsRepository {
  constructor(
    @InjectRepository(ProjectTicketEntity)
    private readonly repository: Repository<ProjectTicketEntity>,
  ) {}

  private baseQuery(alias = 'ticket') {
    return this.repository
      .createQueryBuilder(alias)
      .innerJoin('billing_projects', 'project', `project.id = ${alias}.project_id`);
  }

  async findByIdOrThrow(id: string): Promise<ProjectTicketEntity> {
    const qb = this.baseQuery('ticket').where('ticket.id = :id', { id });

    applyProjectTenantFilter(qb, 'project');

    const entity = await qb.getOne();

    if (!entity) {
      throw new NotFoundException(`Project ticket with ID ${id} not found`);
    }

    return entity;
  }

  async findTitlesByIds(ids: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim().length > 0))];
    const titles = new Map<string, string>();

    if (uniqueIds.length === 0) {
      return titles;
    }

    const qb = this.baseQuery('ticket')
      .select(['ticket.id', 'ticket.title'])
      .where('ticket.id IN (:...ids)', { ids: uniqueIds });

    applyProjectTenantFilter(qb, 'project');

    const rows = await qb.getMany();

    for (const row of rows) {
      titles.set(row.id, row.title);
    }

    return titles;
  }

  async findAllByProject(
    projectId: string,
    filters?: { status?: ProjectTicketStatus; parentId?: string | null },
  ): Promise<ProjectTicketEntity[]> {
    const qb = this.baseQuery('ticket')
      .where('ticket.project_id = :projectId', { projectId })
      .orderBy('ticket.updatedAt', 'DESC');

    applyProjectTenantFilter(qb, 'project');

    if (filters?.status) {
      qb.andWhere('ticket.status = :status', { status: filters.status });
    }

    if (filters?.parentId === null) {
      qb.andWhere('ticket.parent_id IS NULL');
    } else if (filters?.parentId !== undefined) {
      qb.andWhere('ticket.parent_id = :parentId', { parentId: filters.parentId });
    }

    return await qb.getMany();
  }

  async countByMilestone(milestoneId: string): Promise<{ open: number; done: number }> {
    const rows = await this.baseQuery('ticket')
      .select(['ticket.status'])
      .where('ticket.milestone_id = :milestoneId', { milestoneId })
      .getMany();

    let open = 0;
    let done = 0;

    for (const row of rows) {
      if (row.status === ProjectTicketStatus.DONE || row.status === ProjectTicketStatus.CLOSED) {
        done += 1;
      } else {
        open += 1;
      }
    }

    return { open, done };
  }

  async create(dto: Partial<ProjectTicketEntity>): Promise<ProjectTicketEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<ProjectTicketEntity>): Promise<ProjectTicketEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }
}
