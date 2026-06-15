import { StatisticsEntityEventType, StatisticsEntityType } from '../../entities/statistics-entity-event.entity';

/**
 * DTO for a single entity event record.
 */
export class StatisticsEntityEventDto {
  id!: string;
  entityType!: StatisticsEntityType;
  eventType!: StatisticsEntityEventType;
  originalEntityId!: string;
  originalUserId?: string;
  clientId?: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  occurredAt!: Date;
}

/**
 * Paginated response for entity events list.
 */
export class StatisticsEntityEventListDto {
  data!: StatisticsEntityEventDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
