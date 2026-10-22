import type {
  IsolationLevel,
  IsolationReasonCode,
  IsolationRuntimeState,
  IsolationSelectionSource,
} from '../constants/container-isolation.constants';

/**
 * State of one isolation level on an agent manager host.
 */
export class IsolationLevelCapabilityDto {
  /** Strength rank (`1` = standard, `2` = sandboxed, `3` = sandboxed-kvm, `4` = microvm). */
  rank!: number;
  /** Docker runtime name used for this level (`runc`, `runsc-systrap`, `runsc-kvm`). */
  runtime!: string;
  state!: IsolationRuntimeState;
  /** Stable machine-readable reason when the level is not `ready`. */
  reasonCode?: IsolationReasonCode | string;
  /** Short operator-facing explanation (never contains secrets or workspace content). */
  reason?: string;
}

/**
 * Isolation capability record of an agent manager host, derived from real runtime probes.
 */
export class HostIsolationCapabilitiesDto {
  /** Content hash of the probed host state; changes whenever capabilities change. */
  revision!: string;
  /** ISO timestamp of the last completed probe (`null` before the first probe finished). */
  probedAt!: string | null;
  /** True while a probe is running (states reflect the previous probe). */
  probing!: boolean;
  levels!: Record<IsolationLevel, IsolationLevelCapabilityDto>;
  /** Strongest ready level, or `null` when the host cannot run environments at all. */
  recommendedLevel!: IsolationLevel | null;
  /** Ready levels, strongest first. */
  availableLevels!: IsolationLevel[];
}

/**
 * How the isolation level of an environment was selected (audit record).
 */
export class AgentIsolationSelectionDto {
  /** Level that was automatically recommended when the environment was created. */
  automaticSelection?: IsolationLevel | null;
  /** Level the environment actually runs with. */
  effectiveSelection!: IsolationLevel;
  selectionSource!: IsolationSelectionSource;
  /** Controller user id that made the selection (when known). */
  selectedBy?: string | null;
  /** ISO timestamp of the selection. */
  selectedAt!: string;
  /** Host capability revision the selection was validated against. */
  capabilityRevision?: string | null;
}

/**
 * Effective container isolation of an environment.
 */
export class AgentIsolationDto {
  level!: IsolationLevel;
  /** Docker runtime the environment's worker container runs on. */
  runtime!: string;
  selection?: AgentIsolationSelectionDto | null;
}
