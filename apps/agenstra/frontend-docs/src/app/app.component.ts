import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CookieConsentComponent } from '@forepath/shared/frontend/util-cookie-consent';

@Component({
  imports: [RouterModule, CookieConsentComponent],
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'frontend-docs';
}
