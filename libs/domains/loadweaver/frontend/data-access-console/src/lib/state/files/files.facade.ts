import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { LiveFileOperation, LiveFileTarget } from '../../types/live.types';
import {
  dismissFilesMessages,
  openFilesDirectory,
  refreshFiles,
  runFileOperation,
  setFilesWarning,
} from './files.actions';
import {
  selectFilesBusy,
  selectFilesEntries,
  selectFilesError,
  selectFilesLoading,
  selectFilesOperationError,
  selectFilesPath,
  selectFilesTarget,
  selectFilesWarning,
} from './files.selectors';

@Injectable()
export class ConsoleFilesFacade {
  private readonly store = inject(Store);

  readonly target$ = this.store.select(selectFilesTarget);
  readonly path$ = this.store.select(selectFilesPath);
  readonly entries$ = this.store.select(selectFilesEntries);
  readonly loading$ = this.store.select(selectFilesLoading);
  readonly error$ = this.store.select(selectFilesError);
  readonly busy$ = this.store.select(selectFilesBusy);
  readonly operationError$ = this.store.select(selectFilesOperationError);
  readonly warning$ = this.store.select(selectFilesWarning);

  open(target: LiveFileTarget, path: string): void {
    this.store.dispatch(openFilesDirectory({ target, path }));
  }

  refresh(): void {
    this.store.dispatch(refreshFiles());
  }

  run(target: LiveFileTarget, operation: LiveFileOperation): void {
    this.store.dispatch(runFileOperation({ target, operation }));
  }

  setWarning(warning: string | null): void {
    this.store.dispatch(setFilesWarning({ warning }));
  }

  dismissMessages(): void {
    this.store.dispatch(dismissFilesMessages());
  }
}
