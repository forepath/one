/// <reference types="@angular/localize" />
import { environment } from '@forepath/shared/frontend/util-configuration';
import { NgcCookieConsentConfig } from 'ngx-cookieconsent';

export const cookieConfig: NgcCookieConsentConfig = {
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
  content: {
    message: $localize`:@@utilCookieConsent-message:This website uses cookies to ensure you get the best experience on our website.`,
    dismiss: $localize`:@@utilCookieConsent-dismiss:Got it!`,
    allow: $localize`:@@utilCookieConsent-allow:Accept`,
    deny: $localize`:@@utilCookieConsent-deny:Decline`,
    link: $localize`:@@utilCookieConsent-link:Learn more`,
    href: environment.cookieConsent.privacyPolicyUrl,
  },
};
