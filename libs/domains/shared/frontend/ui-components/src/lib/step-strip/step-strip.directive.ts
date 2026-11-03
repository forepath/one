import { afterNextRender, DestroyRef, Directive, ElementRef, inject, signal } from '@angular/core';

import { fpcScrollEdges, fpcScrollPageTarget, fpcScrollToLeft } from '../scroll-overflow/scroll-overflow';

/** Space kept around the current step when it is pulled into view, so its neighbours peek in. */
const PEEK_PX = 48;

/**
 * A step list on one row (wizards, the resource modal, `fpc-stepper`): instead of wrapping into a second row it
 * scrolls sideways without a scrollbar (`.fpc-step-strip`, ui-components styles), and the current step
 * (`[aria-current="step"]`) is pulled into view whenever it changes or the strip is resized. Only the strip's own
 * `scrollLeft` moves, so a surrounding modal or page never jumps. `overflowing` / `atStart` / `atEnd` and `page()`
 * drive the chevrons of the `fpc-step-strip` wrapper.
 *
 * Put it on the list element whose children are the steps: `<ol class="…" fpcStepStrip>`.
 */
@Directive({
  selector: '[fpcStepStrip]',
  standalone: true,
  host: { class: 'fpc-step-strip', '(scroll)': 'measure()' },
})
export class FpcStepStripDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The steps don't fit: the strip scrolls (and the wrapper shows its chevrons). */
  readonly overflowing = signal(false);
  readonly atStart = signal(true);
  readonly atEnd = signal(true);

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.reveal(false);
      this.measure();

      const mutations = new MutationObserver(() => {
        this.reveal(true);
        this.measure();
      });

      mutations.observe(this.host, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-current'],
      });

      const resize =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              this.reveal(false);
              this.measure();
            });

      resize?.observe(this.host);
      destroyRef.onDestroy(() => {
        mutations.disconnect();
        resize?.disconnect();
      });
    });
  }

  /** Updates `overflowing` / `atStart` / `atEnd` from the strip's scroll position. */
  measure(): void {
    const edges = fpcScrollEdges(this.host);

    this.overflowing.set(edges.overflowing);
    this.atStart.set(edges.atStart);
    this.atEnd.set(edges.atEnd);
  }

  /** Scrolls about three quarters of the visible width towards `direction` (the chevrons). */
  page(direction: -1 | 1): void {
    this.scrollTo(fpcScrollPageTarget(this.host, direction), true);
  }

  /** Scrolls the current step into view (centred) when it isn't fully visible with some room around it. */
  reveal(smooth: boolean): void {
    const host = this.host;
    const current = host.querySelector<HTMLElement>('[aria-current="step"]');

    if (!current || host.scrollWidth <= host.clientWidth) return;

    // The step's list item (direct child), so its whole width counts.
    let item: HTMLElement = current;

    while (item.parentElement && item.parentElement !== host) item = item.parentElement;

    const hostBox = host.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    const peek = Math.min(PEEK_PX, Math.max(0, (host.clientWidth - box.width) / 2));

    if (box.left >= hostBox.left + peek && box.right <= hostBox.right - peek) return;

    const start = box.left - hostBox.left + host.scrollLeft;
    const left = Math.max(0, Math.min(host.scrollWidth - host.clientWidth, start - (host.clientWidth - box.width) / 2));

    this.scrollTo(left, smooth);
  }

  private scrollTo(left: number, smooth: boolean): void {
    fpcScrollToLeft(this.host, left, smooth);
    // Smooth scrolling reports through `scroll` events; an instant one is measured right away.
    this.measure();
  }
}
