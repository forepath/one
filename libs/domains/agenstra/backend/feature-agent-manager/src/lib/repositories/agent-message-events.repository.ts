import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';

import { AgentMessageEventEntity } from '../entities/agent-message-event.entity';

@Injectable()
export class AgentMessageEventsRepository {
  constructor(
    @InjectRepository(AgentMessageEventEntity)
    private readonly repository: Repository<AgentMessageEventEntity>,
  ) {}

  async create(
    entity: Omit<AgentMessageEventEntity, 'id' | 'agent' | 'chatSession' | 'createdAt' | 'updatedAt'>,
  ): Promise<AgentMessageEventEntity> {
    const created = this.repository.create(entity);

    return await this.repository.save(created);
  }

  async listRecent(
    agentId: string,
    limit: number,
    opts?: { kinds?: string[]; since?: Date; until?: Date; chatSessionId?: string },
  ): Promise<AgentMessageEventEntity[]> {
    let eventTimestamp: FindOptionsWhere<AgentMessageEventEntity>['eventTimestamp'];

    if (opts?.since && opts?.until) {
      eventTimestamp = And(MoreThanOrEqual(opts.since), LessThanOrEqual(opts.until));
    } else if (opts?.since) {
      eventTimestamp = MoreThanOrEqual(opts.since);
    } else if (opts?.until) {
      eventTimestamp = LessThanOrEqual(opts.until);
    }

    const where: FindOptionsWhere<AgentMessageEventEntity> = {
      agentId,
      ...(opts?.chatSessionId ? { chatSessionId: opts.chatSessionId } : {}),
      ...(opts?.kinds?.length ? { kind: In(opts.kinds) } : {}),
      ...(eventTimestamp ? { eventTimestamp } : {}),
    };

    // Newest-first under the cap so late status markers (e.g. answered questions) survive
    // tool-heavy windows; reverse to chronological order for restore consumers.
    const newestFirst = await this.repository.find({
      where,
      order: { eventTimestamp: 'DESC', sequence: 'DESC' },
      take: limit,
    });

    return newestFirst.reverse();
  }
}
