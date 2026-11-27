import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { CookieConsentComponent } from '@forepath/shared/frontend/util-cookie-consent';

@Component({
  imports: [RouterModule, CookieConsentComponent],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'frontend-billing-console';
  protected readonly showCookieConsent = inject(ENVIRONMENT).cookieConsent.enabled;
}
