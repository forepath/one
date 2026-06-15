import { Injectable, Logger } from '@nestjs/common';

import { AgentEventEnvelope } from '../providers/agent-events.types';
import { AgentMessageEventsRepository } from '../repositories/agent-message-events.repository';

@Injectable()
export class AgentMessageEventsService {
  private readonly logger = new Logger(AgentMessageEventsService.name);

  constructor(private readonly repository: AgentMessageEventsRepository) {}

  async persistEvent(agentId: string, event: AgentEventEnvelope): Promise<void> {
    // Avoid storing high-volume deltas by default; transcript + key events remain.
    if (event.kind === 'assistantDelta') {
      return;
    }

    try {
      await this.repository.create({
        agentId,
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
    opts?: { kinds?: string[]; since?: Date },
  ): Promise<AgentEventEnvelope[]> {
    const rows = await this.repository.listRecent(agentId, limit, opts);

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
        }) as AgentEventEnvelope,
    );
  }
}
