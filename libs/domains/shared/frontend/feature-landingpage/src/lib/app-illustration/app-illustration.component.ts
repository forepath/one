import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * Window frame for product illustrations on the landing pages: a drawn version of the console,
 * built from the real `fpc-*` components instead of a screenshot. The projected scene is laid out
 * at a fixed design size (`width` x `height`) and scaled down to the available width with CSS only,
 * so it renders the same in the prerendered HTML.
 *
 * The scene is decorative: it is `inert` (nothing inside is focusable or clickable) and the frame is
 * exposed as one image with `label` as its accessible name.
 */
@Component({
  selector: 'shared-app-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'shared-app-illustration',
    role: 'img',
    '[attr.aria-label]': 'label()',
    '[style.--shared-app-illustration-width]': 'width() + "px"',
    '[style.--shared-app-illustration-height]': 'height() + "px"',
    '[class.shared-app-illustration--bare]': '!chrome()',
    '[class.shared-app-illustration--offscreen]': 'offscreen()',
  },
  template: `
    <div class="shared-app-illustration__window" [attr.data-bs-theme]="theme() === 'dark' ? 'dark' : null">
      @if (chrome()) {
        <div class="shared-app-illustration__chrome" aria-hidden="true">
          <span class="shared-app-illustration__lights"><i></i><i></i><i></i></span>
          @if (address()) {
            <span class="shared-app-illustration__address">
              <i class="bi bi-lock-fill" aria-hidden="true"></i>{{ address() }}
            </span>
          } @else if (windowTitle()) {
            <span class="shared-app-illustration__title">{{ windowTitle() }}</span>
          }
        </div>
      }
      <div class="shared-app-illustration__viewport">
        <div class="shared-app-illustration__canvas" inert aria-hidden="true">
          <ng-content />
        </div>
      </div>
    </div>
  `,
  styleUrl: './app-illustration.component.scss',
})
export class SharedAppIllustrationComponent {
  /** Accessible description of the scene (reuse the alt text of the screenshot it replaces). */
  readonly label = input.required<string>();
  /** Address shown in the browser-style bar (e.g. `app.agenstra.com/tickets`). */
  readonly address = input<string | null>(null);
  /** Window title for desktop-app frames (used when there is no `address`). */
  readonly windowTitle = input<string | null>(null);
  /** `auto` follows the page theme (light / dark switch); `dark` pins the scene to dark mode. */
  readonly theme = input<'dark' | 'auto'>('auto');
  /**
   * `false` drops the window frame: the scene draws its own windows on a transparent canvas (e.g. a
   * desktop with several apps side by side).
   */
  readonly chrome = input(true);
  readonly width = input(1200);
  readonly height = input(720);

  /** The scene's light motion (`sai-motion-*`, see the stylesheet) pauses while it is off screen. */
  protected readonly offscreen = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

    afterNextRender(() => {
      if (!isBrowser || typeof IntersectionObserver === 'undefined') {
        return;
      }

      const observer = new IntersectionObserver(([entry]) => this.offscreen.set(!entry.isIntersecting));

      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
