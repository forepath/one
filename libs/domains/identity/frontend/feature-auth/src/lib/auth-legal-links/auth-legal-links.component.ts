import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IDENTITY_AUTH_ENVIRONMENT, type IdentityAuthEnvironment } from '@forepath/identity/frontend';

/**
 * The legal links directly below the public auth pages' card (login, registration, password reset,
 * the public withdrawal form and the like): the legal disclosure, the terms of service and the privacy
 * policy, each only when its URL is configured (`legalDisclosureUrl`, `termsUrl`, `privacyPolicyUrl` on
 * the auth environment; in the apps `cookieConsent.urls`). They open the product's legal pages in a new
 * tab, so a half-filled form stays put. Place it right after the card, in the form column.
 */
@Component({
  selector: 'identity-auth-legal-links',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (disclosureUrl || termsUrl || privacyPolicyUrl) {
      <nav class="identity-auth-legal-links" i18n-aria-label="@@identityAuthLegalLinks-label" aria-label="Legal">
        @if (disclosureUrl) {
          <a [href]="disclosureUrl" target="_blank" rel="noopener" i18n="@@identityAuthLegalLinks-disclosure"
            >Legal Disclosure</a
          >
        }
        @if (termsUrl) {
          <a [href]="termsUrl" target="_blank" rel="noopener" i18n="@@identityAuthLegalLinks-terms">Terms of Service</a>
        }
        @if (privacyPolicyUrl) {
          <a [href]="privacyPolicyUrl" target="_blank" rel="noopener" i18n="@@identityAuthLegalLinks-privacy"
            >Privacy Policy</a
          >
        }
      </nav>
    }
  `,
  styles: `
    // As wide as the card above it (the pages size the card, at most its column), the links centred
    // in one quiet row that wraps on narrow screens.
    :host {
      display: block;
      width: 100%;
      margin-top: 1rem;
    }

    // Styled like the landing footers' links (.footer-link): the emphasis ink at 85%, the brand colour
    // on hover, never underlined; small like Bootstrap's small (0.875em of the page text, as the card's
    // own links).
    .identity-auth-legal-links {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.25rem 1.25rem;
      font-size: 0.875em;

      a {
        color: rgba(var(--bs-emphasis-color-rgb), 0.85);
        text-decoration: none;
        transition: color 0.15s ease-in-out;

        &:hover,
        &:focus-visible {
          color: var(--bs-primary);
        }
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .identity-auth-legal-links a {
        transition: none;
      }
    }
  `,
})
export class IdentityAuthLegalLinksComponent {
  private readonly environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);

  protected readonly disclosureUrl = this.environment.legalDisclosureUrl;
  protected readonly termsUrl = this.environment.termsUrl;
  protected readonly privacyPolicyUrl = this.environment.privacyPolicyUrl;
}
