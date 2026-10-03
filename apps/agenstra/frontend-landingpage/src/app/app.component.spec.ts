import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT, environment } from '@forepath/agenstra/frontend/util-configuration';
import { createCookieConsentConfig } from '@forepath/shared/frontend/util-cookie-consent';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: ENVIRONMENT, useValue: environment },
        provideNgcCookieConsent(createCookieConsentConfig(environment)),
      ],
    }).compileComponents();
  });

  it(`should have as title 'frontend-portal'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    expect(app.title).toEqual('frontend-portal');
  });
});
