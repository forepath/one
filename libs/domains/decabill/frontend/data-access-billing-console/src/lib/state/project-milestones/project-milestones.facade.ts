import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateProjectMilestoneDto, UpdateProjectMilestoneDto } from '../../types/projects.types';

import {
  createProjectMilestone,
  deleteProjectMilestone,
  loadProjectMilestones,
  lockProjectMilestone,
  updateProjectMilestone,
} from './project-milestones.actions';
import {
  selectProjectMilestones,
  selectProjectMilestonesError,
  selectProjectMilestonesLoading,
  selectProjectMilestonesSaving,
} from './project-milestones.selectors';

@Injectable()
export class ProjectMilestonesFacade {
  private readonly store = inject(Store);

  readonly milestones$ = this.store.select(selectProjectMilestones);
  readonly loading$ = this.store.select(selectProjectMilestonesLoading);
  readonly saving$ = this.store.select(selectProjectMilestonesSaving);
  readonly error$ = this.store.select(selectProjectMilestonesError);

  load(projectId: string): void {
    this.store.dispatch(loadProjectMilestones({ projectId }));
  }

  create(projectId: string, dto: CreateProjectMilestoneDto): void {
    this.store.dispatch(createProjectMilestone({ projectId, dto }));
  }

  update(projectId: string, id: string, dto: UpdateProjectMilestoneDto): void {
    this.store.dispatch(updateProjectMilestone({ projectId, id, dto }));
  }

  lock(projectId: string, id: string): void {
    this.store.dispatch(lockProjectMilestone({ projectId, id }));
  }

  remove(projectId: string, id: string): void {
    this.store.dispatch(deleteProjectMilestone({ projectId, id }));
  }
}
