import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, ForbiddenException, Get, ParseIntPipe, Query, Req } from '@nestjs/common';

import { ChatDirection } from '../entities/statistics-chat-io.entity';
import { StatisticsEntityEventType, StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { ClientsService } from '../services/clients.service';
import { StatisticsQueryService } from '../services/statistics-query.service';

/**
 * Controller for aggregate statistics endpoints.
 * All endpoints resolve accessible client IDs via ClientsService.getAccessibleClientIds.
 * When clientId query param is provided, validates the user has access to that client.
 */
@Controller('statistics')
export class StatisticsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly statisticsQueryService: StatisticsQueryService,
  ) {}

  private async resolveClientIds(clientId: string | undefined, req?: RequestWithUser): Promise<string[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
    const ids = await this.clientsService.getAccessibleClientIds(
      userInfo.userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
    );

    if (clientId) {
      if (!ids.includes(clientId)) {
        throw new ForbiddenException('You do not have access to this client');
      }

      return [clientId];
    }

    return ids;
  }

  /**
   * Get aggregate statistics summary.
   * Query params: clientId?, from, to, groupBy (day|hour)
   */
  @Get('summary')
  async getSummary(
    @Query('clientId') clientId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: 'day' | 'hour',
    @Req() req?: RequestWithUser,
  ) {
    const ids = await this.resolveClientIds(clientId, req);

    return await this.statisticsQueryService.getSummary(ids, { from, to, groupBy });
  }

  /**
   * Get chat I/O records (aggregate or filtered by client).
   * Query params: clientId?, agentId?, from, to, direction, interactionKind, limit, offset
   */
  @Get('chat-io')
  async getChatIo(
    @Query('clientId') clientId?: string,
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
    const ids = await this.resolveClientIds(clientId, req);

    return await this.statisticsQueryService.getChatIo(ids, {
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
   * Get filter drops (aggregate or filtered by client).
   * Query params: clientId?, agentId?, filterType?, from, to, limit, offset
   */
  @Get('filter-drops')
  async getFilterDrops(
    @Query('clientId') clientId?: string,
    @Query('agentId') agentId?: string,
    @Query('filterType') filterType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    const ids = await this.resolveClientIds(clientId, req);

    return await this.statisticsQueryService.getFilterDrops(ids, {
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
   * Get filter flags (messages flagged/modified but not dropped).
   * Query params: clientId?, agentId?, filterType?, from, to, limit, offset
   */
  @Get('filter-flags')
  async getFilterFlags(
    @Query('clientId') clientId?: string,
    @Query('agentId') agentId?: string,
    @Query('filterType') filterType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    const ids = await this.resolveClientIds(clientId, req);

    return await this.statisticsQueryService.getFilterFlags(ids, {
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
   * Get entity events (aggregate or filtered by client).
   * Query params: clientId?, entityType?, eventType?, from, to, limit, offset
   */
  @Get('entity-events')
  async getEntityEvents(
    @Query('clientId') clientId?: string,
    @Query('entityType') entityType?: StatisticsEntityType,
    @Query('eventType') eventType?: StatisticsEntityEventType,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    const ids = await this.resolveClientIds(clientId, req);

    return await this.statisticsQueryService.getEntityEvents(ids, {
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
