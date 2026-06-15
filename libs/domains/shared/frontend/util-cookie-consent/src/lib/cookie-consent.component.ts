import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { NgcCookieConsentService } from 'ngx-cookieconsent';
import { Subscription } from 'rxjs';

import { cookieConfig } from './cookie-consent.config';

@Component({
  selector: 'framework-cookie-consent',
  imports: [CommonModule],
  template: ``,
  standalone: true,
})
export class CookieConsentComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cookieConsentService = inject(NgcCookieConsentService);
  private subscriptions = new Subscription();

  ngOnInit(): void {
    // Ensure cookie consent initializes on client side after hydration
    if (isPlatformBrowser(this.platformId)) {
      // Subscribe to service observables to trigger our callbacks
      this.setupCallbacks();
      // Wait for DOM to be ready and ensure script is loaded
      this.ensureCookieConsentInitialized();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private setupCallbacks(): void {
    // Subscribe to initializing$ to trigger our onInitialise callback
    // This fires when cookie consent initializes with the current status
    const initializingSub = this.cookieConsentService.initializing$.subscribe((event) => {
      this.sendConsentEvent(event.status);
    });

    this.subscriptions.add(initializingSub);

    // Subscribe to initialized$ to send initial consent status when service is ready
    // This ensures we send the event even if initialization happened before we subscribed
    const initializedSub = this.cookieConsentService.initialized$.subscribe(() => {
      // Service is now initialized, check current status and send event
      try {
        const status = this.cookieConsentService.getStatus();

        // Convert status object to string
        if (status.allow) {
          this.sendConsentEvent('allow');
        } else if (status.deny) {
          this.sendConsentEvent('deny');
        } else if (status.dismiss) {
          this.sendConsentEvent('dismiss');
        }
      } catch {
        // Service not fully ready yet, will be handled by initializing$ or status check
      }
    });

    this.subscriptions.add(initializedSub);

    // Subscribe to statusChange$ to trigger our onStatusChange callback
    const statusChangeSub = this.cookieConsentService.statusChange$.subscribe((event) => {
      this.sendConsentEvent(event.status);
    });

    this.subscriptions.add(statusChangeSub);

    // Subscribe to revokeChoice$ to trigger our onRevokeChoice callback
    const revokeChoiceSub = this.cookieConsentService.revokeChoice$.subscribe(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;

      if (!win.dataLayer) {
        return;
      }

      win.dataLayer.push({ event: 'consent_revoked' });
    });

    this.subscriptions.add(revokeChoiceSub);

    // Subscribe to noCookieLaw$ to trigger our onNoCookieLaw callback
    const noCookieLawSub = this.cookieConsentService.noCookieLaw$.subscribe((event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;

      if (!win.dataLayer) {
        return;
      }

      win.dataLayer.push({ event: 'consent_no_cookie_law', countryCode: event.countryCode, country: event.country });
    });

    this.subscriptions.add(noCookieLawSub);
  }

  private ensureCookieConsentInitialized(): void {
    const checkCookieConsent = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;

      if (typeof window !== 'undefined' && win.cookieconsent) {
        try {
          const hasAnswered = this.cookieConsentService.hasAnswered();

          if (!hasAnswered) {
            setTimeout(() => {
              try {
                this.cookieConsentService.open();
              } catch {
                this.manualInitialize();
              }
            }, 100);
          } else {
            // User has already answered, send the current consent status
            this.sendCurrentConsentStatus();
          }
        } catch {
          this.manualInitialize();
        }
      } else {
        setTimeout(checkCookieConsent, 50);
      }
    };

    setTimeout(checkCookieConsent, 200);
  }

  private manualInitialize(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;

    if (typeof window !== 'undefined' && win.cookieconsent) {
      const cookieconsent = win.cookieconsent;

      // Manually initialize with our config that includes callbacks
      cookieconsent.initialise(cookieConfig);

      // After manual initialization, check status and send event
      setTimeout(() => {
        this.sendCurrentConsentStatus();
      }, 100);
    }
  }

  private sendConsentEvent(status: 'allow' | 'deny' | 'dismiss'): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;

    if (!win.dataLayer) {
      return;
    }

    if (status === 'allow') {
      win.dataLayer.push({ event: 'consent_given' });
    } else if (status === 'deny') {
      win.dataLayer.push({ event: 'consent_denied' });
    } else if (status === 'dismiss') {
      win.dataLayer.push({ event: 'consent_dismissed' });
    }
  }

  private sendCurrentConsentStatus(): void {
    try {
      if (this.cookieConsentService.hasAnswered()) {
        const status = this.cookieConsentService.hasConsented();

        if (status) {
          this.sendConsentEvent('allow');
        } else {
          this.sendConsentEvent('deny');
        }
      }
    } catch {
      // Service not ready yet, will be handled by observables
    }
  }
}
