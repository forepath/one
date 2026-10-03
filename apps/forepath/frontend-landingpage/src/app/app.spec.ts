import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ENVIRONMENT, environment } from '@forepath/forepath/frontend/util-configuration';
import { createCookieConsentConfig } from '@forepath/shared/frontend/util-cookie-consent';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: ENVIRONMENT, useValue: environment },
        provideNgcCookieConsent(createCookieConsentConfig(environment)),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
