import { normalizeEffectiveMessageFilters } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query } from '@nestjs/common';

import { EGRESS_EVENTS_MAX_PAGE_SIZE } from '../constants/egress-guard.constants';
import { AgentEgressDetailsDto, AgentEgressEventDto, AgentEgressEventsPageDto } from '../dto/agent-egress.dto';
import { AgentEgressEventEntity } from '../entities/agent-egress-event.entity';
import { AgentEgressEventsRepository } from '../repositories/agent-egress-events.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentEgressService } from '../services/agent-egress.service';

const RECENT_EVENTS_LIMIT = 50;

function toEventDto(event: AgentEgressEventEntity): AgentEgressEventDto {
  return {
    seq: String(event.seq),
    agentId: event.agentId,
    kind: event.kind,
    decision: event.decision,
    host: event.host ?? null,
    rule: event.rule ?? null,
    matchedEntry: event.matchedEntry ?? null,
    matchedSource: event.matchedSource ?? null,
    method: event.method ?? null,
    httpStatus: event.httpStatus ?? null,
    sampleUrl: event.sampleUrl ?? null,
    count: event.count,
    bytesIn: Number(event.bytesIn ?? 0),
    bytesOut: Number(event.bytesOut ?? 0),
    firstSeenAt: event.firstSeenAt,
    lastSeenAt: event.lastSeenAt,
    mode: event.mode ?? null,
    policyRevision: event.policyRevision ?? null,
    message: event.message ?? null,
  };
}

/**
 * Egress guard (web traffic filtering) status and decision events.
 * `GET /egress/events` is the controller's ingestion feed (monotonic `seq` cursor).
 */
@Controller()
export class AgentsEgressController {
  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly eventsRepository: AgentEgressEventsRepository,
    private readonly agentEgress: AgentEgressService,
  ) {}

  @Get('egress/events')
  async listEvents(
    @Query('afterSeq') afterSeqRaw?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('agentId') agentId?: string,
  ): Promise<AgentEgressEventsPageDto> {
    const afterSeq = afterSeqRaw?.trim() || '0';

    if (!/^\d{1,19}$/.test(afterSeq)) {
      throw new BadRequestException('afterSeq must be a non-negative integer');
    }

    if (agentId !== undefined && !/^[0-9a-f-]{36}$/i.test(agentId)) {
      throw new BadRequestException('agentId must be a UUID');
    }

    const take = Math.min(Math.max(limit ?? 500, 1), EGRESS_EVENTS_MAX_PAGE_SIZE);
    const rows = await this.eventsRepository.findAfter(afterSeq, take + 1, agentId);
    const page = rows.slice(0, take);

    return {
      events: page.map(toEventDto),
      nextSeq: page.length > 0 ? String(page[page.length - 1].seq) : afterSeq,
      hasMore: rows.length > take,
    };
  }

  @Get('agents/:id/egress')
  async getAgentEgress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<AgentEgressDetailsDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(agentId);
    const [status, recent] = await Promise.all([
      this.agentEgress.describe(agent, true),
      this.eventsRepository.findRecentForAgent(agentId, RECENT_EVENTS_LIMIT),
    ]);

    return {
      agentId,
      status,
      policy: agent.egressPolicy ?? null,
      messageFilters: normalizeEffectiveMessageFilters(agent.messageFilters ?? []),
      recentEvents: recent.map(toEventDto),
    };
  }
}
