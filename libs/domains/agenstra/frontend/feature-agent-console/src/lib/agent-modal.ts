import { DestroyRef, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, Observable, of, pairwise, withLatestFrom } from 'rxjs';

/** Matches `fpc-modal` close transition so overlay swaps do not stack backdrops. */
export const AGENT_MODAL_TRANSITION_MS = 150;

export function showAgentModal(open: WritableSignal<boolean>): void {
  open.set(true);
}

export function hideAgentModal(open: WritableSignal<boolean>): void {
  open.set(false);
}

export type AgentModalSwapState = {
  suspended: boolean;
};

/**
 * Hide an open underlying `fpc-modal`, show overlay, then restore underlying via
 * {@link restoreUnderlyingAgentModal} from the overlay `(closed)` handler.
 */
export function swapToOverlayAgentModal(options: {
  underlyingOpen?: WritableSignal<boolean>;
  overlayOpen: WritableSignal<boolean>;
  swapState: AgentModalSwapState;
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
  setTimeout(() => options.overlayOpen.set(true), AGENT_MODAL_TRANSITION_MS);
}

/** Call from an overlay `fpc-modal` `(closed)` when opened via {@link swapToOverlayAgentModal}. */
export function restoreUnderlyingAgentModal(options: {
  underlyingOpen: WritableSignal<boolean>;
  swapState: AgentModalSwapState;
}): void {
  if (!options.swapState.suspended) {
    return;
  }

  options.swapState.suspended = false;
  queueMicrotask(() => options.underlyingOpen.set(true));
}

export function watchAgentMutationModalClose(options: {
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
      hideAgentModal(options.open);
      options.onSuccess?.();
    });
}
