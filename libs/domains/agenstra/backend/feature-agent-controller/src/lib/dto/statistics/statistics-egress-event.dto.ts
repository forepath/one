/**
 * DTO for one ingested egress guard decision (aggregate of identical decisions within one collection cycle).
 */
export class StatisticsEgressEventDto {
  id!: string;
  clientId!: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  /** `web` | `dns` | `network` | `guard` */
  kind!: string;
  /** `allowed` | `blocked` | `observed` | `error` */
  decision!: string;
  host?: string | null;
  /** Guard rule (`deny_host`, `not_allowlisted`, `private_network`, `ip_literal`, `deny_url`, `offline`, `quic`, …). */
  rule?: string | null;
  matchedEntry?: string | null;
  /** Layer that contributed the matched entry (`global` | `workspace` | `environment`). */
  matchedSource?: string | null;
  method?: string | null;
  httpStatus?: number | null;
  sampleUrl?: string | null;
  count!: number;
  bytesIn!: number;
  bytesOut!: number;
  mode?: string | null;
  policyRevision?: string | null;
  message?: string | null;
  firstSeenAt!: Date;
  occurredAt!: Date;
}

/**
 * Paginated response for egress events list.
 */
export class StatisticsEgressEventListDto {
  data!: StatisticsEgressEventDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
