import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Single-line labels (`fpc-label`, check / switch labels) ellipsize instead of wrapping. On hover this shows the full
 * text as the native `title`, but only while the text is actually cut off; an explicit `title` is left alone.
 */
@Directive({
  selector: '[fpcTruncateTitle]',
  standalone: true,
  host: {
    '(mouseenter)': 'sync()',
  },
})
export class FpcTruncateTitleDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private managed = false;

  protected sync(): void {
    const element = this.host.nativeElement;

    if (element.hasAttribute('title') && !this.managed) {
      return;
    }

    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    if (text && element.scrollWidth > element.clientWidth) {
      element.setAttribute('title', text);
      this.managed = true;
    } else {
      element.removeAttribute('title');
      this.managed = false;
    }
  }
}
