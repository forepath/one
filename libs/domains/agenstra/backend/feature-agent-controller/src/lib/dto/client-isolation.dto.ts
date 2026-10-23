import type { IsolationLevel, IsolationLevelCapabilityDto } from '@forepath/agenstra/backend/feature-agent-manager';

/**
 * Container isolation summary of a workspace host, included in workspace (client) responses and
 * returned by `GET /clients/:id/isolation`.
 */
export class ClientIsolationSummaryDto {
  /**
   * False when the agent manager predates isolation levels (it runs every environment with the
   * standard Docker runtime and accepts no isolation selection).
   */
  supported!: boolean;
  /** Strongest ready level (preselected for new environments); `null` when the host cannot run environments. */
  recommendedLevel!: IsolationLevel | null;
  /** Ready levels, strongest first. */
  availableLevels!: IsolationLevel[];
  /** Every level (`standard`, `sandboxed`, `sandboxed-kvm`, `microvm`) is always present. */
  levels!: Record<IsolationLevel, IsolationLevelCapabilityDto>;
  /** Capability revision to submit with environment creation (stale selections are rejected). */
  revision!: string | null;
  probedAt!: string | null;
  probing!: boolean;
  /** True when served from the last stored snapshot because the agent manager was unreachable. */
  stale!: boolean;
}
