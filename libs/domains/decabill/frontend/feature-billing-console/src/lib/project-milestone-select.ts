import type { ProjectMilestoneResponse } from '@forepath/decabill/frontend/data-access-billing-console';

export function filterProjectMilestones(
  milestones: ProjectMilestoneResponse[],
  query: string,
  limit = 20,
): ProjectMilestoneResponse[] {
  const term = query.trim().toLowerCase();
  const filtered = term
    ? milestones.filter(
        (milestone) => milestone.name.toLowerCase().includes(term) || milestone.id.toLowerCase().includes(term),
      )
    : milestones;

  return filtered.slice(0, limit);
}

export function resolveProjectMilestoneLabel(
  milestoneId: string | null | undefined,
  milestones: ProjectMilestoneResponse[],
): string {
  if (!milestoneId) {
    return $localize`:@@featureProjectBoard-milestoneNone:None`;
  }

  return milestones.find((milestone) => milestone.id === milestoneId)?.name ?? milestoneId;
}
