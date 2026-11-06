import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { AuthService, LOGIN_SUCCESS_REDIRECT_TARGET } from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

// eslint-disable-next-line @nx/enforce-module-boundaries
import { SAML_CODE_VERIFIER_STORAGE_KEY, USERS_JWT_STORAGE_KEY } from '../../../../util-auth/src';

import { IdentitySamlCallbackComponent } from './saml-callback.component';

describe('IdentitySamlCallbackComponent', () => {
  let router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
  let authService: { exchangeSamlCode: jest.Mock };

  function create(query: Record<string, string>) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IdentitySamlCallbackComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: authService },
        { provide: LOGIN_SUCCESS_REDIRECT_TARGET, useValue: ['/dashboard'] },
      ],
    }).overrideComponent(IdentitySamlCallbackComponent, { set: { imports: [], template: '' } });

    const fixture = TestBed.createComponent(IdentitySamlCallbackComponent);

    fixture.detectChanges();

    return fixture.componentInstance;
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    router = { navigate: jest.fn().mockResolvedValue(true), navigateByUrl: jest.fn().mockResolvedValue(true) };
    authService = { exchangeSamlCode: jest.fn().mockReturnValue(of({ access_token: 'session-jwt' })) };
  });

  it('exchanges the code with the stored verifier, stores the session and continues to the redirect path', () => {
    sessionStorage.setItem(SAML_CODE_VERIFIER_STORAGE_KEY, 'verifier');

    const component = create({ code: 'one-time', redirect: '/clients/7' });

    expect(authService.exchangeSamlCode).toHaveBeenCalledWith('one-time', 'verifier');
    expect(localStorage.getItem(USERS_JWT_STORAGE_KEY)).toBe('session-jwt');
    expect(sessionStorage.getItem(SAML_CODE_VERIFIER_STORAGE_KEY)).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/clients/7', { replaceUrl: true });
    expect(component.state()).toBe('exchanging');
  });

  it('falls back to the default target for unsafe redirect paths', () => {
    sessionStorage.setItem(SAML_CODE_VERIFIER_STORAGE_KEY, 'verifier');

    create({ code: 'one-time', redirect: '//evil.example' });

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { replaceUrl: true });
  });

  it('shows the failure state for an error callback and drops the verifier', () => {
    sessionStorage.setItem(SAML_CODE_VERIFIER_STORAGE_KEY, 'verifier');

    const component = create({ error: 'saml_failed' });

    expect(component.state()).toBe('failed');
    expect(authService.exchangeSamlCode).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(SAML_CODE_VERIFIER_STORAGE_KEY)).toBeNull();
  });

  it('fails without a verifier (callback not started in this tab)', () => {
    const component = create({ code: 'one-time' });

    expect(component.state()).toBe('failed');
    expect(authService.exchangeSamlCode).not.toHaveBeenCalled();
  });

  it('fails when the exchange is rejected', () => {
    sessionStorage.setItem(SAML_CODE_VERIFIER_STORAGE_KEY, 'verifier');
    authService.exchangeSamlCode.mockReturnValue(throwError(() => new Error('400')));

    const component = create({ code: 'one-time' });

    expect(component.state()).toBe('failed');
    expect(localStorage.getItem(USERS_JWT_STORAGE_KEY)).toBeNull();
  });
});
