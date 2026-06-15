import { FilterFlagDirection } from '../../entities/statistics-chat-filter-flag.entity';

/**
 * DTO for a single filter flag record (message flagged/modified but not dropped).
 */
export class StatisticsFilterFlagDto {
  id!: string;
  clientId!: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  originalUserId?: string;
  filterType!: string;
  filterDisplayName!: string;
  filterReason?: string;
  direction!: FilterFlagDirection;
  wordCount!: number;
  charCount!: number;
  occurredAt!: Date;
}

/**
 * Paginated response for filter flags list.
 */
export class StatisticsFilterFlagListDto {
  data!: StatisticsFilterFlagDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
