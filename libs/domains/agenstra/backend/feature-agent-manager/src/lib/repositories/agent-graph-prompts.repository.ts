import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgentGraphPromptEntity } from '../entities/agent-graph-prompt.entity';

/**
 * Repository for prompt reference records (one row per turn and environment).
 */
@Injectable()
export class AgentGraphPromptsRepository {
  constructor(
    @InjectRepository(AgentGraphPromptEntity)
    private readonly repository: Repository<AgentGraphPromptEntity>,
  ) {}

  /** Insert or replace the record of one turn (unique per agent and correlation id). */
  async upsert(record: Omit<AgentGraphPromptEntity, 'id' | 'agent' | 'createdAt'>): Promise<void> {
    await this.repository.upsert(record, ['agentId', 'correlationId']);
  }

  /** Latest records first. */
  async findLatest(agentId: string, limit: number): Promise<AgentGraphPromptEntity[]> {
    return this.repository.find({ where: { agentId }, order: { startedAt: 'DESC' }, take: limit });
  }

  async findByCorrelationId(agentId: string, correlationId: string): Promise<AgentGraphPromptEntity | null> {
    return this.repository.findOne({ where: { agentId, correlationId } });
  }

  /** Latest records that reference `ref` (jsonb containment on the references array). */
  async findReferencing(agentId: string, ref: string, limit: number): Promise<AgentGraphPromptEntity[]> {
    return this.repository
      .createQueryBuilder('prompt')
      .where('"prompt"."agent_id" = :agentId', { agentId })
      .andWhere('"prompt"."refs" @> CAST(:needle AS jsonb)', { needle: JSON.stringify([{ ref }]) })
      .orderBy('prompt.startedAt', 'DESC')
      .take(limit)
      .getMany();
  }

  /** Drop all but the newest `keep` records of an environment. */
  async trim(agentId: string, keep: number): Promise<void> {
    await this.repository.query(
      `DELETE FROM "agent_graph_prompts" WHERE "agent_id" = $1 AND "id" NOT IN (
         SELECT "id" FROM "agent_graph_prompts" WHERE "agent_id" = $1 ORDER BY "started_at" DESC LIMIT $2
       )`,
      [agentId, keep],
    );
  }
}
