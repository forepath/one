import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearClientAgentAutonomy,
  clearClientAgentAutonomyError,
  loadClientAgentAutonomy,
  upsertClientAgentAutonomy,
} from './client-agent-autonomy.actions';
import {
  selectClientAgentAutonomy,
  selectClientAgentAutonomyContext,
  selectClientAgentAutonomyError,
  selectClientAgentAutonomyLoading,
  selectClientAgentAutonomySaving,
} from './client-agent-autonomy.selectors';
import type { ClientAgentAutonomyResponseDto, UpsertClientAgentAutonomyDto } from './client-agent-autonomy.types';

@Injectable({
  providedIn: 'root',
})
export class ClientAgentAutonomyFacade {
  private readonly store = inject(Store);

  readonly context$ = this.store.select(selectClientAgentAutonomyContext);
  readonly autonomy$: Observable<ClientAgentAutonomyResponseDto | null> = this.store.select(selectClientAgentAutonomy);
  readonly loading$: Observable<boolean> = this.store.select(selectClientAgentAutonomyLoading);
  readonly saving$: Observable<boolean> = this.store.select(selectClientAgentAutonomySaving);
  readonly error$: Observable<string | null> = this.store.select(selectClientAgentAutonomyError);

  load(clientId: string, agentId: string): void {
    this.store.dispatch(loadClientAgentAutonomy({ clientId, agentId }));
  }

  upsert(clientId: string, agentId: string, dto: UpsertClientAgentAutonomyDto): void {
    this.store.dispatch(upsertClientAgentAutonomy({ clientId, agentId, dto }));
  }

  clearError(): void {
    this.store.dispatch(clearClientAgentAutonomyError());
  }

  clear(): void {
    this.store.dispatch(clearClientAgentAutonomy());
  }
}
