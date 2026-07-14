import { DestroyRef, ElementRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, Observable, of, pairwise, withLatestFrom } from 'rxjs';

type BootstrapModal = { show: () => void; hide: () => void };

function getBootstrapModal(el: HTMLElement): BootstrapModal | null {
  return (
    (
      globalThis as { bootstrap?: { Modal?: { getOrCreateInstance: (el: HTMLElement) => BootstrapModal } } }
    ).bootstrap?.Modal?.getOrCreateInstance(el) ?? null
  );
}

export function showNotificationModal(modalElement: ElementRef<HTMLDivElement>): void {
  getBootstrapModal(modalElement.nativeElement)?.show();
}

export function hideNotificationModal(modalElement: ElementRef<HTMLDivElement>): void {
  getBootstrapModal(modalElement.nativeElement)?.hide();
}

export function watchNotificationMutationModalClose(options: {
  loading$: Observable<boolean>;
  error$?: Observable<string | null | undefined>;
  modal: () => ElementRef<HTMLDivElement>;
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
      hideNotificationModal(options.modal());
      options.onSuccess?.();
    });
}
