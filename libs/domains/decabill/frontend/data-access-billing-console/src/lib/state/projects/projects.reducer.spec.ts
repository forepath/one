import {
  billProjectTime,
  billProjectTimeFailure,
  billProjectTimeSuccess,
  clearProjectsError,
  createAdminProject,
  createAdminProjectFailure,
  createAdminProjectSuccess,
  deleteAdminProject,
  deleteAdminProjectFailure,
  deleteAdminProjectSuccess,
  loadAdminProjectDetail,
  loadAdminProjectDetailFailure,
  loadAdminProjectDetailSuccess,
  loadAdminProjects,
  loadAdminProjectsBatch,
  loadAdminProjectsFailure,
  loadAdminProjectsSuccess,
  loadProjectDetail,
  loadProjectDetailFailure,
  loadProjectDetailSuccess,
  loadProjects,
  loadProjectsBatch,
  loadProjectsFailure,
  loadProjectsSuccess,
  loadProjectSummary,
  loadProjectSummaryFailure,
  loadProjectSummarySuccess,
  projectSummaryChanged,
  updateAdminProject,
  updateAdminProjectFailure,
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
      openMilestoneCount: 0,
    };
    const state = projectsReducer(initialProjectsState, loadProjectSummarySuccess({ summary }));

    expect(state.summary).toEqual(summary);
    expect(state.loadingSummary).toBe(false);
  });

  it('updates selected project targetHours on admin update success', () => {
    const withTarget = { ...project, targetHours: 40 };
    const loaded = projectsReducer(initialProjectsState, loadProjectDetailSuccess({ project: withTarget }));
    const updated = projectsReducer(loaded, updateAdminProjectSuccess({ project: { ...withTarget, targetHours: 20 } }));

    expect(updated.selectedProject?.targetHours).toBe(20);
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

  it('stores projects batch and admin batch', () => {
    const projectsBatch = projectsReducer(
      initialProjectsState,
      loadProjectsBatch({ offset: 10, accumulatedProjects: [project] }),
    );
    const adminBatch = projectsReducer(
      initialProjectsState,
      loadAdminProjectsBatch({ offset: 10, accumulatedProjects: [project] }),
    );

    expect(projectsBatch.projects).toEqual([project]);
    expect(adminBatch.adminProjects).toEqual([project]);
  });

  it('loads admin projects and detail', () => {
    const loadingAdmin = projectsReducer(initialProjectsState, loadAdminProjects());
    const adminSuccess = projectsReducer(loadingAdmin, loadAdminProjectsSuccess({ adminProjects: [project] }));
    const loadingDetail = projectsReducer(adminSuccess, loadAdminProjectDetail({ projectId: 'p-1' }));
    const detailSuccess = projectsReducer(
      loadingDetail,
      loadAdminProjectDetailSuccess({
        project: {
          ...project,
          summary: {
            projectId: 'p-1',
            totalTrackedMinutes: 0,
            unbilledMinutes: 0,
            openBillableAmountNet: 0,
            billedAmountNet: 0,
            openTicketCount: 0,
            doneTicketCount: 0,
            milestoneCount: 0,
            openMilestoneCount: 0,
          },
        },
      }),
    );

    expect(loadingAdmin.loading).toBe(true);
    expect(adminSuccess.adminProjects).toEqual([project]);
    expect(detailSuccess.selectedProject?.id).toBe('p-1');
    expect(detailSuccess.summary?.projectId).toBe('p-1');
  });

  it('loads customer project detail and summary', () => {
    const loadingDetail = projectsReducer(initialProjectsState, loadProjectDetail({ projectId: 'p-1' }));
    const detailSuccess = projectsReducer(loadingDetail, loadProjectDetailSuccess({ project }));
    const loadingSummary = projectsReducer(detailSuccess, loadProjectSummary({ projectId: 'p-1' }));
    const summaryChanged = projectsReducer(
      loadingSummary,
      projectSummaryChanged({
        summary: {
          projectId: 'p-1',
          totalTrackedMinutes: 10,
          unbilledMinutes: 5,
          openBillableAmountNet: 1,
          billedAmountNet: 2,
          openTicketCount: 1,
          doneTicketCount: 0,
          milestoneCount: 0,
          openMilestoneCount: 0,
        },
      }),
    );

    expect(detailSuccess.selectedProject).toEqual(project);
    expect(summaryChanged.loadingSummary).toBe(false);
    expect(summaryChanged.summary?.totalTrackedMinutes).toBe(10);
  });

  it('stores admin and customer failures', () => {
    const adminFailure = projectsReducer(
      { ...initialProjectsState, loading: true },
      loadAdminProjectsFailure({ error: 'admin failed' }),
    );
    const detailFailure = projectsReducer(
      { ...initialProjectsState, loadingDetail: true },
      loadProjectDetailFailure({ error: 'detail failed' }),
    );
    const summaryFailure = projectsReducer(
      { ...initialProjectsState, loadingSummary: true },
      loadProjectSummaryFailure({ error: 'summary failed' }),
    );

    expect(adminFailure.error).toBe('admin failed');
    expect(detailFailure.error).toBe('detail failed');
    expect(summaryFailure.error).toBe('summary failed');
  });

  it('tracks create, update, delete and billing failures', () => {
    const creating = projectsReducer(initialProjectsState, createAdminProject({ dto: {} as never }));
    const createFailed = projectsReducer(creating, createAdminProjectFailure({ error: 'create failed' }));
    const updating = projectsReducer(initialProjectsState, updateAdminProject({ projectId: 'p-1', dto: {} }));
    const updateFailed = projectsReducer(updating, updateAdminProjectFailure({ error: 'update failed' }));
    const deleting = projectsReducer(initialProjectsState, deleteAdminProject({ projectId: 'p-1' }));
    const deleteFailed = projectsReducer(deleting, deleteAdminProjectFailure({ error: 'delete failed' }));
    const billFailed = projectsReducer(
      { ...initialProjectsState, billing: true },
      billProjectTimeFailure({ error: 'bill failed' }),
    );

    expect(createFailed.creating).toBe(false);
    expect(updateFailed.updating).toBe(false);
    expect(deleteFailed.deleting).toBe(false);
    expect(billFailed.billing).toBe(false);
    expect(billFailed.error).toBe('bill failed');
  });

  it('clears error', () => {
    const state = projectsReducer({ ...initialProjectsState, error: 'x' }, clearProjectsError());

    expect(state.error).toBeNull();
  });
});
