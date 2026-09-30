import { Injectable, Logger } from '@nestjs/common';

import { AgentEventEnvelope } from '../providers/agent-events.types';
import { AgentMessageEventsRepository } from '../repositories/agent-message-events.repository';
import { AgentChatSessionsService } from './agent-chat-sessions.service';

@Injectable()
export class AgentMessageEventsService {
  private readonly logger = new Logger(AgentMessageEventsService.name);

  constructor(
    private readonly repository: AgentMessageEventsRepository,
    private readonly agentChatSessionsService: AgentChatSessionsService,
  ) {}

  async persistEvent(agentId: string, event: AgentEventEnvelope, chatSessionId?: string): Promise<void> {
    // Avoid storing high-volume deltas by default; transcript + key events remain.
    if (event.kind === 'assistantDelta') {
      return;
    }

    try {
      const session = await this.agentChatSessionsService.resolveSessionForChat(agentId, chatSessionId);

      await this.repository.create({
        agentId,
        chatSessionId: session.id,
        correlationId: event.correlationId,
        sequence: event.sequence,
        kind: event.kind,
        payload: event.payload,
        eventTimestamp: new Date(event.timestamp),
      });
    } catch (error: unknown) {
      const err = error as { message?: string };

      // Fail-open: persistence should not break live chat.
      this.logger.warn(`Failed to persist agent event: ${err.message}`);
    }
  }

  async listRecentEvents(
    agentId: string,
    limit = 200,
    opts?: { kinds?: string[]; since?: Date; until?: Date; chatSessionId?: string },
  ): Promise<AgentEventEnvelope[]> {
    const chatSessionId =
      opts?.chatSessionId ?? (await this.agentChatSessionsService.resolveSessionForChat(agentId)).id;
    const rows = await this.repository.listRecent(agentId, limit, { ...opts, chatSessionId });

    return rows.map(
      (row) =>
        ({
          eventId: row.id,
          kind: row.kind as AgentEventEnvelope['kind'],
          agentId: row.agentId,
          correlationId: row.correlationId,
          sequence: row.sequence,
          timestamp: row.eventTimestamp.toISOString(),
          payload: row.payload as AgentEventEnvelope['payload'],
          chatId: row.chatSessionId,
        }) as AgentEventEnvelope,
    );
  }
}
