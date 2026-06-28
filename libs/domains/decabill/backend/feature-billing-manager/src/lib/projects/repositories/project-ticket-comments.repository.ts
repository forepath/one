import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { applyProjectTenantFilter } from '../../utils/tenant-query.utils';
import { ProjectTicketCommentEntity } from '../entities/project-ticket-comment.entity';

@Injectable()
export class ProjectTicketCommentsRepository {
  constructor(
    @InjectRepository(ProjectTicketCommentEntity)
    private readonly repository: Repository<ProjectTicketCommentEntity>,
  ) {}

  private baseQuery(alias = 'comment') {
    return this.repository
      .createQueryBuilder(alias)
      .innerJoin('billing_project_tickets', 'ticket', `ticket.id = ${alias}.ticket_id`)
      .innerJoin('billing_projects', 'project', 'project.id = ticket.project_id');
  }

  async findByIdOrThrow(id: string): Promise<ProjectTicketCommentEntity> {
    const qb = this.baseQuery('comment').where('comment.id = :id', { id });

    applyProjectTenantFilter(qb, 'project');

    const entity = await qb.getOne();

    if (!entity) {
      throw new NotFoundException(`Project ticket comment with ID ${id} not found`);
    }

    return entity;
  }

  async findAllByTicket(ticketId: string): Promise<ProjectTicketCommentEntity[]> {
    const qb = this.baseQuery('comment')
      .where('comment.ticket_id = :ticketId', { ticketId })
      .orderBy('comment.createdAt', 'ASC');

    applyProjectTenantFilter(qb, 'project');

    return await qb.getMany();
  }

  async create(dto: Partial<ProjectTicketCommentEntity>): Promise<ProjectTicketCommentEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
