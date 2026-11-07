import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AgentGraphEntity } from '../entities/agent-graph.entity';

/**
 * Repository for environment graph indexes. Status reads never load the (large) listing / scan columns.
 */
@Injectable()
export class AgentGraphsRepository {
  constructor(
    @InjectRepository(AgentGraphEntity)
    private readonly repository: Repository<AgentGraphEntity>,
  ) {}

  /** Status row without listing / scan results. */
  async findStatus(agentId: string): Promise<AgentGraphEntity | null> {
    return this.repository.findOne({ where: { agentId } });
  }

  async findStatuses(agentIds: string[]): Promise<AgentGraphEntity[]> {
    if (agentIds.length === 0) {
      return [];
    }

    return this.repository.find({ where: { agentId: In(agentIds) } });
  }

  /** Full row including listing and per-file scan results. */
  async findFull(agentId: string): Promise<AgentGraphEntity | null> {
    return this.repository
      .createQueryBuilder('graph')
      .addSelect(['graph.listing', 'graph.parsed'])
      .where('"graph"."agent_id" = :agentId', { agentId })
      .getOne();
  }

  /** Insert or update the given columns of an environment's row. */
  async upsert(
    agentId: string,
    values: Partial<Omit<AgentGraphEntity, 'agentId' | 'agent' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void> {
    await this.repository.upsert({ agentId, ...values }, ['agentId']);
  }
}
