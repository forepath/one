import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';

/**
 * Moves an overlay element to `<body>` so no ancestor stacking context (`z-index`, `isolation`,
 * `transform`, sticky headers, …) can cover or clip it; `restore()` puts it back where it was.
 *
 * Angular removes view nodes with `node.remove()`, so a portaled node still disappears when its
 * view is destroyed directly; nested nodes of a destroyed parent view are not removed one by one,
 * which is why owners call `dispose()` in `ngOnDestroy` / `DestroyRef.onDestroy`.
 */
export class FpcBodyPortal {
  private placeholder: Comment | null = null;
  private element: HTMLElement | null = null;

  constructor(private readonly document: Document) {}

  /** Whether `element` currently sits at body level through this portal. */
  get attached(): boolean {
    return !!this.element && this.element.parentNode === this.document.body;
  }

  /** Moves `element` to the end of `<body>` (later = above equal layers). Idempotent. */
  attach(element: HTMLElement): void {
    if (this.element === element && this.attached) return;

    if (this.element && this.element !== element) this.restore();

    const parent = element.parentNode;

    if (parent && parent !== this.document.body) {
      this.placeholder = this.document.createComment('fpc-body-portal');
      parent.insertBefore(this.placeholder, element);
    }

    this.element = element;
    this.document.body.appendChild(element);
  }

  /** Puts the element back at its original place (or drops it when that place is gone). */
  restore(): void {
    const element = this.element;
    const placeholder = this.placeholder;

    this.element = null;
    this.placeholder = null;

    if (!element) return;

    if (placeholder?.parentNode) {
      placeholder.parentNode.insertBefore(element, placeholder);
      placeholder.remove();
    } else if (element.parentNode === this.document.body) {
      element.remove();
    }
  }

  /** Owner destroyed: remove the element from `<body>` and the placeholder. */
  dispose(): void {
    if (this.element?.parentNode === this.document.body) this.element.remove();

    this.placeholder?.remove();
    this.element = null;
    this.placeholder = null;
  }
}

/**
 * Whether overlays (`fpc-modal`, `fpc-context-menu`, `fpc-dropdown appendTo="auto"`) render at
 * `<body>` level. Off by default so component specs keep finding overlay content inside their
 * fixture; app shells turn it on with `provideFpcOverlayPortal()`.
 */
export const FPC_OVERLAY_PORTAL = new InjectionToken<boolean>('FPC_OVERLAY_PORTAL', {
  providedIn: 'root',
  factory: () => false,
});

/** App config: render overlays at `<body>` level (see `FPC_OVERLAY_PORTAL`). */
export function provideFpcOverlayPortal(enabled = true): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: FPC_OVERLAY_PORTAL, useValue: enabled }]);
}
