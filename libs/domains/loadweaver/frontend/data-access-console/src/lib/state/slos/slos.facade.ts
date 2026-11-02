import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { loadSlos } from './slos.actions';
import { selectSloCounts, selectSlos, selectSlosError, selectSlosLoading, selectSlosProject } from './slos.selectors';

@Injectable()
export class ConsoleSlosFacade {
  private readonly store = inject(Store);

  readonly slos$ = this.store.select(selectSlos);
  readonly project$ = this.store.select(selectSlosProject);
  readonly loading$ = this.store.select(selectSlosLoading);
  readonly error$ = this.store.select(selectSlosError);
  readonly counts$ = this.store.select(selectSloCounts);

  /** `silent`: refresh without the loading state. */
  load(project: string | null = null, silent = false): void {
    this.store.dispatch(loadSlos({ project, silent }));
  }
}
