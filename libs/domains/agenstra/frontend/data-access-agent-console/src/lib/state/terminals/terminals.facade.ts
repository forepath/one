import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { terminalsClear } from './terminals.actions';
import type { TerminalOutputChunk, TerminalSession } from './terminals.reducer';
import { selectTerminalOutputChunks, selectTerminalSessions } from './terminals.selectors';

/**
 * Facade for terminal session and output state.
 * Outbound create/input/resize/close stays on ContainerSocketFacade.
 */
@Injectable({
  providedIn: 'root',
})
export class TerminalsFacade {
  private readonly store = inject(Store);

  readonly sessions$: Observable<Record<string, TerminalSession>> = this.store.select(selectTerminalSessions);

  readonly outputChunks$: Observable<TerminalOutputChunk[]> = this.store.select(selectTerminalOutputChunks);

  /** Clears all terminal sessions and buffered output. */
  clear(): void {
    this.store.dispatch(terminalsClear());
  }
}
