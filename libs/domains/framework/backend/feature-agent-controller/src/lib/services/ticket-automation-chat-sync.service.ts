import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Socket } from 'socket.io';
import { Repository } from 'typeorm';

import type {
  TicketAutomationRunChatEventDto,
  TicketAutomationRunChatTicketSummaryDto,
} from '../dto/ticket-automation/ticket-automation-run-chat-event.dto';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { ticketAutomationRunEntityToDto } from '../utils/ticket-board-realtime-mappers';

import { AgentConsoleStatusService } from './agent-console-status.service';
import { ClientAutomationChatRealtimeService } from './client-automation-chat-realtime.service';

/** Cap for post-login hydration (per agent + client). */
export const TICKET_AUTOMATION_CHAT_HYDRATE_LIMIT = 100;

/** Only hydrate runs started within this window (reduces payload on busy workspaces). */
export const TICKET_AUTOMATION_CHAT_HYDRATE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const OPEN_RUN_LABEL = 'View automation run';

@Injectable()
export class TicketAutomationChatSyncService {
  private readonly logger = new Logger(TicketAutomationChatSyncService.name);

  constructor(
    @InjectRepository(TicketAutomationRunEntity)
    private readonly runRepo: Repository<TicketAutomationRunEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    @InjectRepository(TicketAutomationEntity)
    private readonly automationRepo: Repository<TicketAutomationEntity>,
    private readonly clientAutomationChatRealtime: ClientAutomationChatRealtimeService,
    private readonly agentConsoleStatusService: AgentConsoleStatusService,
  ) {}

  /**
   * After agent login: replay automation run snapshots for this client+agent (unicast), oldest first.
   */
  async hydrateForAgentClient(socket: Socket, clientId: string, agentId: string): Promise<void> {
    const cutoff = new Date(Date.now() - TICKET_AUTOMATION_CHAT_HYDRATE_MAX_AGE_MS);
    const runs = await this.runRepo
      .createQueryBuilder('r')
      .where('r.client_id = :clientId', { clientId })
      .andWhere('r.agent_id = :agentId', { agentId })
      .andWhere('r.started_at >= :cutoff', { cutoff })
      .orderBy('r.started_at', 'ASC')
      .take(TICKET_AUTOMATION_CHAT_HYDRATE_LIMIT)
      .getMany();

    for (const run of runs) {
      const payload = await this.buildPayload(run, true);

      if (payload) {
        this.clientAutomationChatRealtime.emitToSocket(socket, payload);
      }
    }

    this.logger.debug(`Hydrated ${runs.length} automation run(s) for chat, client=${clientId} agent=${agentId}`);
  }

  /** Live run snapshot to all sockets in the client room (clients namespace). */
  async emitLiveRunUpdateByRunId(runId: string): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });

    if (!run) {
      return;
    }

    const payload = await this.buildPayload(run, false);

    if (payload) {
      this.clientAutomationChatRealtime.emitToClient(run.clientId, payload);
      void this.agentConsoleStatusService
        .onAutomationChatActivity(run.clientId, run.agentId, run.updatedAt)
        .catch(() => undefined);
    }
  }

  /** Live update when run entity is already loaded and saved. */
  emitLiveRunUpdateFromEntity(run: TicketAutomationRunEntity): void {
    void this.buildPayload(run, false).then((payload) => {
      if (payload) {
        this.clientAutomationChatRealtime.emitToClient(run.clientId, payload);
        void this.agentConsoleStatusService
          .onAutomationChatActivity(run.clientId, run.agentId, run.updatedAt)
          .catch(() => undefined);
      }
    });
  }

  private async buildPayload(
    run: TicketAutomationRunEntity,
    hydrate: boolean,
  ): Promise<TicketAutomationRunChatEventDto | null> {
    const ticket = await this.ticketRepo.findOne({ where: { id: run.ticketId } });

    if (!ticket) {
      this.logger.warn(`ticket_automation_run ${run.id} references missing ticket ${run.ticketId}`);

      return null;
    }

    const automation = await this.automationRepo.findOne({ where: { ticketId: ticket.id } });
    const ticketSummary = this.mapTicketSummary(ticket, automation?.eligible ?? false);
    const runDto = ticketAutomationRunEntityToDto(run);
    const timelineAt = hydrate ? run.startedAt.toISOString() : run.updatedAt.toISOString();

    return {
      timelineAt,
      hydrate,
      ticket: ticketSummary,
      run: runDto,
      actions: [
        {
          type: 'openTicketAutomationRun',
          ticketId: ticket.id,
          runId: run.id,
          label: OPEN_RUN_LABEL,
        },
      ],
    };
  }

  private mapTicketSummary(ticket: TicketEntity, automationEligible: boolean): TicketAutomationRunChatTicketSummaryDto {
    return {
      id: ticket.id,
      clientId: ticket.clientId,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
      automationEligible,
      preferredChatAgentId: ticket.preferredChatAgentId ?? null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }
}
