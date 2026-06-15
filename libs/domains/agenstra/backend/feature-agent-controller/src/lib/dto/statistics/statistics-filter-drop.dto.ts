import { FilterDropDirection } from '../../entities/statistics-chat-filter-drop.entity';

/**
 * DTO for a single filter drop record.
 */
export class StatisticsFilterDropDto {
  id!: string;
  clientId!: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  originalUserId?: string;
  filterType!: string;
  filterDisplayName!: string;
  filterReason?: string;
  direction!: FilterDropDirection;
  wordCount!: number;
  charCount!: number;
  occurredAt!: Date;
}

/**
 * Paginated response for filter drops list.
 */
export class StatisticsFilterDropListDto {
  data!: StatisticsFilterDropDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
