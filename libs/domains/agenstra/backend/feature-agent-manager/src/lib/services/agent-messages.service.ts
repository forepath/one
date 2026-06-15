import { Injectable, Logger } from '@nestjs/common';

import { AgentMessageEntity } from '../entities/agent-message.entity';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';

/**
 * Service for agent message business logic operations.
 * Orchestrates repository operations for persisting and retrieving chat messages.
 */
@Injectable()
export class AgentMessagesService {
  private readonly logger = new Logger(AgentMessagesService.name);

  constructor(private readonly agentMessagesRepository: AgentMessagesRepository) {}

  /**
   * Persist a user message.
   * @param agentId - The UUID of the agent
   * @param message - The message text from the user
   * @param filtered - Whether the message was filtered (default: false)
   * @returns The created message entity
   */
  async createUserMessage(agentId: string, message: string, filtered = false): Promise<AgentMessageEntity> {
    const messageEntity = await this.agentMessagesRepository.create({
      agentId,
      actor: 'user',
      message: message.trim(),
      filtered,
    });

    this.logger.debug(`Persisted user message for agent ${agentId}${filtered ? ' (filtered)' : ''}`);

    return messageEntity;
  }

  /**
   * Persist an agent message.
   * @param agentId - The UUID of the agent
   * @param response - The agent response (can be JSON object or string)
   * @param filtered - Whether the message was filtered (default: false)
   * @returns The created message entity
   */
  async createAgentMessage(agentId: string, response: unknown, filtered = false): Promise<AgentMessageEntity> {
    // Convert response to string representation
    let messageContent: string;

    if (typeof response === 'string') {
      messageContent = response;
    } else if (typeof response === 'object' && response !== null) {
      try {
        messageContent = JSON.stringify(response);
      } catch (error) {
        const err = error as { message?: string };

        this.logger.warn(`Failed to stringify agent response: ${err.message}`);
        messageContent = String(response);
      }
    } else {
      messageContent = String(response);
    }

    const messageEntity = await this.agentMessagesRepository.create({
      agentId,
      actor: 'agent',
      message: messageContent,
      filtered,
    });

    this.logger.debug(`Persisted agent message for agent ${agentId}${filtered ? ' (filtered)' : ''}`);

    return messageEntity;
  }

  /**
   * Get chat history for a specific agent.
   * @param agentId - The UUID of the agent
   * @param limit - Maximum number of messages to return
   * @param offset - Number of messages to skip
   * @returns Array of message entities ordered chronologically
   */
  async getChatHistory(agentId: string, limit = 50, offset = 0): Promise<AgentMessageEntity[]> {
    return await this.agentMessagesRepository.findByAgentId(agentId, limit, offset);
  }

  /**
   * Count messages for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Total count of messages for the agent
   */
  async countMessages(agentId: string): Promise<number> {
    return await this.agentMessagesRepository.countByAgentId(agentId);
  }

  /**
   * Latest agent-authored message for unread cursor comparison.
   */
  async getLatestAgentMessage(agentId: string): Promise<{ id: string; createdAt: Date } | null> {
    const message = await this.agentMessagesRepository.findLatestAgentMessage(agentId);

    if (!message) {
      return null;
    }

    return { id: message.id, createdAt: message.createdAt };
  }

  /**
   * Delete all messages for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Number of messages deleted
   */
  async deleteAllMessages(agentId: string): Promise<number> {
    const deletedCount = await this.agentMessagesRepository.deleteByAgentId(agentId);

    this.logger.log(`Deleted ${deletedCount} messages for agent ${agentId}`);

    return deletedCount;
  }
}
