import { DestroyRef, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, Observable, of, pairwise, withLatestFrom } from 'rxjs';

export function showNotificationModal(open: WritableSignal<boolean>): void {
  open.set(true);
}

export function hideNotificationModal(open: WritableSignal<boolean>): void {
  open.set(false);
}

export function watchNotificationMutationModalClose(options: {
  loading$: Observable<boolean>;
  error$?: Observable<string | null | undefined>;
  open: WritableSignal<boolean>;
  destroyRef: DestroyRef;
  onSuccess?: () => void;
}): void {
  const error$ = options.error$ ?? of(null);

  options.loading$
    .pipe(
      pairwise(),
      filter(([wasLoading, loading]) => wasLoading && !loading),
      withLatestFrom(error$),
      filter(([, error]) => !error),
      takeUntilDestroyed(options.destroyRef),
    )
    .subscribe(() => {
      hideNotificationModal(options.open);
      options.onSuccess?.();
    });
}
