import type { ProjectMilestoneResponse } from '@forepath/decabill/frontend/data-access-billing-console';

import { filterProjectMilestones, resolveProjectMilestoneLabel } from './project-milestone-select';

describe('filterProjectMilestones', () => {
  const milestones: ProjectMilestoneResponse[] = [
    {
      id: 'm1',
      projectId: 'p1',
      name: 'Alpha release',
      sortOrder: 0,
      progressPercent: 0,
      openTicketCount: 0,
      doneTicketCount: 0,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'm2',
      projectId: 'p1',
      name: 'Beta rollout',
      sortOrder: 1,
      progressPercent: 0,
      openTicketCount: 0,
      doneTicketCount: 0,
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('returns all milestones up to the limit when query is empty', () => {
    expect(filterProjectMilestones(milestones, '', 1)).toEqual(milestones.slice(0, 1));
  });

  it('filters milestones by name or id', () => {
    expect(filterProjectMilestones(milestones, 'alpha')).toEqual([milestones[0]]);
    expect(filterProjectMilestones(milestones, 'm2')).toEqual([milestones[1]]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterProjectMilestones(milestones, 'missing')).toEqual([]);
  });
});

describe('resolveProjectMilestoneLabel', () => {
  const milestones: ProjectMilestoneResponse[] = [
    {
      id: 'm1',
      projectId: 'p1',
      name: 'Alpha release',
      sortOrder: 0,
      progressPercent: 0,
      openTicketCount: 0,
      doneTicketCount: 0,
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('returns None when milestone id is missing', () => {
    expect(resolveProjectMilestoneLabel(null, milestones)).toBe('None');
  });

  it('resolves milestone name by id', () => {
    expect(resolveProjectMilestoneLabel('m1', milestones)).toBe('Alpha release');
  });

  it('falls back to id when milestone is unknown', () => {
    expect(resolveProjectMilestoneLabel('unknown', milestones)).toBe('unknown');
  });
});
