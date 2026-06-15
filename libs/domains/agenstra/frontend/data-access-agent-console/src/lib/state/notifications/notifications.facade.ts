import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type { AttentionBadgeKind } from './notifications-attention.util';
import {
  connectNotificationsSocket,
  disconnectNotificationsSocket,
  markEnvironmentRead,
  setActiveEnvironment,
} from './notifications.actions';
import {
  selectClientAttentionBadge,
  selectClientGitDirty,
  selectClientHasUnread,
  selectEnvironmentAttentionBadge,
  selectEnvironmentGitDirty,
  selectEnvironmentHasUnread,
  selectEnvironmentStatus,
  selectSpacesAttentionBadge,
  selectSpacesHasAttention,
} from './notifications.selectors';

@Injectable({ providedIn: 'root' })
export class NotificationsFacade {
  private readonly store = inject(Store);

  readonly spacesHasAttention$ = this.store.select(selectSpacesHasAttention);
  readonly spacesAttentionBadge$ = this.store.select(selectSpacesAttentionBadge);

  connectSocket(): void {
    this.store.dispatch(connectNotificationsSocket());
  }

  disconnectSocket(): void {
    this.store.dispatch(disconnectNotificationsSocket());
  }

  markEnvironmentRead(clientId: string, agentId: string): void {
    this.store.dispatch(markEnvironmentRead({ clientId, agentId }));
  }

  setActiveEnvironment(clientId: string | null, agentId: string | null): void {
    this.store.dispatch(setActiveEnvironment({ clientId, agentId }));
  }

  getClientHasUnread$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientHasUnread(clientId));
  }

  getClientGitDirty$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientGitDirty(clientId));
  }

  getEnvironmentHasUnread$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectEnvironmentHasUnread(clientId, agentId));
  }

  getEnvironmentGitDirty$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectEnvironmentGitDirty(clientId, agentId));
  }

  getEnvironmentStatus$(clientId: string, agentId: string) {
    return this.store.select(selectEnvironmentStatus(clientId, agentId));
  }

  getClientAttentionBadge$(clientId: string): Observable<AttentionBadgeKind | null> {
    return this.store.select(selectClientAttentionBadge(clientId));
  }

  getEnvironmentAttentionBadge$(clientId: string, agentId: string): Observable<AttentionBadgeKind | null> {
    return this.store.select(selectEnvironmentAttentionBadge(clientId, agentId));
  }
}
