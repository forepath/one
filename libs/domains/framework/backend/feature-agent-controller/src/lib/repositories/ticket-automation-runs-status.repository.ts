import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';

@Injectable()
export class TicketAutomationRunsStatusRepository {
  constructor(
    @InjectRepository(TicketAutomationRunEntity)
    private readonly repository: Repository<TicketAutomationRunEntity>,
  ) {}

  async findLatestUpdatedAtByAgent(clientId: string, agentId: string): Promise<Date | null> {
    const row = await this.repository
      .createQueryBuilder('r')
      .select('MAX(r.updated_at)', 'maxUpdatedAt')
      .where('r.client_id = :clientId', { clientId })
      .andWhere('r.agent_id = :agentId', { agentId })
      .getRawOne<{ maxUpdatedAt: Date | string | null }>();

    if (!row?.maxUpdatedAt) {
      return null;
    }

    return row.maxUpdatedAt instanceof Date ? row.maxUpdatedAt : new Date(row.maxUpdatedAt);
  }

  async findLatestUpdatedAtByClient(clientId: string): Promise<Map<string, Date>> {
    const rows = await this.repository
      .createQueryBuilder('r')
      .select('r.agent_id', 'agentId')
      .addSelect('MAX(r.updated_at)', 'maxUpdatedAt')
      .where('r.client_id = :clientId', { clientId })
      .groupBy('r.agent_id')
      .getRawMany<{ agentId: string; maxUpdatedAt: Date | string }>();
    const map = new Map<string, Date>();

    for (const row of rows) {
      if (row.agentId && row.maxUpdatedAt) {
        map.set(row.agentId, row.maxUpdatedAt instanceof Date ? row.maxUpdatedAt : new Date(row.maxUpdatedAt));
      }
    }

    return map;
  }
}
