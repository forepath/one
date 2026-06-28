import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { applyProjectTenantFilter } from '../../utils/tenant-query.utils';
import { ProjectTimeEntryEntity } from '../entities/project-time-entry.entity';

@Injectable()
export class ProjectTimeEntriesRepository {
  constructor(
    @InjectRepository(ProjectTimeEntryEntity)
    private readonly repository: Repository<ProjectTimeEntryEntity>,
  ) {}

  private baseQuery(alias = 'entry') {
    return this.repository
      .createQueryBuilder(alias)
      .innerJoin('billing_projects', 'project', `project.id = ${alias}.project_id`);
  }

  async findByIdOrThrow(id: string): Promise<ProjectTimeEntryEntity> {
    const qb = this.baseQuery('entry').where('entry.id = :id', { id });

    applyProjectTenantFilter(qb, 'project');

    const entity = await qb.getOne();

    if (!entity) {
      throw new NotFoundException(`Project time entry with ID ${id} not found`);
    }

    return entity;
  }

  async findAllByProject(
    projectId: string,
    limit: number,
    offset: number,
    ticketId?: string | null,
  ): Promise<{ items: ProjectTimeEntryEntity[]; total: number }> {
    const qb = this.baseQuery('entry')
      .where('entry.project_id = :projectId', { projectId })
      .orderBy('entry.startedAt', 'DESC');

    if (ticketId) {
      qb.andWhere('entry.ticket_id = :ticketId', { ticketId });
    }

    applyProjectTenantFilter(qb, 'project');

    const total = await qb.getCount();
    const items = await qb.take(limit).skip(offset).getMany();

    return { items, total };
  }

  async findUnbilledByProject(projectId: string): Promise<ProjectTimeEntryEntity[]> {
    const qb = this.baseQuery('entry')
      .where('entry.project_id = :projectId', { projectId })
      .andWhere('entry.billed_at IS NULL')
      .orderBy('entry.startedAt', 'ASC');

    applyProjectTenantFilter(qb, 'project');

    return await qb.getMany();
  }

  async findUnbilledTimeBounds(projectId: string): Promise<{
    from: Date | null;
    to: Date | null;
    entryCount: number;
  }> {
    const qb = this.baseQuery('entry')
      .select('MIN(entry.started_at)', 'minStarted')
      .addSelect('MAX(entry.ended_at)', 'maxEnded')
      .addSelect('COUNT(entry.id)', 'entryCount')
      .where('entry.project_id = :projectId', { projectId })
      .andWhere('entry.billed_at IS NULL');

    applyProjectTenantFilter(qb, 'project');

    const row = await qb.getRawOne<{ minStarted: string | null; maxEnded: string | null; entryCount: string }>();

    return {
      from: row?.minStarted ? new Date(row.minStarted) : null,
      to: row?.maxEnded ? new Date(row.maxEnded) : null,
      entryCount: parseInt(row?.entryCount ?? '0', 10),
    };
  }

  async findUnbilledByProjectInRange(projectId: string, from: Date, to: Date): Promise<ProjectTimeEntryEntity[]> {
    const qb = this.baseQuery('entry')
      .where('entry.project_id = :projectId', { projectId })
      .andWhere('entry.billed_at IS NULL')
      .andWhere('entry.started_at >= :from', { from })
      .andWhere('entry.ended_at <= :to', { to })
      .orderBy('entry.startedAt', 'ASC');

    applyProjectTenantFilter(qb, 'project');

    return await qb.getMany();
  }

  async sumDurationMinutes(projectId: string, billed?: boolean): Promise<number> {
    const qb = this.baseQuery('entry')
      .select('COALESCE(SUM(entry.duration_minutes), 0)', 'total')
      .where('entry.project_id = :projectId', { projectId });

    applyProjectTenantFilter(qb, 'project');

    if (billed === true) {
      qb.andWhere('entry.billed_at IS NOT NULL');
    } else if (billed === false) {
      qb.andWhere('entry.billed_at IS NULL');
    }

    const row = await qb.getRawOne<{ total: string }>();

    return parseInt(row?.total ?? '0', 10);
  }

  async create(dto: Partial<ProjectTimeEntryEntity>): Promise<ProjectTimeEntryEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<ProjectTimeEntryEntity>): Promise<ProjectTimeEntryEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async delete(id: string): Promise<void> {
    const entity = await this.findByIdOrThrow(id);

    if (entity.billedAt) {
      throw new NotFoundException(`Project time entry with ID ${id} not found`);
    }

    await this.repository.delete(id);
  }

  async markBilled(ids: string[], invoiceId: string, billedAt: Date): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.repository
      .createQueryBuilder()
      .update(ProjectTimeEntryEntity)
      .set({ invoiceId, billedAt })
      .where('id IN (:...ids)', { ids })
      .execute();
  }
}
