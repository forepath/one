import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { FpcSpinnerComponent } from '../spinner/spinner.component';

export type FpcButtonVariant =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'light'
  | 'dark'
  | 'link'
  | 'outline-primary'
  | 'outline-secondary'
  | 'outline-success'
  | 'outline-danger'
  | 'outline-warning'
  | 'outline-info'
  | 'outline-light'
  | 'outline-dark';

export type FpcButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type FpcButtonType = 'button' | 'submit' | 'reset';

/**
 * Bootstrap button wrapper. The native click event bubbles out of the host element, so
 * `<fpc-button (click)="...">` works; `(clicked)` is the explicit, strongly typed alternative.
 *
 * Prefer host `routerLink` / `queryParams` / `fragment` (import `RouterLink` in the parent) for
 * SPA navigation. Those bind to a host-level `RouterLink`; this component activates that link from
 * the inner control click so path + query params apply. Do not also put `RouterLink` on an inner
 * control or via `hostDirectives` — Angular allows only one match per element.
 *
 * When `href` is set, activation navigates (new tab when `target="_blank"` or modifier-click).
 *
 * Projected content uses a single `<ng-content>` (Angular must not wrap projection in `@if`).
 *
 * `size="xl"` is the landing/marketing CTA scale (above Bootstrap `lg`). Extra classes that must
 * land on the native `.btn` (e.g. `rounded-3`) go through `btnClass`.
 *
 * Marketing CTA tones (on `size="xl"`): inside `#cta` / `#fit`, `variant="primary"` is slightly
 * darkened; inside `#hero`, `variant="dark"` uses a soft offset (`--fpc-btn-hero-dark-*`, brand-
 * overridable). These live on the button so page SCSS does not need to pierce encapsulation.
 *
 * When content includes `fpc-badge`, the inner control is flush (no Bootstrap button padding) so
 * the badge owns the visual size — use this for clickable chips (workspace switchers, etc.).
 */
@Component({
  selector: 'fpc-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcSpinnerComponent],
  host: {
    class: 'fpc-button',
    '[class.fpc-button--block]': 'block()',
    '[class.fpc-button--link]': 'isLink()',
    '[class.fpc-button--xl]': 'size() === "xl"',
  },
  template: `
    <button
      [type]="isLink() ? 'button' : type()"
      [class]="buttonClasses()"
      [attr.id]="controlId()"
      [disabled]="disabled() || loading()"
      [attr.aria-busy]="loading() ? 'true' : null"
      [attr.aria-label]="ariaLabel()"
      [attr.title]="title()"
      [attr.data-bs-dismiss]="dataBsDismiss()"
      [attr.data-bs-toggle]="dataBsToggle()"
      [attr.aria-expanded]="dataBsToggle() ? 'false' : null"
      (click)="onClick($event)"
      (auxclick)="onAuxClick($event)"
    >
      @if (loading()) {
        <fpc-spinner size="sm" class="fpc-button__spinner" label="Loading" />
      }
      <ng-content />
    </button>
  `,
  styleUrl: './button.component.scss',
})
export class FpcButtonComponent {
  /** Present when the parent puts `routerLink` on this host (parent must import `RouterLink`). */
  private readonly hostRouterLink = inject(RouterLink, { optional: true, host: true });
  private readonly router = inject(Router, { optional: true });

  readonly variant = input<FpcButtonVariant>('primary');
  readonly size = input<FpcButtonSize>('md');
  readonly type = input<FpcButtonType>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  /** Renders a square control; sizing lives in this component (not a global stylesheet). */
  readonly iconOnly = input(false, { transform: booleanAttribute });
  /** Stretches the button to the full width of its container. */
  readonly block = input(false, { transform: booleanAttribute });
  readonly ariaLabel = input<string | null>(null);
  /** Native tooltip; useful for icon-only buttons. */
  readonly title = input<string | null>(null);
  /**
   * When set, activation navigates to this URL (see `target` / `rel`).
   * Leave unset and put `routerLink` on the host for SPA navigation.
   */
  readonly href = input<string | null>(null);
  readonly target = input<string | null>(null);
  readonly rel = input<string | null>(null);
  /** Optional Bootstrap dismiss hook (e.g. `modal`) on the inner control. */
  readonly dataBsDismiss = input<string | null>(null);
  /** Optional Bootstrap toggle hook (e.g. `dropdown`) on the inner control. */
  readonly dataBsToggle = input<string | null>(null);
  /** Forwards to the inner control `id` (e.g. Bootstrap dropdown `aria-labelledby`). */
  readonly controlId = input<string | null>(null);
  /** Extra classes appended to the native `.btn` (e.g. `rounded-3`, `dropdown-toggle`). */
  readonly btnClass = input<string | null>(null);

  readonly clicked = output<MouseEvent>();

  protected readonly isLink = computed(() => !!this.href());

  protected readonly buttonClasses = computed(() => {
    const classes = ['btn', `btn-${this.variant()}`, 'fpc-button__btn'];
    const size = this.size();

    if (size === 'sm' || size === 'lg') {
      classes.push(`btn-${size}`);
    } else if (size === 'xs') {
      classes.push('btn-sm', 'fpc-button__btn--xs');
    } else if (size === 'xl') {
      // `cta-btn` kept for any residual global landing hooks; tones live in button SCSS.
      classes.push('fpc-button__btn--xl', 'cta-btn');
    }

    if (this.iconOnly()) {
      classes.push('fpc-button__btn--icon');
    }

    if (this.block()) {
      classes.push('w-100');
    }

    if (this.disabled() || this.loading()) {
      classes.push('disabled');
    }

    const extra = this.btnClass()?.trim();

    if (extra) {
      classes.push(extra);
    }

    return classes.join(' ');
  });

  protected onClick(event: MouseEvent): void {
    if (this.disabled() || this.loading()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const url = this.href();

    if (url) {
      this.navigateHref(url, event);
      this.clicked.emit(event);
      return;
    }

    // Host `RouterLink` listens on the host; the interactive target is the inner <button>.
    if (this.activateHostRouterLink(event)) {
      this.clicked.emit(event);
      return;
    }

    this.clicked.emit(event);
  }

  protected onAuxClick(event: MouseEvent): void {
    if (event.button !== 1) {
      return;
    }

    const url = this.href();

    if (!url || this.disabled() || this.loading()) {
      return;
    }

    event.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
    this.clicked.emit(event);
  }

  /**
   * Mirrors `RouterLink.onClick` for non-anchor hosts so SPA navigation (including
   * `queryParams`) runs when the user activates the inner control.
   */
  private activateHostRouterLink(event: MouseEvent): boolean {
    const link = this.hostRouterLink;
    const router = this.router;
    const urlTree = link?.urlTree ?? null;

    if (!link || !router || urlTree === null) {
      return false;
    }

    if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
      return false;
    }

    void router.navigateByUrl(urlTree, {
      skipLocationChange: link.skipLocationChange,
      replaceUrl: link.replaceUrl,
      state: link.state,
      info: link.info,
    });

    // Prevent the host RouterLink listener from handling the bubbled click a second time.
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  private navigateHref(url: string, event: MouseEvent): void {
    const openInNewTab = this.target() === '_blank' || event.metaKey || event.ctrlKey;

    if (openInNewTab) {
      event.preventDefault();
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    window.location.assign(url);
  }
}
