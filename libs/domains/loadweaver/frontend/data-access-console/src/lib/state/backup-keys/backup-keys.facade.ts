import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { KitSize } from '../../types/backups.types';
import {
  clearBackupKeyActionError,
  clearKitShare,
  confirmBackupKit,
  downloadKitShare,
  escrowBackupKey,
  loadBackupKeys,
  reissueBackupKit,
  rotateBackupKey,
} from './backup-keys.actions';
import {
  selectActiveBackupKey,
  selectBackupKeyActing,
  selectBackupKeyActionError,
  selectBackupKeyGenerations,
  selectBackupKeyLastSuccess,
  selectBackupKeysError,
  selectBackupKeysLoaded,
  selectBackupKeysLoading,
  selectKitShare,
} from './backup-keys.selectors';

/** The backup key and its recovery kit (3.20, cluster admins). */
@Injectable()
export class ConsoleBackupKeysFacade {
  private readonly store = inject(Store);

  readonly generations$ = this.store.select(selectBackupKeyGenerations);
  readonly active$ = this.store.select(selectActiveBackupKey);
  readonly loaded$ = this.store.select(selectBackupKeysLoaded);
  readonly loading$ = this.store.select(selectBackupKeysLoading);
  readonly error$ = this.store.select(selectBackupKeysError);
  readonly acting$ = this.store.select(selectBackupKeyActing);
  readonly actionError$ = this.store.select(selectBackupKeyActionError);
  readonly lastSuccess$ = this.store.select(selectBackupKeyLastSuccess);
  readonly share$ = this.store.select(selectKitShare);

  load(silent = false): void {
    this.store.dispatch(loadBackupKeys({ silent }));
  }

  rotate(kit?: KitSize): void {
    this.store.dispatch(rotateBackupKey(kit ? { kit } : {}));
  }

  reissue(generation: number, kit: KitSize): void {
    this.store.dispatch(reissueBackupKit({ generation, kit }));
  }

  downloadShare(generation: number, index: number): void {
    this.store.dispatch(downloadKitShare({ generation, index }));
  }

  confirm(generation: number, shares: string[]): void {
    this.store.dispatch(confirmBackupKit({ generation, shares }));
  }

  escrow(generation: number): void {
    this.store.dispatch(escrowBackupKey({ generation }));
  }

  clearShare(): void {
    this.store.dispatch(clearKitShare());
  }

  clearActionError(): void {
    this.store.dispatch(clearBackupKeyActionError());
  }
}
