import {
  createProjectMilestone,
  createProjectMilestoneFailure,
  createProjectMilestoneSuccess,
  deleteProjectMilestone,
  deleteProjectMilestoneFailure,
  deleteProjectMilestoneSuccess,
  loadProjectMilestones,
  loadProjectMilestonesFailure,
  loadProjectMilestonesSuccess,
  lockProjectMilestone,
  lockProjectMilestoneFailure,
  lockProjectMilestoneSuccess,
  projectBoardMilestoneRemoved,
  projectBoardMilestoneUpsert,
  updateProjectMilestone,
  updateProjectMilestoneFailure,
  updateProjectMilestoneSuccess,
} from './project-milestones.actions';
import { initialProjectMilestonesState, projectMilestonesReducer } from './project-milestones.reducer';

describe('projectMilestonesReducer', () => {
  const milestone = {
    id: 'm-1',
    projectId: 'p-1',
    name: 'M1',
    sortOrder: 1,
    progressPercent: 0,
    openTicketCount: 0,
    doneTicketCount: 0,
    createdAt: '',
    updatedAt: '',
  };
  const milestoneTwo = { ...milestone, id: 'm-2', name: 'M2', sortOrder: 0 };

  it('loads milestones', () => {
    const state = projectMilestonesReducer(initialProjectMilestonesState, loadProjectMilestones({ projectId: 'p-1' }));

    expect(state.loading).toBe(true);
    expect(state.projectId).toBe('p-1');
  });

  it('stores milestones on success', () => {
    const state = projectMilestonesReducer(
      { ...initialProjectMilestonesState, loading: true },
      loadProjectMilestonesSuccess({ milestones: [milestone] }),
    );

    expect(state.milestones).toEqual([milestone]);
    expect(state.loading).toBe(false);
  });

  it('stores load failure', () => {
    const state = projectMilestonesReducer(
      { ...initialProjectMilestonesState, loading: true },
      loadProjectMilestonesFailure({ error: 'failed' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('failed');
  });

  it('sets saving on mutations', () => {
    expect(
      projectMilestonesReducer(initialProjectMilestonesState, createProjectMilestone({ dto: {} as never })).saving,
    ).toBe(true);
    expect(
      projectMilestonesReducer(initialProjectMilestonesState, updateProjectMilestone({ id: 'm-1', dto: {} })).saving,
    ).toBe(true);
    expect(projectMilestonesReducer(initialProjectMilestonesState, lockProjectMilestone({ id: 'm-1' })).saving).toBe(
      true,
    );
    expect(projectMilestonesReducer(initialProjectMilestonesState, deleteProjectMilestone({ id: 'm-1' })).saving).toBe(
      true,
    );
  });

  it('adds milestone on create', () => {
    const state = projectMilestonesReducer(initialProjectMilestonesState, createProjectMilestoneSuccess({ milestone }));

    expect(state.milestones).toEqual([milestone]);
    expect(state.saving).toBe(false);
  });

  it('updates and sorts milestones on success', () => {
    const updated = { ...milestoneTwo, sortOrder: 2 };
    const state = projectMilestonesReducer(
      { ...initialProjectMilestonesState, milestones: [milestoneTwo, milestone], saving: true },
      updateProjectMilestoneSuccess({ milestone: updated }),
    );

    expect(state.milestones.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(state.saving).toBe(false);
  });

  it('locks milestone on success', () => {
    const locked = { ...milestone, lockedAt: '2024-01-01' };
    const state = projectMilestonesReducer(
      { ...initialProjectMilestonesState, milestones: [milestone], saving: true },
      lockProjectMilestoneSuccess({ milestone: locked }),
    );

    expect(state.milestones[0].lockedAt).toBe('2024-01-01');
  });

  it('removes milestone on delete success', () => {
    const state = projectMilestonesReducer(
      { ...initialProjectMilestonesState, milestones: [milestone], saving: true },
      deleteProjectMilestoneSuccess({ id: 'm-1' }),
    );

    expect(state.milestones).toEqual([]);
    expect(state.saving).toBe(false);
  });

  it('handles mutation failures', () => {
    expect(
      projectMilestonesReducer(
        { ...initialProjectMilestonesState, saving: true },
        createProjectMilestoneFailure({ error: 'create failed' }),
      ).error,
    ).toBe('create failed');
    expect(
      projectMilestonesReducer(
        { ...initialProjectMilestonesState, saving: true },
        updateProjectMilestoneFailure({ error: 'update failed' }),
      ).error,
    ).toBe('update failed');
    expect(
      projectMilestonesReducer(
        { ...initialProjectMilestonesState, saving: true },
        lockProjectMilestoneFailure({ error: 'lock failed' }),
      ).error,
    ).toBe('lock failed');
    expect(
      projectMilestonesReducer(
        { ...initialProjectMilestonesState, saving: true },
        deleteProjectMilestoneFailure({ error: 'delete failed' }),
      ).error,
    ).toBe('delete failed');
  });

  it('does not duplicate milestone when socket upsert arrives before create success', () => {
    const afterSocket = projectMilestonesReducer(
      initialProjectMilestonesState,
      projectBoardMilestoneUpsert({ milestone }),
    );
    const afterCreate = projectMilestonesReducer(afterSocket, createProjectMilestoneSuccess({ milestone }));

    expect(afterCreate.milestones).toHaveLength(1);
    expect(afterCreate.milestones[0]).toEqual(milestone);
  });

  it('removes milestone on socket removed', () => {
    const state = projectMilestonesReducer(
      { ...initialProjectMilestonesState, milestones: [milestone] },
      projectBoardMilestoneRemoved({ id: 'm-1', projectId: 'p-1' }),
    );

    expect(state.milestones).toEqual([]);
  });
});
