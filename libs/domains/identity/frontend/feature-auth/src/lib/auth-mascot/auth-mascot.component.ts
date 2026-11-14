import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  NgZone,
} from '@angular/core';
import {
  IDENTITY_AUTH_ENVIRONMENT,
  isAuthMascotVisible,
  type IdentityAuthEnvironment,
} from '@forepath/identity/frontend';
import { SharedHeroMascotComponent } from '@forepath/shared/frontend/feature-landingpage';

import { resolveAuthBrand } from '../auth-brand/auth-brand';

/**
 * The product's brand character on the public auth pages (login, registration, password reset and
 * the like), like the landing footers' one: peeking up from the bottom edge of the form column, centred
 * under it, and pulling itself up while the pointer is near it (this block is its hover area; always up
 * without hover). Hidden with `authentication.layout.showMascot: false`.
 *
 * Place it once per page as the last child of the `fpc-section-row` marked `data-hero-mascot-track`
 * (so its eyes follow the pointer over the whole page). It is positioned on the row, which does not
 * scroll, so it stays on the column's bottom edge; the form column keeps room for it at its end (and
 * as much at its start from md up, so a form that fits stays centred), so a scrolling form ends clear
 * of it. While a scrolling form column is not at its end, the character waits out of sight below the
 * edge and comes in once the reader has scrolled all the way down.
 */
@Component({
  selector: 'identity-auth-mascot',
  standalone: true,
  imports: [SharedHeroMascotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', 'data-hero-mascot-area': '' },
  template: `
    @if (brand) {
      <shared-hero-mascot [brand]="brand" pose="peek" class="identity-auth-mascot" />
    }
  `,
  styles: `
    // Centred under the form column (the whole row) at its bottom edge. The space above the character is
    // part of its hover area.
    :host {
      position: absolute;
      z-index: 1;
      bottom: 0;
      left: 50%;
      display: block;
      padding-top: 1rem;
      translate: -50% 0;
    }

    :host(:empty) {
      display: none;
    }

    // As wide as the landing footers' character.
    .identity-auth-mascot {
      display: block;
      width: clamp(4rem, 8vw, 5.5rem);
    }

    // Away (the form column scrolls and is not at its end): the whole drawing, hands on the edge
    // included, sinks below the clip edge; it comes back in, in the peek pose's own easing, at the end.
    :host ::ng-deep .shared-hero-mascot__svg {
      transition: translate 0.6s cubic-bezier(0.2, 0.7, 0.1, 1);
    }

    :host(.identity-auth-mascot--away) ::ng-deep .shared-hero-mascot__svg {
      translate: 0 100%;
    }

    @media (prefers-reduced-motion: reduce) {
      :host ::ng-deep .shared-hero-mascot__svg {
        transition: none;
      }
    }

    // The row anchors the character; the form column (its own scroll area) keeps room for its visible
    // part (about 70% of its square box) plus a gap at the end, so a scrolling form ends clear of it.
    // The room above stays the auth styles' own (as much as the card's side gutter). Only on a row whose
    // character is shown.
    ::ng-deep fpc-section-row:has(> identity-auth-mascot .identity-auth-mascot) {
      position: relative;

      > .section__column--form {
        padding-bottom: calc(clamp(4rem, 8vw, 5.5rem) * 0.7 + 1rem);
      }

      // Like the landing footers' character, it pulls itself up while the pointer is in its column (the
      // form column), not only over itself: the same rise as the shared peek pose's hover (31 of its 111
      // viewBox units), so its own transition carries it.
      &:has(> .section__column--form:hover)
        > identity-auth-mascot
        .shared-hero-mascot__svg--peek
        .shared-hero-mascot__figure {
        translate: 0 31px;
      }
    }
  `,
})
export class IdentityAuthMascotComponent {
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);

  protected readonly brand = isAuthMascotVisible(this.environment.authLayout)
    ? resolveAuthBrand(this.environment.productName)
    : null;

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const zone = inject(NgZone);
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const column = host.parentElement?.querySelector<HTMLElement>(':scope > .section__column--form');

      if (!this.brand || !column) {
        return;
      }

      // Away while the column scrolls and its end (within a pixel or two of rounding) is not reached.
      const update = () => {
        const scrolls = column.scrollHeight - column.clientHeight > 2;
        const atEnd = column.scrollHeight - column.clientHeight - column.scrollTop <= 2;

        host.classList.toggle('identity-auth-mascot--away', scrolls && !atEnd);
      };
      // The column's size and its content's (a narrower window, a message above the form) change
      // whether it scrolls at all.
      const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;

      zone.runOutsideAngular(() => {
        column.addEventListener('scroll', update, { passive: true });
        resizeObserver?.observe(column);
        Array.from(column.children).forEach((child) => resizeObserver?.observe(child));
      });
      update();

      destroyRef.onDestroy(() => {
        column.removeEventListener('scroll', update);
        resizeObserver?.disconnect();
      });
    });
  }
}
