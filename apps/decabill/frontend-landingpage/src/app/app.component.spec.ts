import { TestBed } from '@angular/core/testing';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideNgcCookieConsent({
          cookie: {
            domain: 'localhost',
          },
          position: 'bottom',
          theme: 'classic',
          type: 'opt-in',
        }),
      ],
    }).compileComponents();
  });

  it(`should have as title 'frontend-portal'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    expect(app.title).toEqual('frontend-portal');
  });
});
