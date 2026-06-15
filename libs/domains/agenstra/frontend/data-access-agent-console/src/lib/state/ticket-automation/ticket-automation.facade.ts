import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  approveTicketAutomation,
  cancelTicketAutomationRun,
  clearTicketAutomation,
  clearTicketAutomationError,
  loadTicketAutomation,
  loadTicketAutomationRunDetail,
  loadTicketAutomationRuns,
  patchTicketAutomation,
  unapproveTicketAutomation,
} from './ticket-automation.actions';
import {
  selectTicketAutomationActiveTicketId,
  selectTicketAutomationConfig,
  selectTicketAutomationError,
  selectTicketAutomationLoadingConfig,
  selectTicketAutomationLoadingRunDetail,
  selectTicketAutomationLoadingRuns,
  selectTicketAutomationRunCacheByRunId,
  selectTicketAutomationRunDetail,
  selectTicketAutomationRuns,
  selectTicketAutomationSaving,
} from './ticket-automation.selectors';
import type {
  TicketAutomationResponseDto,
  TicketAutomationRunResponseDto,
  UpdateTicketAutomationDto,
} from './ticket-automation.types';

@Injectable({
  providedIn: 'root',
})
export class TicketAutomationFacade {
  private readonly store = inject(Store);

  readonly activeTicketId$: Observable<string | null> = this.store.select(selectTicketAutomationActiveTicketId);
  readonly config$: Observable<TicketAutomationResponseDto | null> = this.store.select(selectTicketAutomationConfig);
  readonly runs$: Observable<TicketAutomationRunResponseDto[]> = this.store.select(selectTicketAutomationRuns);
  readonly runCacheByRunId$: Observable<Record<string, TicketAutomationRunResponseDto>> = this.store.select(
    selectTicketAutomationRunCacheByRunId,
  );
  readonly runDetail$: Observable<TicketAutomationRunResponseDto | null> = this.store.select(
    selectTicketAutomationRunDetail,
  );
  readonly loadingConfig$: Observable<boolean> = this.store.select(selectTicketAutomationLoadingConfig);
  readonly loadingRuns$: Observable<boolean> = this.store.select(selectTicketAutomationLoadingRuns);
  readonly loadingRunDetail$: Observable<boolean> = this.store.select(selectTicketAutomationLoadingRunDetail);
  readonly saving$: Observable<boolean> = this.store.select(selectTicketAutomationSaving);
  readonly error$: Observable<string | null> = this.store.select(selectTicketAutomationError);

  loadConfig(ticketId: string): void {
    this.store.dispatch(loadTicketAutomation({ ticketId }));
  }

  patchConfig(ticketId: string, dto: UpdateTicketAutomationDto): void {
    this.store.dispatch(patchTicketAutomation({ ticketId, dto }));
  }

  approve(ticketId: string): void {
    this.store.dispatch(approveTicketAutomation({ ticketId }));
  }

  unapprove(ticketId: string): void {
    this.store.dispatch(unapproveTicketAutomation({ ticketId }));
  }

  loadRuns(ticketId: string): void {
    this.store.dispatch(loadTicketAutomationRuns({ ticketId }));
  }

  loadRunDetail(ticketId: string, runId: string): void {
    this.store.dispatch(loadTicketAutomationRunDetail({ ticketId, runId }));
  }

  cancelRun(ticketId: string, runId: string): void {
    this.store.dispatch(cancelTicketAutomationRun({ ticketId, runId }));
  }

  clearError(): void {
    this.store.dispatch(clearTicketAutomationError());
  }

  clear(): void {
    this.store.dispatch(clearTicketAutomation());
  }
}
