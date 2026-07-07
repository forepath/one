export interface ProjectSummaryProgressBar {
  primaryPct: number;
  dangerPct: number;
  isOver: boolean;
  openPct?: number;
}

function formatTargetDuration(minutes: number): string {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;

  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

export function hasProjectTargetHours(targetHours: number | null | undefined): targetHours is number {
  return targetHours != null && Number.isFinite(targetHours) && targetHours > 0;
}

export function computeProjectCompletionProgress(
  completedCount: number,
  totalCount: number,
): ProjectSummaryProgressBar {
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return { primaryPct: 100, dangerPct: 0, isOver: false };
  }

  const safeCompleted = Number.isFinite(completedCount) ? Math.max(0, completedCount) : 0;

  return {
    primaryPct: clampPercent((safeCompleted / totalCount) * 100),
    dangerPct: 0,
    isOver: false,
  };
}

export function computeProjectOpenDoneProgress(openCount: number, doneCount: number): ProjectSummaryProgressBar {
  const totalCount = openCount + doneCount;

  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return { primaryPct: 100, dangerPct: 0, isOver: false };
  }

  const safeOpen = Number.isFinite(openCount) ? Math.max(0, openCount) : 0;
  const safeDone = Number.isFinite(doneCount) ? Math.max(0, doneCount) : 0;

  return {
    openPct: clampPercent((safeOpen / totalCount) * 100),
    primaryPct: clampPercent((safeDone / totalCount) * 100),
    dangerPct: 0,
    isOver: false,
  };
}

export function computeProjectTicketsDoneProgress(
  openTicketCount: number,
  doneTicketCount: number,
): ProjectSummaryProgressBar {
  const totalCount = openTicketCount + doneTicketCount;

  return computeProjectCompletionProgress(doneTicketCount, totalCount);
}

export function computeProjectMilestonesCompleteProgress(
  openMilestoneCount: number,
  milestoneCount: number,
): ProjectSummaryProgressBar {
  const completedCount = milestoneCount - openMilestoneCount;

  return computeProjectCompletionProgress(completedCount, milestoneCount);
}

export function computeProjectTargetHoursProgress(
  trackedMinutes: number,
  targetHours: number | null | undefined,
): ProjectSummaryProgressBar {
  if (!hasProjectTargetHours(targetHours)) {
    return { primaryPct: 100, dangerPct: 0, isOver: false };
  }

  const safeTrackedMinutes = Number.isFinite(trackedMinutes) ? Math.max(0, trackedMinutes) : 0;
  const targetMinutes = targetHours * 60;

  if (targetMinutes <= 0) {
    return { primaryPct: 100, dangerPct: 0, isOver: false };
  }

  if (safeTrackedMinutes <= targetMinutes) {
    return {
      primaryPct: clampPercent((safeTrackedMinutes / targetMinutes) * 100),
      dangerPct: 0,
      isOver: false,
    };
  }

  return {
    primaryPct: clampPercent((targetMinutes / safeTrackedMinutes) * 100),
    dangerPct: clampPercent(((safeTrackedMinutes - targetMinutes) / safeTrackedMinutes) * 100),
    isOver: true,
  };
}

export function formatProjectTargetHoursDuration(targetHours: number): string {
  return formatTargetDuration(targetHours * 60);
}

export function formatProjectTargetHoursLabel(targetHours: number): string {
  const formatted = formatProjectTargetHoursDuration(targetHours);

  return $localize`:@@featureProjectDetail-targetTime:Target: ${formatted}`;
}
