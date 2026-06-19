import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { CookieConsentComponent } from '@forepath/shared/frontend/util-cookie-consent';

@Component({
  imports: [RouterModule, CookieConsentComponent],
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'frontend-billing-console';
  protected readonly showCookieConsent = inject(ENVIRONMENT).cookieConsent.enabled;
}
