import { Directive, OnDestroy, input, output } from '@angular/core';

/**
 * Emits `fpcLongPress` after a touch is held still for `fpcLongPressDelay` ms (default 500) - the
 * touch equivalent of a right click. Pair it with `(contextmenu)` to open `fpc-context-menu`.
 */
@Directive({
  selector: '[fpcLongPress]',
  standalone: true,
  host: {
    '(touchstart)': 'start($event)',
    '(touchmove)': 'move($event)',
    '(touchend)': 'cancel()',
    '(touchcancel)': 'cancel()',
  },
})
export class FpcLongPressDirective implements OnDestroy {
  readonly fpcLongPressDelay = input(500);
  readonly fpcLongPress = output<{ x: number; y: number }>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private origin: { x: number; y: number } | null = null;

  protected start(event: TouchEvent): void {
    const touch = event.touches[0];

    if (!touch || event.touches.length > 1) return;

    this.cancel();
    this.origin = { x: touch.clientX, y: touch.clientY };
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.origin) this.fpcLongPress.emit(this.origin);
    }, this.fpcLongPressDelay());
  }

  protected move(event: TouchEvent): void {
    const touch = event.touches[0];

    if (this.origin && touch && Math.hypot(touch.clientX - this.origin.x, touch.clientY - this.origin.y) > 10) {
      this.cancel();
    }
  }

  protected cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  ngOnDestroy(): void {
    this.cancel();
  }
}
