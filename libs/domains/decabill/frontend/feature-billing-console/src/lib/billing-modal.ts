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

export function showBillingModal(modalElement: ElementRef<HTMLDivElement>): void {
  getBootstrapModal(modalElement.nativeElement)?.show();
}

export function hideBillingModal(modalElement: ElementRef<HTMLDivElement>): void {
  getBootstrapModal(modalElement.nativeElement)?.hide();
}

export type BillingModalSwapState = {
  suspended: boolean;
};

/** Hide an open underlying modal, show overlay, then restore underlying when overlay closes. */
export function swapToOverlayBillingModal(options: {
  underlyingModal?: ElementRef<HTMLDivElement>;
  overlayModal: ElementRef<HTMLDivElement>;
  swapState: BillingModalSwapState;
}): void {
  const overlayEl = options.overlayModal.nativeElement;

  if (overlayEl.classList.contains('show')) {
    return;
  }

  if (options.swapState.suspended) {
    return;
  }

  const underlyingEl = options.underlyingModal?.nativeElement;

  if (!underlyingEl?.classList.contains('show')) {
    queueMicrotask(() => showBillingModal(options.overlayModal));

    return;
  }

  options.swapState.suspended = true;

  const onUnderlyingHidden = (): void => {
    queueMicrotask(() => {
      if (!options.overlayModal?.nativeElement) {
        options.swapState.suspended = false;

        if (options.underlyingModal) {
          showBillingModal(options.underlyingModal);
        }

        return;
      }

      showBillingModal(options.overlayModal);
      registerRestoreUnderlyingBillingModal({
        underlyingModal: options.underlyingModal!,
        overlayModal: options.overlayModal,
        swapState: options.swapState,
      });
    });
  };

  underlyingEl.addEventListener('hidden.bs.modal', onUnderlyingHidden, { once: true });
  hideBillingModal(options.underlyingModal!);
}

function registerRestoreUnderlyingBillingModal(options: {
  underlyingModal: ElementRef<HTMLDivElement>;
  overlayModal: ElementRef<HTMLDivElement>;
  swapState: BillingModalSwapState;
}): void {
  const el = options.overlayModal.nativeElement;

  if (!el) {
    return;
  }

  const onOverlayHidden = (): void => {
    if (!options.swapState.suspended) {
      return;
    }

    options.swapState.suspended = false;
    queueMicrotask(() => showBillingModal(options.underlyingModal));
  };

  el.addEventListener('hidden.bs.modal', onOverlayHidden, { once: true });
}

export function watchBillingMutationModalClose(options: {
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
      hideBillingModal(options.modal());
      options.onSuccess?.();
    });
}
