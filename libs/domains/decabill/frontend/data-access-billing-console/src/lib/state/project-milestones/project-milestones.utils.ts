import type { ProjectMilestoneResponse } from '../../types/projects.types';

export function upsertProjectMilestone(
  milestones: ProjectMilestoneResponse[],
  milestone: ProjectMilestoneResponse,
): ProjectMilestoneResponse[] {
  const idx = milestones.findIndex((m) => m.id === milestone.id);
  const next = idx < 0 ? [...milestones, milestone] : milestones.map((m) => (m.id === milestone.id ? milestone : m));

  return next.sort((a, b) => a.sortOrder - b.sortOrder);
}
