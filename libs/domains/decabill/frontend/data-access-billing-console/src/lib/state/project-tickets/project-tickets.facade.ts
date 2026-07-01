import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type {
  CreateProjectTicketDto,
  ListProjectTicketsParams,
  UpdateProjectTicketDto,
} from '../../types/projects.types';

import {
  addProjectTicketComment,
  clearProjectTicketsError,
  closeProjectTicketDetail,
  createProjectTicket,
  deleteProjectTicket,
  loadProjectTickets,
  openProjectTicketDetail,
  updateProjectTicket,
} from './project-tickets.actions';
import {
  selectProjectTicketDetailBreadcrumb,
  selectProjectTicketsActivity,
  selectProjectTicketsBoardRowsByStatus,
  selectProjectTicketsComments,
  selectProjectTicketsDetail,
  selectProjectTicketsError,
  selectProjectTicketsList,
  selectProjectTicketsLoadingDetail,
  selectProjectTicketsLoadingList,
  selectProjectTicketsSaving,
  selectProjectTicketsSelectedId,
} from './project-tickets.selectors';

@Injectable()
export class ProjectTicketsFacade {
  private readonly store = inject(Store);

  readonly tickets$ = this.store.select(selectProjectTicketsList);
  readonly boardRowsByStatus$ = this.store.select(selectProjectTicketsBoardRowsByStatus);
  readonly detailBreadcrumb$ = this.store.select(selectProjectTicketDetailBreadcrumb);
  readonly loadingList$ = this.store.select(selectProjectTicketsLoadingList);
  readonly selectedTicketId$ = this.store.select(selectProjectTicketsSelectedId);
  readonly detail$ = this.store.select(selectProjectTicketsDetail);
  readonly comments$ = this.store.select(selectProjectTicketsComments);
  readonly activity$ = this.store.select(selectProjectTicketsActivity);
  readonly loadingDetail$ = this.store.select(selectProjectTicketsLoadingDetail);
  readonly saving$ = this.store.select(selectProjectTicketsSaving);
  readonly error$ = this.store.select(selectProjectTicketsError);

  loadTickets(params: ListProjectTicketsParams): void {
    this.store.dispatch(loadProjectTickets({ params }));
  }

  openDetail(id: string): void {
    this.store.dispatch(openProjectTicketDetail({ id }));
  }

  closeDetail(): void {
    this.store.dispatch(closeProjectTicketDetail());
  }

  create(projectId: string, dto: CreateProjectTicketDto): void {
    this.store.dispatch(createProjectTicket({ projectId, dto }));
  }

  update(projectId: string, id: string, dto: UpdateProjectTicketDto): void {
    this.store.dispatch(updateProjectTicket({ projectId, id, dto }));
  }

  remove(projectId: string, id: string): void {
    this.store.dispatch(deleteProjectTicket({ projectId, id }));
  }

  addComment(projectId: string, ticketId: string, body: string): void {
    this.store.dispatch(addProjectTicketComment({ projectId, ticketId, body }));
  }

  clearError(): void {
    this.store.dispatch(clearProjectTicketsError());
  }
}
