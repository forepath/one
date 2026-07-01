import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { applyProjectTenantFilter } from '../../utils/tenant-query.utils';
import { ProjectTicketActivityEntity } from '../entities/project-ticket-activity.entity';

@Injectable()
export class ProjectTicketActivitiesRepository {
  constructor(
    @InjectRepository(ProjectTicketActivityEntity)
    private readonly repository: Repository<ProjectTicketActivityEntity>,
  ) {}

  private baseQuery(alias = 'activity') {
    return this.repository
      .createQueryBuilder(alias)
      .innerJoin('billing_project_tickets', 'ticket', `ticket.id = ${alias}.ticket_id`)
      .innerJoin('billing_projects', 'project', 'project.id = ticket.project_id');
  }

  async findByIdOrThrow(id: string): Promise<ProjectTicketActivityEntity> {
    const qb = this.baseQuery('activity').where('activity.id = :id', { id });

    applyProjectTenantFilter(qb, 'project');

    const entity = await qb.getOne();

    if (!entity) {
      throw new NotFoundException(`Project ticket activity with ID ${id} not found`);
    }

    return entity;
  }

  async findAllByTicket(ticketId: string, limit: number, offset: number): Promise<ProjectTicketActivityEntity[]> {
    const qb = this.baseQuery('activity')
      .where('activity.ticket_id = :ticketId', { ticketId })
      .orderBy('activity.occurredAt', 'DESC')
      .take(limit)
      .skip(offset);

    applyProjectTenantFilter(qb, 'project');

    return await qb.getMany();
  }

  async create(dto: Partial<ProjectTicketActivityEntity>): Promise<ProjectTicketActivityEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
