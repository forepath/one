import { DOCUMENT } from '@angular/common';
import { LOCALE_ID, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { blogLocaleGuard } from './blog-locale.guard';

describe('blogLocaleGuard', () => {
  const replace = jest.fn();

  function runGuard(options: { production: boolean; locale: string; platform?: string }, url = '/blog/my-post?x=1') {
    TestBed.configureTestingModule({
      providers: [
        { provide: ENVIRONMENT, useValue: { application: { production: options.production } } },
        { provide: LOCALE_ID, useValue: options.locale },
        { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
        { provide: DOCUMENT, useValue: { location: { replace } } },
      ],
    });

    return TestBed.runInInjectionContext(() =>
      blogLocaleGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
  }

  afterEach(() => {
    replace.mockReset();
    TestBed.resetTestingModule();
  });

  it('reloads the English variant for non-English locales in production', () => {
    expect(runGuard({ production: true, locale: 'de' })).toBe(false);
    expect(replace).toHaveBeenCalledWith('/en/blog/my-post?x=1');
  });

  it('allows the English locale', () => {
    expect(runGuard({ production: true, locale: 'en' })).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it('allows any locale outside production', () => {
    expect(runGuard({ production: false, locale: 'de' })).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it('allows server-side rendering', () => {
    expect(runGuard({ production: true, locale: 'de', platform: 'server' })).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });
});
