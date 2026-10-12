/**
 * DTO for statistics summary (totals and filter breakdown).
 */
export class StatisticsSummaryDto {
  totalMessages!: number;
  totalWords!: number;
  totalChars!: number;
  avgWordsPerMessage!: number;
  totalInputTokens!: number;
  totalOutputTokens!: number;
  totalTokens!: number;
  totalCostUsd!: number;
  autoEnrichmentRuns!: number;
  autoEnrichmentContexts!: number;
  autoEnrichmentChars!: number;
  filterDropCount!: number;
  filterTypesBreakdown!: { filterType: string; direction: string; count: number }[];
  filterFlagCount!: number;
  filterFlagsBreakdown!: { filterType: string; direction: string; count: number }[];
  series?: { period: string; count: number; wordCount: number; charCount: number }[];
  /** Egress guard decisions (sum of aggregated counts) by decision. */
  egressAllowedCount!: number;
  egressBlockedCount!: number;
  egressObservedCount!: number;
  egressGuardErrorCount!: number;
  /** Decisions by kind (`web` | `dns` | `network` | `guard`) and decision. */
  egressBreakdown!: { kind: string; decision: string; count: number }[];
  /** Most frequently blocked / observed destinations (top 10). */
  egressTopBlockedHosts!: { host: string; count: number }[];
  /** Blocked / observed decisions by guard rule. */
  egressRulesBreakdown!: { rule: string; count: number }[];
  /** Security events over time (only with `groupBy`): message filter drops / flags and egress decisions. */
  securitySeries?: {
    period: string;
    filterDrops: number;
    filterFlags: number;
    egressAllowed: number;
    egressBlocked: number;
    egressObserved: number;
  }[];
}
