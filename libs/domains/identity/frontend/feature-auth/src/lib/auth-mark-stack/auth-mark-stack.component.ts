import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  IDENTITY_AUTH_ENVIRONMENT,
  isAuthMarkStackVisible,
  type IdentityAuthEnvironment,
} from '@forepath/identity/frontend';
import { SharedMarkStackComponent } from '@forepath/shared/frontend/feature-landingpage';

import { resolveAuthBrand } from '../auth-brand/auth-brand';

/**
 * The product's brand mark stack on the public auth pages, as on the landing heroes: running off the
 * top-right corner of the form column (the page's right side), leaning towards the pointer over the
 * page, at the heroes' own sizes (the large stack from lg up, the compact corner emblem below). Hidden
 * with `authentication.layout.showMarkStack: false`, like the character.
 *
 * Place it as the first child of the `fpc-section-row` marked `data-mark-stack-area`. It is positioned
 * on the row (which does not scroll, and clips it), so it stays in the corner while the form scrolls;
 * the form column is lifted above it.
 */
@Component({
  selector: 'identity-auth-mark-stack',
  standalone: true,
  imports: [SharedMarkStackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    @if (brand) {
      <shared-mark-stack [brand]="brand" class="identity-auth-mark-stack" />
    }
  `,
  styles: `
    // No box of its own: the stack is positioned on the row.
    :host {
      display: contents;
    }

    // The row holds (and clips) the stack; the form column is lifted above it, so the form stays on top.
    ::ng-deep fpc-section-row:has(> identity-auth-mark-stack .identity-auth-mark-stack) {
      position: relative;

      > .section__column--form {
        position: relative;
        z-index: 1;
      }
    }
  `,
})
export class IdentityAuthMarkStackComponent {
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);

  protected readonly brand = isAuthMarkStackVisible(this.environment.authLayout)
    ? resolveAuthBrand(this.environment.productName)
    : null;
}
