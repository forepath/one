import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgentMessageEntity } from '../entities/agent-message.entity';

/**
 * Repository for agent message database operations.
 * Abstracts TypeORM-specific details and provides intention-revealing methods.
 */
@Injectable()
export class AgentMessagesRepository {
  constructor(
    @InjectRepository(AgentMessageEntity)
    private readonly repository: Repository<AgentMessageEntity>,
  ) {}

  /**
   * Find a message by ID.
   * @param id - The UUID of the message
   * @returns The message entity if found
   * @throws NotFoundException if message is not found
   */
  async findByIdOrThrow(id: string): Promise<AgentMessageEntity> {
    const message = await this.repository.findOne({ where: { id } });

    if (!message) {
      throw new NotFoundException(`Message with ID ${id} not found`);
    }

    return message;
  }

  /**
   * Find a message by ID without throwing an error.
   * @param id - The UUID of the message
   * @returns The message entity if found, null otherwise
   */
  async findById(id: string): Promise<AgentMessageEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find all messages for a specific agent with pagination.
   * @param agentId - The UUID of the agent
   * @param limit - Maximum number of messages to return
   * @param offset - Number of messages to skip
   * @returns Array of message entities ordered by creation date (newest first)
   */
  async findByAgentId(agentId: string, limit = 50, offset = 0): Promise<AgentMessageEntity[]> {
    return await this.repository.find({
      where: { agentId },
      take: limit,
      skip: offset,
      order: { createdAt: 'ASC' }, // Chronological order for chat history
      relations: ['agent'],
    });
  }

  async findByAgentIdAndChatSessionId(
    agentId: string,
    chatSessionId: string,
    limit = 50,
    offset = 0,
  ): Promise<AgentMessageEntity[]> {
    return await this.repository.find({
      where: { agentId, chatSessionId },
      take: limit,
      skip: offset,
      order: { createdAt: 'ASC' },
      relations: ['agent'],
    });
  }

  async countByAgentIdAndChatSessionId(agentId: string, chatSessionId: string): Promise<number> {
    return await this.repository.count({ where: { agentId, chatSessionId } });
  }

  /**
   * Load a chronological page of messages for restore/pagination.
   * When `beforeMessageId` is null, returns the latest `limit` messages.
   * When set, returns up to `limit` messages strictly older than that cursor (same agent + session).
   * Fetches limit+1 to compute `hasMoreOlder`, then returns ASC-ordered messages.
   */
  async findPageBefore(
    agentId: string,
    chatSessionId: string,
    beforeMessageId: string | null,
    limit: number,
  ): Promise<{ messages: AgentMessageEntity[]; hasMoreOlder: boolean }> {
    const qb = this.repository
      .createQueryBuilder('m')
      .where('m.agent_id = :agentId', { agentId })
      .andWhere('m.chat_session_id = :chatSessionId', { chatSessionId })
      .orderBy('m.created_at', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit + 1);

    if (beforeMessageId) {
      const cursor = await this.repository.findOne({
        where: { id: beforeMessageId, agentId, chatSessionId },
      });

      if (!cursor) {
        throw new NotFoundException('Message not found for this chat session');
      }

      qb.andWhere('(m.created_at < :createdAt OR (m.created_at = :createdAt AND m.id < :id))', {
        createdAt: cursor.createdAt,
        id: cursor.id,
      });
    }

    const newestFirst = await qb.getMany();
    const hasMoreOlder = newestFirst.length > limit;
    const page = hasMoreOlder ? newestFirst.slice(0, limit) : newestFirst;

    return { messages: page.reverse(), hasMoreOlder };
  }

  async deleteByChatSessionId(chatSessionId: string): Promise<number> {
    const result = await this.repository.delete({ chatSessionId });

    return result.affected || 0;
  }

  /**
   * Find all messages with pagination.
   * @param limit - Maximum number of messages to return
   * @param offset - Number of messages to skip
   * @returns Array of message entities
   */
  async findAll(limit = 50, offset = 0): Promise<AgentMessageEntity[]> {
    return await this.repository.find({
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
      relations: ['agent'],
    });
  }

  /**
   * Count total number of messages.
   * @returns Total count of messages
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Count messages for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Total count of messages for the agent
   */
  async countByAgentId(agentId: string): Promise<number> {
    return await this.repository.count({ where: { agentId } });
  }

  /**
   * Find the most recent agent-authored message for an environment.
   * @param chatSessionId - When set, limit to that visible chat session
   */
  async findLatestAgentMessage(agentId: string, chatSessionId?: string): Promise<AgentMessageEntity | null> {
    return await this.repository.findOne({
      where: chatSessionId ? { agentId, actor: 'agent', chatSessionId } : { agentId, actor: 'agent' },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Create a new message.
   * @param dto - Data transfer object for creating a message
   * @returns The created message entity
   */
  async create(dto: Partial<AgentMessageEntity>): Promise<AgentMessageEntity> {
    const message = this.repository.create(dto);

    return await this.repository.save(message);
  }

  /**
   * Delete a message by ID.
   * @param id - The UUID of the message to delete
   * @throws NotFoundException if message is not found
   */
  async delete(id: string): Promise<void> {
    const message = await this.findByIdOrThrow(id);

    await this.repository.remove(message);
  }

  /**
   * Delete all messages for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Number of messages deleted
   */
  async deleteByAgentId(agentId: string): Promise<number> {
    const result = await this.repository.delete({ agentId });

    return result.affected || 0;
  }
}
