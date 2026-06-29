import {
  loadProjectMilestones,
  loadProjectMilestonesSuccess,
  createProjectMilestoneSuccess,
  projectBoardMilestoneUpsert,
} from './project-milestones.actions';
import { initialProjectMilestonesState, projectMilestonesReducer } from './project-milestones.reducer';

describe('projectMilestonesReducer', () => {
  const milestone = {
    id: 'm-1',
    projectId: 'p-1',
    name: 'M1',
    sortOrder: 0,
    progressPercent: 0,
    openTicketCount: 0,
    doneTicketCount: 0,
    createdAt: '',
    updatedAt: '',
  };

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

  it('adds milestone on create', () => {
    const state = projectMilestonesReducer(initialProjectMilestonesState, createProjectMilestoneSuccess({ milestone }));

    expect(state.milestones).toEqual([milestone]);
    expect(state.saving).toBe(false);
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
});
