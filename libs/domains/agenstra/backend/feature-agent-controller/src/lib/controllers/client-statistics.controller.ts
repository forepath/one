import { ClientUsersRepository, ensureClientAccess, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query, Req } from '@nestjs/common';

import { ChatDirection } from '../entities/statistics-chat-io.entity';
import { StatisticsEntityEventType, StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { StatisticsQueryService } from '../services/statistics-query.service';

/**
 * Controller for client-scoped statistics endpoints.
 * All endpoints require access to the client via ensureClientAccess.
 */
@Controller('clients/:clientId/statistics')
export class ClientStatisticsController {
  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly statisticsQueryService: StatisticsQueryService,
  ) {}

  /**
   * Get statistics summary for a client.
   * Query params: from, to (ISO date), groupBy (day|hour)
   */
  @Get('summary')
  async getSummary(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: 'day' | 'hour',
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.statisticsQueryService.getClientSummary(clientId, {
      from,
      to,
      groupBy,
    });
  }

  /**
   * Get chat I/O records for a client.
   * Query params: agentId, from, to, direction, interactionKind, limit, offset
   */
  @Get('chat-io')
  async getChatIo(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('agentId') agentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('direction') direction?: ChatDirection,
    @Query('interactionKind') interactionKind?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.statisticsQueryService.getClientChatIo(clientId, {
      agentId,
      from,
      to,
      direction,
      interactionKind,
      search,
      limit,
      offset,
    });
  }

  /**
   * Get filter drops for a client.
   * Query params: agentId, filterType, from, to, limit, offset
   */
  @Get('filter-drops')
  async getFilterDrops(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('agentId') agentId?: string,
    @Query('filterType') filterType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.statisticsQueryService.getClientFilterDrops(clientId, {
      agentId,
      filterType,
      from,
      to,
      search,
      limit,
      offset,
    });
  }

  /**
   * Get filter flags (messages flagged/modified but not dropped) for a client.
   * Query params: agentId, filterType, from, to, limit, offset
   */
  @Get('filter-flags')
  async getFilterFlags(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('agentId') agentId?: string,
    @Query('filterType') filterType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.statisticsQueryService.getClientFilterFlags(clientId, {
      agentId,
      filterType,
      from,
      to,
      search,
      limit,
      offset,
    });
  }

  /**
   * Get entity events for a client.
   * Query params: entityType, eventType, from, to, limit, offset
   */
  @Get('entity-events')
  async getEntityEvents(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('entityType') entityType?: StatisticsEntityType,
    @Query('eventType') eventType?: StatisticsEntityEventType,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.statisticsQueryService.getClientEntityEvents(clientId, {
      entityType,
      eventType,
      from,
      to,
      search,
      limit,
      offset,
    });
  }
}
