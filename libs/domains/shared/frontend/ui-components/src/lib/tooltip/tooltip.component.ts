import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  input,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';

export type FpcTooltipPlacement = 'top' | 'bottom' | 'start' | 'end';

export type FpcTooltipAppearance = 'default' | 'panel';

let tooltipSeq = 0;

/**
 * Hover/focus tooltip without Bootstrap JS. Preferred `placement` flips when there is not enough
 * room in the nearest scroll/clip ancestor (same flip idea as `fpc-sidebar-popover`, scoped to the
 * clipping box so tips under a search strip open below). The bubble is portaled to `document.body`
 * with `position: fixed` so overflow / `isolation` cannot clip or cover it.
 */
@Component({
  selector: 'fpc-tooltip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-tooltip',
    '[attr.title]': 'nativeTitle() ? text() : null',
  },
  template: `
    <span
      class="fpc-tooltip__anchor"
      tabindex="0"
      [attr.aria-describedby]="open() ? resolvedId() : null"
      (mouseenter)="show()"
      (mouseleave)="hide()"
      (focusin)="show()"
      (focusout)="hide()"
    >
      <ng-content />
    </span>

    @if (open()) {
      <span
        #bubble
        class="fpc-tooltip__bubble"
        [class.fpc-tooltip__bubble--panel]="appearance() === 'panel'"
        role="tooltip"
        [id]="resolvedId()"
        [style.top.px]="bubbleTop()"
        [style.left.px]="bubbleLeft()"
        [style.width.px]="bubbleWidth()"
        [style.max-width.px]="bubbleMaxWidth()"
        [style.max-height.px]="bubbleMaxHeight()"
      >
        {{ text() }}
      </span>
    }
  `,
  styleUrl: './tooltip.component.scss',
})
export class FpcTooltipComponent implements OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly bubbleRef = viewChild<ElementRef<HTMLElement>>('bubble');
  private readonly generatedId = `fpc-tooltip-${++tooltipSeq}`;
  private readonly onScrollReposition = (): void => this.syncBubblePosition();
  private scrollListenTargets: Array<HTMLElement | Window> = [];

  readonly text = input.required<string>();
  /** Preferred edge; flipped when that side lacks room in the clip rect. */
  readonly placement = input<FpcTooltipPlacement>('top');
  readonly tooltipId = input<string | null>(null);
  /** Also expose the text through the native `title` attribute. */
  readonly nativeTitle = input(true);
  /** `panel` = light bordered popover (e.g. scope lists); default = dark tip. */
  readonly appearance = input<FpcTooltipAppearance>('default');

  protected readonly open = signal(false);
  protected readonly bubbleTop = signal(0);
  protected readonly bubbleLeft = signal(0);
  protected readonly bubbleMaxWidth = signal<number | null>(null);
  /** Width measured at the viewport origin, kept at the final position (no re-wrap there). */
  protected readonly bubbleWidth = signal<number | null>(null);
  protected readonly bubbleMaxHeight = signal<number | null>(null);

  protected readonly resolvedId = () => this.tooltipId() ?? this.generatedId;

  constructor() {
    effect(() => {
      if (!this.open()) {
        this.detachScrollListeners();

        return;
      }

      afterNextRender(
        () => {
          if (!this.open()) {
            return;
          }

          this.portalBubbleToBody();
          this.attachScrollListeners();
          this.syncBubblePosition();
        },
        { injector: this.injector },
      );
    });
  }

  ngOnDestroy(): void {
    this.hide();
  }

  @HostListener('window:resize')
  protected onResize(): void {
    if (this.open()) {
      this.syncBubblePosition();
    }
  }

  protected show(): void {
    this.open.set(true);
  }

  protected hide(): void {
    this.restoreBubbleToHost();
    this.detachScrollListeners();
    this.open.set(false);
  }

  private portalBubbleToBody(): void {
    const bubble = this.bubbleRef()?.nativeElement;

    if (bubble && bubble.parentElement !== document.body) {
      document.body.appendChild(bubble);
    }
  }

  private restoreBubbleToHost(): void {
    const bubble = this.bubbleRef()?.nativeElement;

    if (bubble?.parentElement === document.body) {
      this.elementRef.nativeElement.appendChild(bubble);
    }
  }

  private attachScrollListeners(): void {
    this.detachScrollListeners();

    const targets: Array<HTMLElement | Window> = [window];
    let el: HTMLElement | null = this.elementRef.nativeElement.parentElement;

    while (el) {
      const { overflow, overflowX, overflowY } = getComputedStyle(el);

      if (this.isClipValue(overflow) || this.isClipValue(overflowX) || this.isClipValue(overflowY)) {
        targets.push(el);
      }

      el = el.parentElement;
    }

    for (const target of targets) {
      target.addEventListener('scroll', this.onScrollReposition, { passive: true });
    }

    this.scrollListenTargets = targets;
  }

  private detachScrollListeners(): void {
    for (const target of this.scrollListenTargets) {
      target.removeEventListener('scroll', this.onScrollReposition);
    }

    this.scrollListenTargets = [];
  }

  private syncBubblePosition(): void {
    const bubble = this.bubbleRef()?.nativeElement;
    const hostRect = this.elementRef.nativeElement.getBoundingClientRect();

    if (!bubble || !this.open()) {
      return;
    }

    this.portalBubbleToBody();

    const gap = 6;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Measure at the viewport origin with no width limits: a fixed bubble near the right edge would otherwise wrap
    // narrower than at its last / first position and come out taller than measured (first hover too short).
    bubble.style.left = '0px';
    bubble.style.top = '0px';
    bubble.style.width = '';
    bubble.style.maxHeight = 'none';
    bubble.style.maxWidth = '';

    const naturalHeight = bubble.offsetHeight;
    const naturalWidth = Math.ceil(bubble.getBoundingClientRect().width);
    // Prefer room inside the nearest scroll area so tips do not sit under sticky siblings (search strips), clamped
    // into the viewport. When the bubble fits on neither side there (short table bodies, modals), it may use the whole
    // viewport instead of being squeezed: it is portaled to <body>, so nothing clips it.
    const viewport = new DOMRect(0, 0, viewportWidth, viewportHeight);
    let layout = this.resolveSide(this.boundsWithin(this.clipRect()), hostRect, naturalWidth, naturalHeight, gap);

    if (!layout.fits) {
      layout = this.resolveSide(this.boundsWithin(viewport), hostRect, naturalWidth, naturalHeight, gap);
    }

    const { side, bounds, space } = layout;
    const { top: boundTop, bottom: boundBottom, left: boundLeft, right: boundRight } = bounds;
    const spaceAbove = space.above;
    const spaceBelow = space.below;
    const spaceStart = space.start;
    const spaceEnd = space.end;
    let top = 0;
    let left = 0;
    let maxHeight: number | null = null;
    let maxWidth: number | null = null;

    if (side === 'top' || side === 'bottom') {
      const available = Math.max(0, side === 'top' ? spaceAbove : spaceBelow);
      const usedHeight = Math.min(naturalHeight, available);

      maxHeight = naturalHeight > available + 0.5 ? available : null;
      top = side === 'top' ? hostRect.top - gap - usedHeight : hostRect.bottom + gap;
      left = hostRect.left + hostRect.width / 2 - naturalWidth / 2;
      left = Math.min(Math.max(boundLeft + gap, left), Math.max(boundLeft + gap, boundRight - naturalWidth - gap));
    } else {
      const available = Math.max(0, side === 'start' ? spaceStart : spaceEnd);
      const usedWidth = Math.min(naturalWidth, available);

      maxWidth = naturalWidth > available + 0.5 ? available : null;
      left = side === 'start' ? hostRect.left - gap - usedWidth : hostRect.right + gap;
      top = hostRect.top + hostRect.height / 2 - naturalHeight / 2;
      top = Math.min(Math.max(boundTop + gap, top), Math.max(boundTop + gap, boundBottom - naturalHeight - gap));
    }

    const width = maxWidth ?? naturalWidth;

    // Write the result directly too: the signal bindings skip unchanged values, so the inline overrides above must
    // not linger.
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.width = `${width}px`;
    bubble.style.maxHeight = maxHeight === null ? '' : `${maxHeight}px`;
    bubble.style.maxWidth = maxWidth === null ? '' : `${maxWidth}px`;

    this.bubbleTop.set(top);
    this.bubbleLeft.set(left);
    this.bubbleWidth.set(width);
    this.bubbleMaxHeight.set(maxHeight);
    this.bubbleMaxWidth.set(maxWidth);
  }

  /**
   * Nearest scroll area (`overflow: auto | scroll`), otherwise the viewport. `hidden` / `clip` ancestors are skipped:
   * the bubble is portaled to <body>, so they cannot clip it, and many of them are tiny (truncating table cells, whose
   * row height would otherwise squeeze the bubble).
   */
  private clipRect(): DOMRect {
    let el: HTMLElement | null = this.elementRef.nativeElement.parentElement;

    while (el) {
      const { overflow, overflowX, overflowY } = getComputedStyle(el);
      const scrolls = this.isScrollValue(overflow) || this.isScrollValue(overflowX) || this.isScrollValue(overflowY);

      if (scrolls) {
        return el.getBoundingClientRect();
      }

      el = el.parentElement;
    }

    return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  /** Intersection of a rect with the viewport. */
  private boundsWithin(rect: DOMRect): { top: number; bottom: number; left: number; right: number } {
    return {
      top: Math.max(rect.top, 0),
      bottom: Math.min(rect.bottom, window.innerHeight),
      left: Math.max(rect.left, 0),
      right: Math.min(rect.right, window.innerWidth),
    };
  }

  /** Picks the side for the bubble inside `bounds`; `fits` is false when neither the preferred nor the opposite side has room. */
  private resolveSide(
    bounds: { top: number; bottom: number; left: number; right: number },
    hostRect: DOMRect,
    naturalWidth: number,
    naturalHeight: number,
    gap: number,
  ): {
    side: FpcTooltipPlacement;
    fits: boolean;
    bounds: { top: number; bottom: number; left: number; right: number };
    space: { above: number; below: number; start: number; end: number };
  } {
    const space = {
      above: hostRect.top - bounds.top - gap,
      below: bounds.bottom - hostRect.bottom - gap,
      start: hostRect.left - bounds.left - gap,
      end: bounds.right - hostRect.right - gap,
    };
    const preferred = this.placement();
    const vertical = preferred === 'top' || preferred === 'bottom';
    const size = vertical ? naturalHeight : naturalWidth;
    const room = (side: FpcTooltipPlacement): number =>
      side === 'top' ? space.above : side === 'bottom' ? space.below : side === 'start' ? space.start : space.end;
    const opposite: FpcTooltipPlacement =
      preferred === 'top' ? 'bottom' : preferred === 'bottom' ? 'top' : preferred === 'start' ? 'end' : 'start';

    if (size <= room(preferred)) {
      return { side: preferred, fits: true, bounds, space };
    }

    if (size <= room(opposite)) {
      return { side: opposite, fits: true, bounds, space };
    }

    const fallback: FpcTooltipPlacement = vertical
      ? space.below >= space.above
        ? 'bottom'
        : 'top'
      : space.end >= space.start
        ? 'end'
        : 'start';

    return { side: fallback, fits: false, bounds, space };
  }

  private isScrollValue(value: string): boolean {
    return value === 'auto' || value === 'scroll';
  }

  private isClipValue(value: string): boolean {
    return value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip';
  }
}
