import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { loadLiveTargets, loadTerminalSessions, loadTunnels } from './live.actions';
import {
  selectLiveNodes,
  selectLiveProjects,
  selectLiveReplicas,
  selectLiveTargetsError,
  selectLiveTargetsLoading,
  selectLiveVolumes,
  selectTerminalSessions,
  selectTerminalSessionsError,
  selectTerminalSessionsLoading,
  selectTerminalSessionsProject,
  selectTunnels,
  selectTunnelsError,
  selectTunnelsLoading,
} from './live.selectors';

@Injectable()
export class ConsoleLiveFacade {
  private readonly store = inject(Store);

  readonly replicas$ = this.store.select(selectLiveReplicas);
  readonly volumes$ = this.store.select(selectLiveVolumes);
  readonly nodes$ = this.store.select(selectLiveNodes);
  readonly projects$ = this.store.select(selectLiveProjects);
  readonly targetsLoading$ = this.store.select(selectLiveTargetsLoading);
  readonly targetsError$ = this.store.select(selectLiveTargetsError);
  readonly sessions$ = this.store.select(selectTerminalSessions);
  readonly sessionsProject$ = this.store.select(selectTerminalSessionsProject);
  readonly sessionsLoading$ = this.store.select(selectTerminalSessionsLoading);
  readonly sessionsError$ = this.store.select(selectTerminalSessionsError);
  readonly tunnels$ = this.store.select(selectTunnels);
  readonly tunnelsLoading$ = this.store.select(selectTunnelsLoading);
  readonly tunnelsError$ = this.store.select(selectTunnelsError);

  loadTargets(): void {
    this.store.dispatch(loadLiveTargets());
  }

  loadSessions(project: string | null = null): void {
    this.store.dispatch(loadTerminalSessions({ project }));
  }

  loadTunnels(): void {
    this.store.dispatch(loadTunnels());
  }
}
