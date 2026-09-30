import { ChatDirection, StatisticsInteractionKind } from '../../entities/statistics-chat-io.entity';

/**
 * DTO for a single chat I/O record.
 */
export class StatisticsChatIoDto {
  id!: string;
  clientId!: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  originalUserId?: string;
  direction!: ChatDirection;
  interactionKind!: StatisticsInteractionKind;
  wordCount!: number;
  charCount!: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  costUsd?: number | null;
  occurredAt!: Date;
}

/**
 * Paginated response for chat I/O list.
 */
export class StatisticsChatIoListDto {
  data!: StatisticsChatIoDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
