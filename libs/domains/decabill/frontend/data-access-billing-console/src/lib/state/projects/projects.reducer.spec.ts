import {
  billProjectTime,
  billProjectTimeSuccess,
  createAdminProjectSuccess,
  deleteAdminProjectSuccess,
  loadAdminProjectsBatch,
  loadProjects,
  loadProjectsBatch,
  loadProjectsFailure,
  loadProjectsSuccess,
  loadProjectSummarySuccess,
  updateAdminProjectSuccess,
} from './projects.actions';
import { initialProjectsState, projectsReducer } from './projects.reducer';

describe('projectsReducer', () => {
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

  it('sets loading on loadProjects', () => {
    const state = projectsReducer(initialProjectsState, loadProjects());

    expect(state.loading).toBe(true);
    expect(state.projects).toEqual([]);
  });

  it('stores projects on success', () => {
    const state = projectsReducer(
      { ...initialProjectsState, loading: true },
      loadProjectsSuccess({ projects: [project] }),
    );

    expect(state.projects).toEqual([project]);
    expect(state.loading).toBe(false);
  });

  it('stores admin projects on batch', () => {
    const state = projectsReducer(
      initialProjectsState,
      loadAdminProjectsBatch({ offset: 10, accumulatedProjects: [project] }),
    );

    expect(state.adminProjects).toEqual([project]);
    expect(state.loading).toBe(true);
  });

  it('stores summary on success', () => {
    const summary = {
      projectId: 'p-1',
      totalTrackedMinutes: 60,
      unbilledMinutes: 30,
      openBillableAmountNet: 50,
      billedAmountNet: 100,
      openTicketCount: 2,
      doneTicketCount: 1,
      milestoneCount: 1,
    };
    const state = projectsReducer(initialProjectsState, loadProjectSummarySuccess({ summary }));

    expect(state.summary).toEqual(summary);
    expect(state.loadingSummary).toBe(false);
  });

  it('prepends admin project on create success', () => {
    const state = projectsReducer({ ...initialProjectsState, creating: true }, createAdminProjectSuccess({ project }));

    expect(state.creating).toBe(false);
    expect(state.adminProjects[0]).toEqual({
      ...project,
      unbilledMinutes: 0,
      openBillableAmountNet: 0,
    });
  });

  it('stores error on failure', () => {
    const state = projectsReducer({ ...initialProjectsState, loading: true }, loadProjectsFailure({ error: 'failed' }));

    expect(state.error).toBe('failed');
    expect(state.loading).toBe(false);
  });

  it('updates admin project on success', () => {
    const state = projectsReducer(
      { ...initialProjectsState, adminProjects: [project], updating: true },
      updateAdminProjectSuccess({ project: { ...project, name: 'Beta' } }),
    );

    expect(state.adminProjects[0].name).toBe('Beta');
    expect(state.updating).toBe(false);
  });

  it('removes admin project on delete success', () => {
    const state = projectsReducer(
      { ...initialProjectsState, adminProjects: [project], deleting: true },
      deleteAdminProjectSuccess({ projectId: 'p-1' }),
    );

    expect(state.adminProjects).toEqual([]);
    expect(state.deleting).toBe(false);
  });

  it('sets billing flag', () => {
    const billing = projectsReducer(
      initialProjectsState,
      billProjectTime({
        projectId: 'p-1',
        dto: { from: '2026-06-01T08:00:00.000Z', to: '2026-06-01T17:00:00.000Z' },
      }),
    );
    const done = projectsReducer(
      billing,
      billProjectTimeSuccess({ projectId: 'p-1', result: { invoiceId: 'i-1', billedMinutes: 30, amountNet: 50 } }),
    );

    expect(billing.billing).toBe(true);
    expect(done.billing).toBe(false);
  });
});
