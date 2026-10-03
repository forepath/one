/// <reference types="@angular/localize" />
import type { BaseEnvironment } from '@forepath/shared/frontend/util-configuration';
import { NgcCookieConsentConfig } from 'ngx-cookieconsent';

export function createCookieConsentConfig(environment: BaseEnvironment): NgcCookieConsentConfig {
  return {
    cookie: {
      domain: environment.cookieConsent.domain,
    },
    position: 'bottom-left',
    theme: 'classic',
    palette: {
      popup: {
        background: 'var(--bs-dark)',
      },
      button: {
        background: 'var(--bs-primary)',
        text: 'var(--bs-white)',
      },
    },
    type: 'opt-in',
    animateRevokable: false,
    revokeBtn:
      '<div class="cc-revoke {{classes}}" role="button" tabindex="0" aria-label="{{policy}}"><i class="bi bi-cookie" aria-hidden="true"></i></div>',
    content: {
      message: $localize`:@@utilCookieConsent-message:This website uses cookies to ensure you get the best experience on our website.`,
      dismiss: $localize`:@@utilCookieConsent-dismiss:Got it!`,
      allow: $localize`:@@utilCookieConsent-allow:Accept`,
      deny: $localize`:@@utilCookieConsent-deny:Decline`,
      link: $localize`:@@utilCookieConsent-link:Learn more`,
      policy: $localize`:@@utilCookieConsent-policy:Cookie Policy`,
      href: environment.cookieConsent.urls.privacyPolicy,
    },
  };
}
