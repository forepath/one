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
   */
  async findLatestAgentMessage(agentId: string): Promise<AgentMessageEntity | null> {
    return await this.repository.findOne({
      where: { agentId, actor: 'agent' },
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
