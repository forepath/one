import { signal, WritableSignal } from '@angular/core';

/** Matches the `fpc-modal` fade (Bootstrap's 150 ms), so a swap never shows two backdrops at once. */
export const FPC_MODAL_TRANSITION_MS = 150;

/** View state of the underlying modal that a swap keeps (focused control and scroll offsets). */
interface FpcModalSwapSnapshot {
  focus: HTMLElement | null;
  /** Modal chrome (`.modal`, `.modal-body`) is re-rendered on reopen, so it is found again by selector. */
  chrome: { selector: string; top: number }[];
  /** Projected content survives the close (it belongs to the consumer's view), so its elements are kept. */
  content: { element: Element; top: number }[];
}

const CHROME_SCROLLERS = ['.modal', '.modal-body'];

/**
 * Modal "flapping" (the Agenstra overlay swap, shared): an open `fpc-modal` hides, a second one (typically an
 * `fpc-confirm-dialog`, e.g. "Discard changes?") takes its place after the fade, and on "keep editing" the first one
 * comes back. Only one modal (and backdrop) is visible at a time.
 *
 * The underlying modal is only hidden, never torn down: bind `[open]="open() && !swap.suspended()"` and keep the
 * projected content mounted (don't gate it on the hidden state), so its form / editor state stays. Pass the modal host
 * (`viewChild(FpcModalComponent, { read: ElementRef })`) to also bring back the focused control and the scroll
 * offsets.
 *
 * ```ts
 * readonly discardOpen = signal(false);
 * readonly swap = new FpcModalSwap(this.discardOpen);
 * requestClose() { dirty ? this.swap.toOverlay(host) : close(); }   // fpc-modal (closeRequest) with guardClose
 * keepEditing() { this.swap.back(); }                               // confirm (cancelled): X / Esc / backdrop too
 * discard() { this.swap.finish(); close(); }                        // confirm (confirmed)
 * ```
 */
export class FpcModalSwap {
  /** The underlying modal is hidden for the overlay. */
  readonly suspended = signal(false);

  private snapshot: FpcModalSwapSnapshot | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stopRestore: (() => void) | null = null;

  constructor(private readonly overlayOpen: WritableSignal<boolean>) {}

  /** Hide the underlying modal, then show the overlay once the fade has run. */
  toOverlay(root?: HTMLElement | null): void {
    if (this.overlayOpen() || this.suspended()) return;

    this.stopRestore?.();
    this.snapshot = root ? capture(root) : null;
    this.suspended.set(true);
    this.later(() => this.overlayOpen.set(true), FPC_MODAL_TRANSITION_MS);
  }

  /**
   * Bring the underlying modal back (the overlay closes itself, e.g. `fpc-confirm-dialog` on Cancel / X / Escape /
   * backdrop). Runs after the current event, so the same Escape press cannot reach the reopened modal.
   */
  back(root?: HTMLElement | null): void {
    if (!this.suspended()) return;

    const snapshot = this.snapshot;

    this.snapshot = null;
    this.overlayOpen.set(false);
    this.later(() => {
      this.suspended.set(false);

      if (!snapshot || !root) return;

      this.restoreWhenShown(root, snapshot);
    }, 0);
  }

  /** The overlay confirmed (e.g. "Discard"): close it, the underlying modal stays hidden until the next open. */
  finish(): void {
    this.reset();
    this.overlayOpen.set(false);
  }

  /** Forget a pending swap (e.g. when the underlying modal opens for something else). */
  reset(): void {
    for (const timer of this.timers) clearTimeout(timer);

    this.timers = [];
    this.stopRestore?.();
    this.snapshot = null;
    this.suspended.set(false);
  }

  /**
   * Once the reopened dialog has taken its own initial focus (`fpc-modal` focuses `.modal` when it shows), put the
   * scroll offsets and the focused control back. Event-driven (no polling), cleared by the next swap / reset.
   */
  private restoreWhenShown(root: HTMLElement, snapshot: FpcModalSwapSnapshot): void {
    this.stopRestore?.();

    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;

      if (!(target instanceof Element) || !target.matches('.modal')) return;

      this.stopRestore?.();
      restoreScroll(root, snapshot);
      if (snapshot.focus?.isConnected) snapshot.focus.focus({ preventScroll: true });
    };

    root.addEventListener('focusin', onFocusIn);
    this.stopRestore = () => {
      root.removeEventListener('focusin', onFocusIn);
      this.stopRestore = null;
    };
  }

  private later(run: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== timer);
      run();
    }, ms);

    this.timers.push(timer);
  }
}

function capture(root: HTMLElement): FpcModalSwapSnapshot {
  const active = root.ownerDocument.activeElement;
  const chrome = CHROME_SCROLLERS.map((selector) => ({ selector, top: root.querySelector(selector)?.scrollTop ?? 0 }));
  const body = root.querySelector('.modal-body');
  const content = body
    ? Array.from(body.querySelectorAll('*'))
        .filter((element) => element.scrollTop > 0)
        .map((element) => ({ element, top: element.scrollTop }))
    : [];

  return {
    focus: active instanceof HTMLElement && root.contains(active) ? active : null,
    chrome: chrome.filter((entry) => entry.top > 0),
    content,
  };
}

function restoreScroll(root: HTMLElement, snapshot: FpcModalSwapSnapshot): void {
  for (const { selector, top } of snapshot.chrome) {
    const element = root.querySelector(selector);

    if (element) element.scrollTop = top;
  }

  for (const { element, top } of snapshot.content) {
    if (element.isConnected) element.scrollTop = top;
  }
}
