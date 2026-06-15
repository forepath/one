import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  addTicketComment,
  clearTicketsError,
  closeTicketDetail,
  createTicket,
  deleteTicket,
  loadTickets,
  migrateTicket as migrateTicketAction,
  openTicketDetail,
  prependTicketDetailActivity,
  updateTicket,
} from './tickets.actions';
import {
  selectDetailBreadcrumb,
  selectTicketsActivity,
  selectTicketsBoardRowsByStatus,
  selectTicketsComments,
  selectTicketsDetail,
  selectTicketsError,
  selectTicketsList,
  selectTicketsLoadingDetail,
  selectTicketsLoadingList,
  selectTicketsSaving,
  selectTicketsSelectedId,
} from './tickets.selectors';
import type {
  CreateTicketDto,
  ListTicketsParams,
  TicketActivityResponseDto,
  TicketCommentResponseDto,
  TicketResponseDto,
  UpdateTicketDto,
} from './tickets.types';

@Injectable({
  providedIn: 'root',
})
export class TicketsFacade {
  private readonly store = inject(Store);

  readonly tickets$: Observable<TicketResponseDto[]> = this.store.select(selectTicketsList);
  readonly ticketsBoardRowsByStatus$ = this.store.select(selectTicketsBoardRowsByStatus);
  readonly detailBreadcrumb$ = this.store.select(selectDetailBreadcrumb);
  readonly loadingList$: Observable<boolean> = this.store.select(selectTicketsLoadingList);
  readonly selectedTicketId$: Observable<string | null> = this.store.select(selectTicketsSelectedId);
  readonly detail$: Observable<TicketResponseDto | null> = this.store.select(selectTicketsDetail);
  readonly comments$: Observable<TicketCommentResponseDto[]> = this.store.select(selectTicketsComments);
  readonly activity$: Observable<TicketActivityResponseDto[]> = this.store.select(selectTicketsActivity);
  readonly loadingDetail$: Observable<boolean> = this.store.select(selectTicketsLoadingDetail);
  readonly saving$: Observable<boolean> = this.store.select(selectTicketsSaving);
  readonly error$: Observable<string | null> = this.store.select(selectTicketsError);

  loadTickets(params?: ListTicketsParams): void {
    this.store.dispatch(loadTickets({ params }));
  }

  openDetail(id: string): void {
    this.store.dispatch(openTicketDetail({ id }));
  }

  closeDetail(): void {
    this.store.dispatch(closeTicketDetail());
  }

  create(dto: CreateTicketDto): void {
    this.store.dispatch(createTicket({ dto }));
  }

  update(id: string, dto: UpdateTicketDto): void {
    this.store.dispatch(updateTicket({ id, dto }));
  }

  migrateTicket(id: string, targetClientId: string): void {
    this.store.dispatch(migrateTicketAction({ id, targetClientId }));
  }

  remove(id: string, releaseExternalSyncMarker?: boolean): void {
    this.store.dispatch(deleteTicket({ id, releaseExternalSyncMarker }));
  }

  addComment(ticketId: string, body: string): void {
    this.store.dispatch(addTicketComment({ ticketId, body }));
  }

  clearError(): void {
    this.store.dispatch(clearTicketsError());
  }

  prependDetailActivity(activity: TicketActivityResponseDto): void {
    this.store.dispatch(prependTicketDetailActivity({ activity }));
  }
}
