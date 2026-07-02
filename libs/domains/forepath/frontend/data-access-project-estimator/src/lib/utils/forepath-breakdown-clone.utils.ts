import type { ProjectBreakdown } from '../types/project-estimator.types';

export function cloneProjectBreakdown(breakdown: ProjectBreakdown): ProjectBreakdown {
  return JSON.parse(JSON.stringify(breakdown)) as ProjectBreakdown;
}
