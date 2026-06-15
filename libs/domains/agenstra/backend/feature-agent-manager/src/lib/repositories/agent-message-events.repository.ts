import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, MoreThanOrEqual, Repository } from 'typeorm';

import { AgentMessageEventEntity } from '../entities/agent-message-event.entity';

@Injectable()
export class AgentMessageEventsRepository {
  constructor(
    @InjectRepository(AgentMessageEventEntity)
    private readonly repository: Repository<AgentMessageEventEntity>,
  ) {}

  async create(
    entity: Omit<AgentMessageEventEntity, 'id' | 'agent' | 'createdAt' | 'updatedAt'>,
  ): Promise<AgentMessageEventEntity> {
    const created = this.repository.create(entity);

    return await this.repository.save(created);
  }

  async listRecent(
    agentId: string,
    limit: number,
    opts?: { kinds?: string[]; since?: Date },
  ): Promise<AgentMessageEventEntity[]> {
    const where: FindOptionsWhere<AgentMessageEventEntity> = {
      agentId,
      ...(opts?.kinds?.length ? { kind: In(opts.kinds) } : {}),
      ...(opts?.since ? { eventTimestamp: MoreThanOrEqual(opts.since) } : {}),
    };

    return await this.repository.find({
      where,
      order: { eventTimestamp: 'ASC', sequence: 'ASC' },
      take: limit,
    });
  }
}
