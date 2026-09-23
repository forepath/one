import { DestroyRef, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, Observable, of, pairwise, withLatestFrom } from 'rxjs';

/** Matches `fpc-modal` close transition so overlay swaps do not stack backdrops. */
export const BILLING_MODAL_TRANSITION_MS = 150;

export function showBillingModal(open: WritableSignal<boolean>): void {
  open.set(true);
}

export function hideBillingModal(open: WritableSignal<boolean>): void {
  open.set(false);
}

export type BillingModalSwapState = {
  suspended: boolean;
};

/**
 * Hide an open underlying `fpc-modal`, show overlay, then restore underlying via
 * {@link restoreUnderlyingBillingModal} from the overlay `(closed)` handler.
 */
export function swapToOverlayBillingModal(options: {
  underlyingOpen?: WritableSignal<boolean>;
  overlayOpen: WritableSignal<boolean>;
  swapState: BillingModalSwapState;
}): void {
  if (options.overlayOpen() || options.swapState.suspended) {
    return;
  }

  if (!options.underlyingOpen?.()) {
    queueMicrotask(() => options.overlayOpen.set(true));

    return;
  }

  options.swapState.suspended = true;
  options.underlyingOpen.set(false);
  setTimeout(() => options.overlayOpen.set(true), BILLING_MODAL_TRANSITION_MS);
}

/** Call from an overlay `fpc-modal` `(closed)` when opened via {@link swapToOverlayBillingModal}. */
export function restoreUnderlyingBillingModal(options: {
  underlyingOpen: WritableSignal<boolean>;
  swapState: BillingModalSwapState;
}): void {
  if (!options.swapState.suspended) {
    return;
  }

  options.swapState.suspended = false;
  queueMicrotask(() => options.underlyingOpen.set(true));
}

export function watchBillingMutationModalClose(options: {
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
      hideBillingModal(options.open);
      options.onSuccess?.();
    });
}
