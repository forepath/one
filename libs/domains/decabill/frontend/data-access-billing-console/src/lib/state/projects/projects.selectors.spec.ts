import { initialProjectsState } from './projects.reducer';
import {
  selectAdminProjects,
  selectCustomerProjects,
  selectProjectSummary,
  selectProjectsBilling,
  selectProjectsCreating,
  selectProjectsDeleting,
  selectProjectsError,
  selectProjectsLoading,
  selectProjectsLoadingDetail,
  selectProjectsLoadingSummary,
  selectProjectsState,
  selectProjectsUpdating,
  selectSelectedProject,
} from './projects.selectors';

describe('projects selectors', () => {
  const project = {
    id: 'p-1',
    userId: 'u-1',
    name: 'Alpha',
    status: 'active' as const,
    hourlyRateNet: 100,
    currency: 'EUR',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const rootState = {
    projects: {
      ...initialProjectsState,
      projects: [project],
      adminProjects: [{ ...project, unbilledMinutes: 0, openBillableAmountNet: 0 }],
      selectedProject: project,
      summary: {
        projectId: 'p-1',
        totalTrackedMinutes: 60,
        unbilledMinutes: 30,
        openBillableAmountNet: 50,
        billedAmountNet: 100,
        openTicketCount: 1,
        doneTicketCount: 1,
        milestoneCount: 1,
        openMilestoneCount: 0,
      },
      loading: true,
      loadingDetail: true,
      loadingSummary: true,
      creating: true,
      updating: true,
      deleting: true,
      billing: true,
      error: 'failed',
    },
  };

  it('selects projects state fields', () => {
    expect(selectProjectsState(rootState as never)).toEqual(rootState.projects);
    expect(selectCustomerProjects(rootState as never)).toEqual([project]);
    expect(selectAdminProjects(rootState as never)).toHaveLength(1);
    expect(selectSelectedProject(rootState as never)).toEqual(project);
    expect(selectProjectSummary(rootState as never)?.projectId).toBe('p-1');
    expect(selectProjectsLoading(rootState as never)).toBe(true);
    expect(selectProjectsLoadingDetail(rootState as never)).toBe(true);
    expect(selectProjectsLoadingSummary(rootState as never)).toBe(true);
    expect(selectProjectsCreating(rootState as never)).toBe(true);
    expect(selectProjectsUpdating(rootState as never)).toBe(true);
    expect(selectProjectsDeleting(rootState as never)).toBe(true);
    expect(selectProjectsBilling(rootState as never)).toBe(true);
    expect(selectProjectsError(rootState as never)).toBe('failed');
  });
});
