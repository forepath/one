import { AfterViewInit, Directive, effect, ElementRef, inject, input, NgZone, OnDestroy, output } from '@angular/core';

/**
 * Observes a bottom sentinel. Put the directive on a 1px sentinel as the last child of a
 * scrollable container, and pass that container via `root`. Emits `reachedEnd` when the
 * sentinel intersects the scroll root (including when `paused`/`disabled` clear while still
 * visible). Migrated from `shared/frontend/ui-lists`.
 */
@Directive({
  selector: '[fpcInfiniteScroll]',
  standalone: true,
})
export class FpcInfiniteScrollDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);

  /** Scrollable ancestor used as IntersectionObserver root. Required for nested scroll areas. */
  readonly root = input.required<Element>();

  readonly rootMargin = input('0px 0px 200px 0px');
  readonly threshold = input(0);
  readonly paused = input(false);
  readonly disabled = input(false);

  readonly reachedEnd = output<void>();

  private observer: IntersectionObserver | null = null;
  private intersecting = false;
  private emittedForCurrentIntersection = false;

  constructor() {
    // Re-arm when the caller stops pausing while the sentinel is still on screen.
    effect(() => {
      if (!this.paused() && !this.disabled()) {
        this.emittedForCurrentIntersection = false;
      }

      this.maybeEmit();
    });
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          const wasIntersecting = this.intersecting;

          this.intersecting = Boolean(entry?.isIntersecting);

          if (!this.intersecting || !wasIntersecting) {
            this.emittedForCurrentIntersection = false;
          }

          this.maybeEmit();
        },
        {
          root: this.root(),
          rootMargin: this.rootMargin(),
          threshold: this.threshold(),
        },
      );
      this.observer.observe(this.elementRef.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private maybeEmit(): void {
    if (!this.intersecting || this.paused() || this.disabled() || this.emittedForCurrentIntersection) {
      return;
    }

    this.emittedForCurrentIntersection = true;
    this.zone.run(() => this.reachedEnd.emit());
  }
}
