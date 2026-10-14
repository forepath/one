import type {
  EffectiveEgressPolicy,
  EffectiveMessageFilterRule,
  EgressDecision,
  EgressEventKind,
  EgressRule,
  PlatformPolicyLayer,
} from '@forepath/agenstra/shared/util-opencode-config';

import type { AgentEgressStatus } from '../entities/agent.entity';

/** Live guard container details (only on the dedicated egress endpoint). */
export class AgentEgressGuardRuntimeDto {
  running!: boolean;
  startedAt!: Date | null;
  /** Policy revision the guard reports as active. */
  activeRevision!: string | null;
  proxyRunning!: boolean;
  dnsRunning!: boolean;
}

/** Egress guard status of one agent environment. */
export class AgentEgressStatusDto {
  status!: AgentEgressStatus;
  mode!: EffectiveEgressPolicy['mode'];
  /** Short guard container id (null when the agent never required egress filtering). */
  guardContainerId!: string | null;
  policyRevision!: string | null;
  appliedAt!: Date | null;
  lastError!: string | null;
  guard?: AgentEgressGuardRuntimeDto;
}

/** Full egress view of one agent: status plus the effective policy and message filters in force. */
export class AgentEgressDetailsDto {
  agentId!: string;
  status!: AgentEgressStatusDto;
  policy!: EffectiveEgressPolicy | null;
  messageFilters!: EffectiveMessageFilterRule[];
  recentEvents!: AgentEgressEventDto[];
}

/** One aggregated guard decision (see `agent_egress_events`). */
export class AgentEgressEventDto {
  /** Monotonic cursor (stringified bigint). */
  seq!: string;
  agentId!: string;
  kind!: EgressEventKind;
  decision!: EgressDecision;
  host!: string | null;
  rule!: EgressRule | null;
  matchedEntry!: string | null;
  matchedSource!: PlatformPolicyLayer | null;
  method!: string | null;
  httpStatus!: number | null;
  sampleUrl!: string | null;
  count!: number;
  bytesIn!: number;
  bytesOut!: number;
  firstSeenAt!: Date;
  lastSeenAt!: Date;
  mode!: string | null;
  policyRevision!: string | null;
  message!: string | null;
}

export class AgentEgressEventsPageDto {
  events!: AgentEgressEventDto[];
  /** Cursor to pass as `afterSeq` for the next page (unchanged when no events were returned). */
  nextSeq!: string;
  hasMore!: boolean;
}
