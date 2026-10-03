import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

import { environment } from '../docs-environment';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: ENVIRONMENT, useValue: environment },
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

  it(`should have as title 'frontend-docs'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    expect(app.title).toEqual('frontend-docs');
  });
});
