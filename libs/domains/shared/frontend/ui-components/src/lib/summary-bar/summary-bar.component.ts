import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';

import { FpcSummaryCardComponent } from '../summary-card/summary-card.component';

/** Viewport widths (px) below which the bar turns into a one-row slider; matches the SCSS. */
const SLIDER_MAX_WIDTH = 767.98;
const SINGLE_CARD_MAX_WIDTH = 479.98;

/**
 * Metric strip above a page body. The bar owns cell separators: right edges (kept when the last
 * row is incomplete) and full-width bottoms on completed rows. The outer bottom edge is drawn when
 * `bordered`.
 *
 * Below the md breakpoint the bar never wraps into several rows (that pushed the page body down).
 * It shows one row instead (two cards, or one on narrow phones) as a swipeable slider with page
 * dots. With `autoplay` it advances on its own; it pauses while hovered, focused or touched, while
 * the tab is hidden, and never runs when the user prefers reduced motion.
 */
@Component({
  selector: 'fpc-summary-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'onPointerLeave($event)',
    '(focusin)': 'onFocusIn($event)',
    '(focusout)': 'onFocusOut($event)',
    '(touchstart)': 'touching.set(true)',
    '(touchend)': 'onTouchEnd()',
    '(touchcancel)': 'onTouchEnd()',
  },
  template: `
    <div #track class="fpc-summary-bar__grid" (scroll)="onTrackScroll()"><ng-content /></div>

    @if (pageCount() > 1) {
      <div class="fpc-summary-bar__pager" role="group" [attr.aria-label]="pagerAriaLabel()">
        @for (page of pages(); track page) {
          <button
            type="button"
            class="fpc-summary-bar__dot"
            [class.fpc-summary-bar__dot--active]="page === activePage()"
            [attr.aria-label]="pageAriaLabel() + ' ' + (page + 1)"
            [attr.aria-current]="page === activePage() ? 'true' : null"
            (click)="showPage(page)"
          ></button>
        }
      </div>
    }
  `,
  styleUrl: './summary-bar.component.scss',
})
export class FpcSummaryBarComponent {
  readonly columns = input(4);
  readonly bordered = input(true);
  /** Advance the mobile slider automatically. */
  readonly autoplay = input(true);
  /** Milliseconds between automatic slides. */
  readonly autoplayInterval = input(6000);
  readonly pagerAriaLabel = input('Summary pages');
  readonly pageAriaLabel = input('Show page');

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');
  private readonly cards = contentChildren(FpcSummaryCardComponent);

  /** Cards per slider page; 0 when the viewport is wide enough for the regular grid. */
  private readonly cardsPerPage = signal(0);
  private readonly reducedMotion = signal(false);
  private readonly documentHidden = signal(false);
  private readonly hovered = signal(false);
  private readonly focused = signal(false);
  protected readonly touching = signal(false);
  /** Bumped on manual navigation so the autoplay timer starts over. */
  private readonly autoplayRestart = signal(0);

  protected readonly activePage = signal(0);

  protected readonly pageCount = computed(() => {
    const perPage = this.cardsPerPage();

    return perPage > 0 ? Math.ceil(this.cards().length / perPage) : 0;
  });

  protected readonly pages = computed(() => Array.from({ length: this.pageCount() }, (_, index) => index));

  protected readonly hostClasses = computed(() => {
    const cols = Math.min(12, Math.max(1, Math.round(this.columns())));
    const classes = ['fpc-summary-bar', `fpc-summary-bar--cols-${cols}`];

    if (this.bordered()) {
      classes.push('fpc-summary-bar--bordered');
    }

    return classes.join(' ');
  });

  constructor() {
    if (this.isBrowser) {
      this.watchMedia(`(max-width: ${SINGLE_CARD_MAX_WIDTH}px)`, () => this.updateCardsPerPage());
      this.watchMedia(`(max-width: ${SLIDER_MAX_WIDTH}px)`, () => this.updateCardsPerPage());
      this.watchMedia('(prefers-reduced-motion: reduce)', (matches) => this.reducedMotion.set(matches));
      this.watchDocumentVisibility();
    }

    // Keep the active dot valid when cards come and go or the breakpoint changes.
    effect(() => {
      const count = this.pageCount();

      if (this.activePage() > Math.max(count - 1, 0)) {
        this.activePage.set(Math.max(count - 1, 0));
      }
    });

    effect((onCleanup) => {
      this.autoplayRestart();

      const running =
        this.isBrowser &&
        this.autoplay() &&
        this.pageCount() > 1 &&
        !this.reducedMotion() &&
        !this.documentHidden() &&
        !this.hovered() &&
        !this.focused() &&
        !this.touching();

      if (!running) {
        return;
      }

      const timer = setInterval(
        () => this.scrollToPage((this.activePage() + 1) % this.pageCount()),
        Math.max(this.autoplayInterval(), 1000),
      );

      onCleanup(() => clearInterval(timer));
    });
  }

  protected showPage(page: number): void {
    this.scrollToPage(page);
    this.autoplayRestart.update((value) => value + 1);
  }

  protected onTrackScroll(): void {
    const track = this.track().nativeElement;

    if (this.cardsPerPage() === 0 || track.clientWidth === 0) {
      return;
    }

    const page = Math.round(track.scrollLeft / track.clientWidth);

    if (page !== this.activePage()) {
      this.activePage.set(Math.min(page, Math.max(this.pageCount() - 1, 0)));
    }
  }

  protected onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      this.hovered.set(true);
    }
  }

  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      this.hovered.set(false);
    }
  }

  /** Keyboard focus pauses autoplay; a tap or click on a dot should not stop it for good. */
  protected onFocusIn(event: FocusEvent): void {
    if ((event.target as Element | null)?.matches(':focus-visible')) {
      this.focused.set(true);
    }
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;

    if (!next || !this.host.nativeElement.contains(next)) {
      this.focused.set(false);
    }
  }

  protected onTouchEnd(): void {
    this.touching.set(false);
    this.autoplayRestart.update((value) => value + 1);
  }

  private scrollToPage(page: number): void {
    const track = this.track().nativeElement;

    this.activePage.set(page);
    track.scrollTo({ left: page * track.clientWidth, behavior: this.reducedMotion() ? 'auto' : 'smooth' });
  }

  private updateCardsPerPage(): void {
    const view = window;

    if (view.matchMedia(`(max-width: ${SINGLE_CARD_MAX_WIDTH}px)`).matches) {
      this.cardsPerPage.set(1);
    } else if (view.matchMedia(`(max-width: ${SLIDER_MAX_WIDTH}px)`).matches) {
      this.cardsPerPage.set(2);
    } else {
      this.cardsPerPage.set(0);
    }
  }

  private watchMedia(query: string, onChange: (matches: boolean) => void): void {
    const media = window.matchMedia(query);
    const listener = (event: MediaQueryListEvent): void => onChange(event.matches);

    onChange(media.matches);
    media.addEventListener('change', listener);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', listener));
  }

  private watchDocumentVisibility(): void {
    const listener = (): void => this.documentHidden.set(document.visibilityState === 'hidden');

    listener();
    document.addEventListener('visibilitychange', listener);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', listener));
  }
}
