import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type { ChatPlanResponse } from '../container-socket/container-socket.types';

import {
  clearChatPlansError,
  clearSelectedChatPlan,
  loadChatPlan,
  loadChatPlanActivity,
  loadChatPlans,
  updateChatPlan,
} from './chat-plans.actions';
import {
  selectChatPlanActivity,
  selectChatPlanActivityLoadingPlanId,
  selectChatPlans,
  selectChatPlansConflict,
  selectChatPlansError,
  selectChatPlansLoading,
  selectChatPlansSaving,
  selectChatPlansTotal,
  selectSelectedChatPlan,
  selectSelectedChatPlanLoading,
} from './chat-plans.selectors';
import type { ChatPlanActivityDto, ChatPlansQuery, UpdateChatPlanDto } from './chat-plans.types';

@Injectable({
  providedIn: 'root',
})
export class ChatPlansFacade {
  private readonly store = inject(Store);

  readonly plans$: Observable<ChatPlanResponse[]> = this.store.select(selectChatPlans);
  readonly total$: Observable<number> = this.store.select(selectChatPlansTotal);
  readonly loading$: Observable<boolean> = this.store.select(selectChatPlansLoading);
  readonly selectedPlan$: Observable<ChatPlanResponse | null> = this.store.select(selectSelectedChatPlan);
  readonly selectedPlanLoading$: Observable<boolean> = this.store.select(selectSelectedChatPlanLoading);
  readonly saving$: Observable<boolean> = this.store.select(selectChatPlansSaving);
  readonly error$: Observable<string | null> = this.store.select(selectChatPlansError);
  readonly conflict$: Observable<boolean> = this.store.select(selectChatPlansConflict);
  readonly activityLoadingPlanId$: Observable<string | null> = this.store.select(selectChatPlanActivityLoadingPlanId);

  activity$(planId: string): Observable<ChatPlanActivityDto[]> {
    return this.store.select(selectChatPlanActivity(planId));
  }

  load(clientId: string, agentId: string, query: ChatPlansQuery): void {
    this.store.dispatch(loadChatPlans({ clientId, agentId, query }));
  }

  open(clientId: string, agentId: string, planId: string): void {
    this.store.dispatch(loadChatPlan({ clientId, agentId, planId }));
  }

  close(): void {
    this.store.dispatch(clearSelectedChatPlan());
  }

  update(clientId: string, agentId: string, planId: string, dto: UpdateChatPlanDto): void {
    this.store.dispatch(updateChatPlan({ clientId, agentId, planId, dto }));
  }

  loadActivity(clientId: string, agentId: string, planId: string): void {
    this.store.dispatch(loadChatPlanActivity({ clientId, agentId, planId }));
  }

  clearError(): void {
    this.store.dispatch(clearChatPlansError());
  }
}
