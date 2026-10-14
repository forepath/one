import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';

import { AgentEgressEventEntity } from '../entities/agent-egress-event.entity';

export type NewAgentEgressEvent = Omit<AgentEgressEventEntity, 'seq' | 'createdAt'>;

@Injectable()
export class AgentEgressEventsRepository {
  constructor(
    @InjectRepository(AgentEgressEventEntity)
    private readonly repository: Repository<AgentEgressEventEntity>,
  ) {}

  async insertMany(events: readonly NewAgentEgressEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.repository.insert(events.map((event) => this.repository.create(event)));
  }

  /** Events with `seq` strictly greater than `afterSeq`, ascending (controller ingestion cursor). */
  async findAfter(afterSeq: string, limit: number, agentId?: string): Promise<AgentEgressEventEntity[]> {
    return await this.repository.find({
      where: { seq: MoreThan(afterSeq), ...(agentId ? { agentId } : {}) },
      order: { seq: 'ASC' },
      take: limit,
    });
  }

  /** Most recent events for one agent (status endpoint), newest first. */
  async findRecentForAgent(agentId: string, limit: number): Promise<AgentEgressEventEntity[]> {
    return await this.repository.find({
      where: { agentId },
      order: { seq: 'DESC' },
      take: limit,
    });
  }

  async deleteCreatedBefore(cutoff: Date): Promise<number> {
    const result = await this.repository.delete({ createdAt: LessThan(cutoff) });

    return result.affected ?? 0;
  }

  async countByDecision(): Promise<Array<{ kind: string; decision: string; count: number }>> {
    const rows = await this.repository
      .createQueryBuilder('event')
      .select('event.kind', 'kind')
      .addSelect('event.decision', 'decision')
      .addSelect('COALESCE(SUM(event.count), 0)', 'count')
      .groupBy('event.kind')
      .addGroupBy('event.decision')
      .getRawMany<{ kind: string; decision: string; count: string }>();

    return rows.map((row) => ({ kind: row.kind, decision: row.decision, count: Number.parseInt(row.count, 10) || 0 }));
  }
}
