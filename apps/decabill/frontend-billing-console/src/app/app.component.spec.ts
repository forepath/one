import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT, environment } from '@forepath/shared/frontend/util-configuration';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: ENVIRONMENT, useValue: environment },
        ...(environment.cookieConsent.enabled
          ? [
              provideNgcCookieConsent({
                cookie: {
                  domain: 'localhost',
                },
                position: 'bottom',
                theme: 'classic',
                type: 'opt-in',
              }),
            ]
          : []),
      ],
    }).compileComponents();
  });

  it(`should have as title 'frontend-billing-console'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    expect(app.title).toEqual('frontend-billing-console');
  });
});
