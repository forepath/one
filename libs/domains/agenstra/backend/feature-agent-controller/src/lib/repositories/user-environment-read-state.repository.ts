import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { UserEnvironmentReadStateEntity } from '../entities/user-environment-read-state.entity';

@Injectable()
export class UserEnvironmentReadStateRepository {
  constructor(
    @InjectRepository(UserEnvironmentReadStateEntity)
    private readonly repository: Repository<UserEnvironmentReadStateEntity>,
  ) {}

  async findByUserId(userId: string): Promise<UserEnvironmentReadStateEntity[]> {
    return await this.repository.find({ where: { userId } });
  }

  async findOne(userId: string, clientId: string, agentId: string): Promise<UserEnvironmentReadStateEntity | null> {
    return await this.repository.findOne({ where: { userId, clientId, agentId } });
  }

  async upsertReadState(params: {
    userId: string;
    clientId: string;
    agentId: string;
    lastReadAt: Date;
    lastReadAgentMessageId?: string | null;
  }): Promise<UserEnvironmentReadStateEntity> {
    const existing = await this.findOne(params.userId, params.clientId, params.agentId);

    if (existing) {
      existing.lastReadAt = params.lastReadAt;
      existing.lastReadAgentMessageId = params.lastReadAgentMessageId ?? null;

      return await this.repository.save(existing);
    }

    const created = this.repository.create({
      userId: params.userId,
      clientId: params.clientId,
      agentId: params.agentId,
      lastReadAt: params.lastReadAt,
      lastReadAgentMessageId: params.lastReadAgentMessageId ?? null,
    });

    return await this.repository.save(created);
  }

  async findByUserAndClientIds(userId: string, clientIds: string[]): Promise<UserEnvironmentReadStateEntity[]> {
    if (clientIds.length === 0) {
      return [];
    }

    return await this.repository.find({
      where: { userId, clientId: In(clientIds) },
    });
  }
}
