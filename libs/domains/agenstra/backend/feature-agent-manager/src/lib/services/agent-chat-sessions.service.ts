import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { QueryFailedError } from 'typeorm';

import {
  PRIMARY_CHAT_RESUME_SESSION_SUFFIX,
  buildUserChatResumeSessionSuffix,
  type CreatableAgentChatSessionKind,
} from '../constants/chat-session.constants';
import { AgentChatSessionSummaryDto, ChatSessionResponseDto } from '../dto/chat-session-response.dto';
import { AgentChatSessionEntity } from '../entities/agent-chat-session.entity';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentChatSessionsRepository } from '../repositories/agent-chat-sessions.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';

/**
 * Service for user-visible chat sessions nested under an agent (environment).
 * Hidden session suffixes are not managed here.
 */
@Injectable()
export class AgentChatSessionsService {
  private readonly logger = new Logger(AgentChatSessionsService.name);

  constructor(
    private readonly agentChatSessionsRepository: AgentChatSessionsRepository,
    private readonly agentsRepository: AgentsRepository,
    private readonly agentMessagesRepository: AgentMessagesRepository,
  ) {}

  /**
   * Ensure a primary chat session exists for the agent (idempotent).
   */
  async ensurePrimarySession(agentId: string): Promise<AgentChatSessionEntity> {
    const existing = await this.agentChatSessionsRepository.findPrimaryByAgentId(agentId);

    if (existing) {
      return existing;
    }

    await this.agentsRepository.findByIdOrThrow(agentId);

    try {
      const primary = await this.agentChatSessionsRepository.create({
        agentId,
        title: 'Chat',
        kind: 'primary',
        resumeSessionSuffix: PRIMARY_CHAT_RESUME_SESSION_SUFFIX,
      });

      this.logger.log(`Created primary chat session ${primary.id} for agent ${agentId}`);

      return primary;
    } catch (error) {
      // Concurrent ensurePrimarySession callers can race on the unique primary index.
      if (this.isUniqueViolation(error)) {
        const raced = await this.agentChatSessionsRepository.findPrimaryByAgentId(agentId);

        if (raced) {
          return raced;
        }
      }

      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { code?: string } | undefined;

    return driverError?.code === '23505';
  }

  /** `kind` `handoff` marks a chat opened for a task handed over by another agent (same session layout). */
  async createUserSession(
    agentId: string,
    title?: string,
    kind: CreatableAgentChatSessionKind = 'user',
  ): Promise<AgentChatSessionEntity> {
    await this.agentsRepository.findByIdOrThrow(agentId);
    await this.ensurePrimarySession(agentId);

    const chatId = randomUUID();
    const session = await this.agentChatSessionsRepository.create({
      id: chatId,
      agentId,
      title: title?.trim() || 'Chat',
      kind,
      resumeSessionSuffix: buildUserChatResumeSessionSuffix(chatId),
    });

    this.logger.log(`Created ${kind} chat session ${session.id} for agent ${agentId}`);

    return session;
  }

  async getSession(agentId: string, chatId: string): Promise<AgentChatSessionEntity> {
    return await this.agentChatSessionsRepository.findByAgentIdAndIdOrThrow(agentId, chatId);
  }

  async resolveSessionForChat(agentId: string, chatId?: string): Promise<AgentChatSessionEntity> {
    if (chatId) {
      return await this.getSession(agentId, chatId);
    }

    return await this.ensurePrimarySession(agentId);
  }

  async listSessions(agentId: string, limit = 50, offset = 0): Promise<AgentChatSessionEntity[]> {
    await this.agentsRepository.findByIdOrThrow(agentId);
    await this.ensurePrimarySession(agentId);

    return await this.agentChatSessionsRepository.findByAgentId(agentId, limit, offset);
  }

  async countSessions(agentId: string): Promise<number> {
    await this.agentsRepository.findByIdOrThrow(agentId);
    await this.ensurePrimarySession(agentId);

    return await this.agentChatSessionsRepository.countByAgentId(agentId);
  }

  async updateSessionTitle(agentId: string, chatId: string, title: string): Promise<AgentChatSessionEntity> {
    const session = await this.getSession(agentId, chatId);
    const trimmed = title.trim();

    if (!trimmed) {
      throw new BadRequestException('Title is required');
    }

    return await this.agentChatSessionsRepository.update(session.id, { title: trimmed });
  }

  async deleteSession(agentId: string, chatId: string): Promise<void> {
    const session = await this.getSession(agentId, chatId);

    if (session.kind === 'primary') {
      throw new BadRequestException('The primary chat session cannot be deleted');
    }

    await this.agentChatSessionsRepository.delete(session.id);
    await this.agentsRepository.clearOpencodeSession(agentId, session.resumeSessionSuffix);

    this.logger.log(`Deleted chat session ${chatId} for agent ${agentId}`);
  }

  async touchLastMessageAt(chatSessionId: string, at: Date = new Date()): Promise<void> {
    await this.agentChatSessionsRepository.touchLastMessageAt(chatSessionId, at);
  }

  async getSummariesByAgentIds(agentIds: string[]): Promise<Map<string, AgentChatSessionEntity[]>> {
    const sessions = await this.agentChatSessionsRepository.findAllByAgentIds(agentIds);
    const byAgent = new Map<string, AgentChatSessionEntity[]>();

    for (const agentId of agentIds) {
      byAgent.set(agentId, []);
    }

    for (const session of sessions) {
      const list = byAgent.get(session.agentId);

      if (list) {
        list.push(session);
      } else {
        byAgent.set(session.agentId, [session]);
      }
    }

    return byAgent;
  }

  mapToResponseDto(entity: AgentChatSessionEntity): ChatSessionResponseDto {
    return {
      id: entity.id,
      agentId: entity.agentId,
      title: entity.title ?? undefined,
      kind: entity.kind,
      lastMessageAt: entity.lastMessageAt ?? undefined,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  mapToSummaryDto(entity: AgentChatSessionEntity): AgentChatSessionSummaryDto {
    return {
      id: entity.id,
      title: entity.title ?? undefined,
      kind: entity.kind,
      lastMessageAt: entity.lastMessageAt ?? undefined,
      createdAt: entity.createdAt,
    };
  }

  async getMessagesForSession(
    agentId: string,
    chatId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ id: string; actor: string; message: string; filtered: boolean; createdAt: Date; updatedAt: Date }[]> {
    await this.getSession(agentId, chatId);

    return await this.agentMessagesRepository.findByAgentIdAndChatSessionId(agentId, chatId, limit, offset);
  }

  async countMessagesForSession(agentId: string, chatId: string): Promise<number> {
    await this.getSession(agentId, chatId);

    return await this.agentMessagesRepository.countByAgentIdAndChatSessionId(agentId, chatId);
  }
}
