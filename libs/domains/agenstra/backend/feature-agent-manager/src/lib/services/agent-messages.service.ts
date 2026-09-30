import { Injectable, Logger } from '@nestjs/common';

import { AgentMessageEntity } from '../entities/agent-message.entity';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { AgentChatSessionsService } from './agent-chat-sessions.service';

/**
 * Service for agent message business logic operations.
 * Orchestrates repository operations for persisting and retrieving chat messages.
 */
@Injectable()
export class AgentMessagesService {
  private readonly logger = new Logger(AgentMessagesService.name);

  constructor(
    private readonly agentMessagesRepository: AgentMessagesRepository,
    private readonly agentChatSessionsService: AgentChatSessionsService,
  ) {}

  /**
   * Persist a user message.
   * @param agentId - The UUID of the agent
   * @param message - The message text from the user
   * @param filtered - Whether the message was filtered (default: false)
   * @param chatSessionId - Optional chat session; defaults to primary
   * @returns The created message entity
   */
  async createUserMessage(
    agentId: string,
    message: string,
    filtered = false,
    chatSessionId?: string,
  ): Promise<AgentMessageEntity> {
    const session = await this.agentChatSessionsService.resolveSessionForChat(agentId, chatSessionId);
    const messageEntity = await this.agentMessagesRepository.create({
      agentId,
      chatSessionId: session.id,
      actor: 'user',
      message: message.trim(),
      filtered,
    });

    await this.agentChatSessionsService.touchLastMessageAt(session.id, messageEntity.createdAt);
    this.logger.debug(`Persisted user message for agent ${agentId} chat ${session.id}${filtered ? ' (filtered)' : ''}`);

    return messageEntity;
  }

  /**
   * Persist an agent message.
   * @param agentId - The UUID of the agent
   * @param response - The agent response (can be JSON object or string)
   * @param filtered - Whether the message was filtered (default: false)
   * @param chatSessionId - Optional chat session; defaults to primary
   * @returns The created message entity
   */
  async createAgentMessage(
    agentId: string,
    response: unknown,
    filtered = false,
    chatSessionId?: string,
  ): Promise<AgentMessageEntity> {
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

    const session = await this.agentChatSessionsService.resolveSessionForChat(agentId, chatSessionId);
    const messageEntity = await this.agentMessagesRepository.create({
      agentId,
      chatSessionId: session.id,
      actor: 'agent',
      message: messageContent,
      filtered,
    });

    await this.agentChatSessionsService.touchLastMessageAt(session.id, messageEntity.createdAt);
    this.logger.debug(
      `Persisted agent message for agent ${agentId} chat ${session.id}${filtered ? ' (filtered)' : ''}`,
    );

    return messageEntity;
  }

  /**
   * Get chat history for a specific agent (optionally scoped to a chat session).
   */
  async getChatHistory(agentId: string, limit = 50, offset = 0, chatSessionId?: string): Promise<AgentMessageEntity[]> {
    if (chatSessionId) {
      return await this.agentMessagesRepository.findByAgentIdAndChatSessionId(agentId, chatSessionId, limit, offset);
    }

    const primary = await this.agentChatSessionsService.resolveSessionForChat(agentId);

    return await this.agentMessagesRepository.findByAgentIdAndChatSessionId(agentId, primary.id, limit, offset);
  }

  /**
   * Cursor page of chat history for batched restore (`beforeMessageId` = older than cursor).
   */
  async getChatHistoryPageBefore(
    agentId: string,
    chatSessionId: string,
    beforeMessageId: string | null,
    limit: number,
  ): Promise<{ messages: AgentMessageEntity[]; hasMoreOlder: boolean }> {
    return await this.agentMessagesRepository.findPageBefore(agentId, chatSessionId, beforeMessageId, limit);
  }

  /**
   * Count messages for a specific agent (optionally scoped to a chat session).
   */
  async countMessages(agentId: string, chatSessionId?: string): Promise<number> {
    if (chatSessionId) {
      return await this.agentMessagesRepository.countByAgentIdAndChatSessionId(agentId, chatSessionId);
    }

    const primary = await this.agentChatSessionsService.resolveSessionForChat(agentId);

    return await this.agentMessagesRepository.countByAgentIdAndChatSessionId(agentId, primary.id);
  }

  /**
   * Latest agent-authored message for unread cursor comparison.
   * @param chatSessionId - Optional visible chat session id
   */
  async getLatestAgentMessage(
    agentId: string,
    chatSessionId?: string,
  ): Promise<{ id: string; createdAt: Date } | null> {
    const message = await this.agentMessagesRepository.findLatestAgentMessage(agentId, chatSessionId);

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
