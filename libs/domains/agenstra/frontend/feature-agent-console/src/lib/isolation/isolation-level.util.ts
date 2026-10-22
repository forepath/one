import type {
  AgentResponseDto,
  ClientIsolationSummaryDto,
  ClientResponseDto,
  IsolationLevel,
  IsolationRuntimeState,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import type { FpcBadgeColor } from '@forepath/shared/frontend/ui-components';

/** Isolation levels from strongest to weakest (`standard` is the floor of every host). */
export const ISOLATION_LEVELS_STRONGEST_FIRST: readonly IsolationLevel[] = ['sandboxed-kvm', 'sandboxed', 'standard'];

const ISOLATION_LEVEL_RANK: Readonly<Record<IsolationLevel, number>> = {
  standard: 1,
  sandboxed: 2,
  'sandboxed-kvm': 3,
};

/** True for the isolation levels this console knows (newer hosts may report levels it does not know yet). */
export function isKnownIsolationLevel(level: unknown): level is IsolationLevel {
  return typeof level === 'string' && (ISOLATION_LEVELS_STRONGEST_FIRST as readonly string[]).includes(level);
}

/** True for the gVisor-backed levels (`sandboxed`, `sandboxed-kvm`). */
export function isGvisorIsolationLevel(level: IsolationLevel): boolean {
  return level === 'sandboxed' || level === 'sandboxed-kvm';
}

type ClientIsolationSource = Pick<ClientResponseDto, 'isolation'> | null | undefined;

export function isolationLevelLabel(level: IsolationLevel): string {
  switch (level) {
    case 'sandboxed-kvm':
      return $localize`:@@featureChat-isolationLevelSandboxedKvm:Sandboxed (gVisor on KVM)`;
    case 'sandboxed':
      return $localize`:@@featureChat-isolationLevelSandboxed:Sandboxed (gVisor)`;
    case 'standard':
      return $localize`:@@featureChat-isolationLevelStandard:Standard Docker`;
    default:
      return level;
  }
}

/** One-line description of a level for the Add Environment dialog. */
export function isolationLevelDescription(level: IsolationLevel): string {
  switch (level) {
    case 'sandboxed-kvm':
      return $localize`:@@featureChat-isolationSandboxedKvmDescription:Runs through gVisor's application kernel, isolated with hardware virtualization (KVM).`;
    case 'sandboxed':
      return $localize`:@@featureChat-isolationSandboxedDescription:Runs through gVisor's userspace application kernel.`;
    case 'standard':
      return $localize`:@@featureChat-isolationStandardDescription:Maximum compatibility; shares the workspace host's Linux kernel.`;
    default:
      return '';
  }
}

/** Texts of the confirmation shown when a weaker level than the recommended one is chosen. */
export interface IsolationDowngradeDialogTexts {
  title: string;
  message: string;
  confirmLabel: string;
}

export function isolationDowngradeDialogTexts(level: IsolationLevel): IsolationDowngradeDialogTexts {
  if (level === 'sandboxed') {
    return {
      title: $localize`:@@featureChat-isolationConfirmSandboxedTitle:Use the gVisor sandbox without KVM?`,
      message: $localize`:@@featureChat-isolationConfirmSandboxedMessage:Sandboxed (gVisor) runs gVisor's application kernel without hardware virtualization. The recommended level additionally isolates it with KVM, so a flaw in gVisor is harder to exploit.`,
      confirmLabel: $localize`:@@featureChat-isolationConfirmSandboxedConfirm:Use Sandboxed (gVisor)`,
    };
  }

  return {
    title: $localize`:@@featureChat-isolationConfirmStandardTitle:Use Standard Docker?`,
    message: $localize`:@@featureChat-isolationConfirmStandardMessage:Standard Docker has lower isolation than the recommended gVisor sandbox. The container will interact with the workspace host's Linux kernel through Docker's normal namespace, capability and seccomp controls.`,
    confirmLabel: $localize`:@@featureChat-isolationConfirmStandardConfirm:Use Standard Docker`,
  };
}

/**
 * Levels offered in the Add Environment dialog, strongest first: standard and sandboxed always (an
 * unavailable level is shown disabled with its reason), stronger levels only when the workspace host
 * reports them (agent controllers that predate a level do not).
 */
export function getSelectableIsolationLevels(client: ClientIsolationSource): IsolationLevel[] {
  return ISOLATION_LEVELS_STRONGEST_FIRST.filter(
    (level) => level === 'standard' || level === 'sandboxed' || !!client?.isolation?.levels?.[level],
  );
}

export function isolationRuntimeStateLabel(state: IsolationRuntimeState): string {
  switch (state) {
    case 'ready':
      return $localize`:@@featureChat-isolationStateReady:Ready`;
    case 'unsupported':
      return $localize`:@@featureChat-isolationStateUnsupported:Not supported`;
    case 'installation-failed':
      return $localize`:@@featureChat-isolationStateInstallationFailed:Installation failed`;
    case 'probe-failed':
      return $localize`:@@featureChat-isolationStateProbeFailed:Check failed`;
    case 'disabled-by-admin':
      return $localize`:@@featureChat-isolationStateDisabledByAdmin:Disabled by administrator`;
    default:
      return state;
  }
}

/** True when the workspace's agent manager reports isolation levels (legacy managers run standard only). */
export function isIsolationSupported(client: ClientIsolationSource): boolean {
  return client?.isolation?.supported === true;
}

/**
 * Level to preselect for a new environment. Legacy / unknown hosts fall back to `standard`;
 * `null` when the host reports that it cannot run environments at all.
 */
export function getRecommendedIsolationLevel(client: ClientIsolationSource): IsolationLevel | null {
  if (!isIsolationSupported(client)) {
    return 'standard';
  }

  return client?.isolation?.recommendedLevel ?? null;
}

/** Ready levels of the workspace host, strongest first (legacy / unknown hosts: `standard` only). */
export function getAvailableIsolationLevels(client: ClientIsolationSource): IsolationLevel[] {
  if (!isIsolationSupported(client)) {
    return ['standard'];
  }

  return (client?.isolation?.availableLevels ?? [])
    .filter(isKnownIsolationLevel)
    .sort((left, right) => ISOLATION_LEVEL_RANK[right] - ISOLATION_LEVEL_RANK[left]);
}

export function isIsolationLevelAvailable(client: ClientIsolationSource, level: IsolationLevel): boolean {
  return getAvailableIsolationLevels(client).includes(level);
}

/** True when `selected` is weaker than the recommended level (needs an explicit confirmation). */
export function isIsolationDowngrade(selected: IsolationLevel, recommended: IsolationLevel | null): boolean {
  if (!recommended) {
    return false;
  }

  return ISOLATION_LEVEL_RANK[selected] < ISOLATION_LEVEL_RANK[recommended];
}

/** Why a level cannot be selected on the workspace host (`null` when it is available). */
export function getIsolationLevelUnavailableReason(
  client: ClientIsolationSource,
  level: IsolationLevel,
): string | null {
  if (isIsolationLevelAvailable(client, level)) {
    return null;
  }

  if (!isIsolationSupported(client)) {
    return $localize`:@@featureChat-isolationLegacyManager:The workspace's agent manager does not support isolation levels yet.`;
  }

  const capability = client?.isolation?.levels?.[level];

  if (!capability) {
    return null;
  }

  return capability.reason?.trim() || isolationRuntimeStateLabel(capability.state);
}

export function getIsolationBadgeColor(level: IsolationLevel): FpcBadgeColor {
  if (level === 'sandboxed-kvm') {
    return 'primary';
  }

  return level === 'sandboxed' ? 'success' : 'secondary';
}

/** Effective isolation level of an environment (environments created before isolation levels run standard). */
export function getEnvironmentIsolationLevel(
  agent: Pick<AgentResponseDto, 'isolation'> | null | undefined,
): IsolationLevel {
  return agent?.isolation?.level ?? 'standard';
}

/** Short workspace list indicator (`null` while the isolation summary is unknown). */
export function getWorkspaceIsolationIndicatorLabel(client: ClientIsolationSource): string | null {
  if (!client?.isolation) {
    return null;
  }

  if (isIsolationLevelAvailable(client, 'sandboxed-kvm')) {
    return $localize`:@@featureChat-isolationSandboxKvmAvailable:KVM sandbox available`;
  }

  if (isIsolationLevelAvailable(client, 'sandboxed')) {
    return $localize`:@@featureChat-isolationSandboxAvailable:Sandbox available`;
  }

  if (isIsolationSupported(client) && getAvailableIsolationLevels(client).length === 0) {
    return $localize`:@@featureChat-isolationNoRuntimeReady:No runtime ready`;
  }

  return $localize`:@@featureChat-isolationStandardOnly:Standard only`;
}

/**
 * Add Environment isolation selection state:
 * - `explicitLevel`: level the user picked via the radio buttons (`null` = follow the host recommendation;
 *   the preselected recommendation is not an explicit choice).
 * - `pinnedRevision`: capability revision the displayed levels were based on (submitted as `capabilityRevision`).
 * - `reviewRequired`: capabilities changed after an explicit choice; the user must pick a level again.
 */
export interface IsolationSelectionState {
  explicitLevel: IsolationLevel | null;
  pinnedRevision: string | null;
  reviewRequired: boolean;
}

export const INITIAL_ISOLATION_SELECTION: IsolationSelectionState = {
  explicitLevel: null,
  pinnedRevision: null,
  reviewRequired: false,
};

/**
 * Applies freshly loaded host capabilities to the selection. Without an explicit choice the pin follows the
 * displayed (latest) revision. After an explicit choice a changed revision never switches the level silently:
 * the choice is reset, the new revision pinned and a review required.
 */
export function reconcileIsolationSelection(
  state: IsolationSelectionState,
  isolation: ClientIsolationSummaryDto | null | undefined,
): IsolationSelectionState {
  const revision = isolation?.revision ?? null;

  if (revision === state.pinnedRevision) {
    return state;
  }

  if (state.explicitLevel === null) {
    return { ...state, pinnedRevision: revision };
  }

  return { explicitLevel: null, pinnedRevision: revision, reviewRequired: true };
}

/** Level shown as selected: the explicit choice, else the recommendation (none while a review is required). */
export function getDisplayedIsolationLevel(
  state: IsolationSelectionState,
  client: ClientIsolationSource,
): IsolationLevel | null {
  if (state.explicitLevel) {
    return state.explicitLevel;
  }

  return state.reviewRequired ? null : getRecommendedIsolationLevel(client);
}

/** Why the Add Environment form cannot be submitted with the current isolation selection. */
export type IsolationSubmissionBlockedReason = 'review-required' | 'level-unavailable' | 'no-level-available';

export interface IsolationSubmission {
  /** Sent only for an explicit user choice (omitted = the server applies its recommendation). */
  isolationLevel?: IsolationLevel;
  /** Revision the user saw; the server rejects stale revisions with 409 instead of silently changing isolation. */
  capabilityRevision?: string;
  blockedReason?: IsolationSubmissionBlockedReason;
}

/**
 * Decides the isolation fields of `POST /clients/:id/agents`. Never replaces an explicit level by another one:
 * an unavailable explicit level blocks the submission until the user picks an available level.
 */
export function resolveIsolationSubmission({
  explicitLevel,
  pinnedRevision,
  reviewRequired = false,
  isolation,
}: {
  explicitLevel: IsolationLevel | null;
  pinnedRevision: string | null;
  reviewRequired?: boolean;
  isolation: ClientIsolationSummaryDto | null | undefined;
}): IsolationSubmission {
  // Legacy agent managers or unknown capabilities: the form can only show Standard Docker, so request it
  // explicitly. Should the manager support isolation after all, it never silently upgrades to a level
  // the user did not see (legacy managers ignore the field).
  if (!isolation?.supported) {
    if (reviewRequired && !explicitLevel) {
      return { blockedReason: 'review-required' };
    }

    if (explicitLevel && explicitLevel !== 'standard') {
      return { blockedReason: 'level-unavailable' };
    }

    return { isolationLevel: 'standard' };
  }

  const client = { isolation };
  const capabilityRevision = pinnedRevision ? { capabilityRevision: pinnedRevision } : {};

  if (explicitLevel) {
    if (!isIsolationLevelAvailable(client, explicitLevel)) {
      return { blockedReason: 'level-unavailable' };
    }

    return { isolationLevel: explicitLevel, ...capabilityRevision };
  }

  if (reviewRequired) {
    return { blockedReason: 'review-required' };
  }

  if (getRecommendedIsolationLevel(client) === null || getAvailableIsolationLevels(client).length === 0) {
    return { blockedReason: 'no-level-available' };
  }

  return { ...capabilityRevision };
}
