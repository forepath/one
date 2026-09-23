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
    const clip = this.clipRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Prefer room inside the clip ancestor so tips do not sit under sticky siblings (search strips).
    // Still clamp into the viewport after portal so nothing paints off-screen.
    const boundTop = Math.max(clip.top, 0);
    const boundBottom = Math.min(clip.bottom, viewportHeight);
    const boundLeft = Math.max(clip.left, 0);
    const boundRight = Math.min(clip.right, viewportWidth);

    bubble.style.maxHeight = 'none';
    bubble.style.maxWidth = '';

    const naturalHeight = bubble.offsetHeight;
    const naturalWidth = bubble.offsetWidth;

    const spaceAbove = hostRect.top - boundTop - gap;
    const spaceBelow = boundBottom - hostRect.bottom - gap;
    const spaceStart = hostRect.left - boundLeft - gap;
    const spaceEnd = boundRight - hostRect.right - gap;

    const preferred = this.placement();
    let side: FpcTooltipPlacement = preferred;

    if (preferred === 'top' || preferred === 'bottom') {
      const fitsPreferred = preferred === 'top' ? naturalHeight <= spaceAbove : naturalHeight <= spaceBelow;
      const fitsOpposite = preferred === 'top' ? naturalHeight <= spaceBelow : naturalHeight <= spaceAbove;

      if (!fitsPreferred && fitsOpposite) {
        side = preferred === 'top' ? 'bottom' : 'top';
      } else if (!fitsPreferred && !fitsOpposite) {
        side = spaceBelow >= spaceAbove ? 'bottom' : 'top';
      }
    } else {
      const fitsPreferred = preferred === 'start' ? naturalWidth <= spaceStart : naturalWidth <= spaceEnd;
      const fitsOpposite = preferred === 'start' ? naturalWidth <= spaceEnd : naturalWidth <= spaceStart;

      if (!fitsPreferred && fitsOpposite) {
        side = preferred === 'start' ? 'end' : 'start';
      } else if (!fitsPreferred && !fitsOpposite) {
        side = spaceEnd >= spaceStart ? 'end' : 'start';
      }
    }

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

    bubble.style.maxHeight = '';
    bubble.style.maxWidth = '';

    this.bubbleTop.set(top);
    this.bubbleLeft.set(left);
    this.bubbleMaxHeight.set(maxHeight);
    this.bubbleMaxWidth.set(maxWidth);
  }

  /** Nearest scroll/clip ancestor, otherwise the viewport. */
  private clipRect(): DOMRect {
    let el: HTMLElement | null = this.elementRef.nativeElement.parentElement;

    while (el) {
      const { overflow, overflowX, overflowY } = getComputedStyle(el);
      const clip = this.isClipValue(overflow) || this.isClipValue(overflowX) || this.isClipValue(overflowY);

      if (clip) {
        return el.getBoundingClientRect();
      }

      el = el.parentElement;
    }

    return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  private isClipValue(value: string): boolean {
    return value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip';
  }
}
