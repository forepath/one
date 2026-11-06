import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  AuthenticationFacade,
  createMockIdentityAuthEnvironment,
  IDENTITY_AUTH_ENVIRONMENT,
} from '@forepath/identity/frontend';
import { Actions } from '@ngrx/effects';
import { of } from 'rxjs';

import { IdentityLoginComponent } from './login.component';

describe('IdentityLoginComponent', () => {
  let component: IdentityLoginComponent;
  let fixture: ComponentFixture<IdentityLoginComponent>;
  let mockAuthFacade: jest.Mocked<Partial<AuthenticationFacade>>;
  let mockEnvironment: IdentityAuthEnvironment;

  beforeEach(async () => {
    mockAuthFacade = {
      loading$: of(false),
      error$: of(null),
      login: jest.fn(),
      clearError: jest.fn(),
    };

    mockEnvironment = createMockIdentityAuthEnvironment({
      controllerApiUrl: 'http://localhost:3100/api',
    });

    await TestBed.configureTestingModule({
      imports: [
        IdentityLoginComponent,
        ReactiveFormsModule,
        RouterModule.forRoot([{ path: 'login', component: IdentityLoginComponent }]),
      ],
      providers: [
        FormBuilder,
        { provide: AuthenticationFacade, useValue: mockAuthFacade },
        { provide: IDENTITY_AUTH_ENVIRONMENT, useValue: mockEnvironment },
        { provide: Actions, useValue: of() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityLoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('when authentication type is api-key', () => {
    it('should show API key form', () => {
      expect(component.isApiKeyAuth).toBe(true);
      expect(component.isUsersAuth).toBe(false);
      expect(component.loginForm.contains('apiKey')).toBe(true);
      expect(component.loginForm.contains('email')).toBe(false);
    });

    it('should call login with API key on submit', () => {
      component.loginForm.patchValue({ apiKey: 'test-api-key' });
      component.onSubmit();

      expect(mockAuthFacade.login).toHaveBeenCalledWith('test-api-key');
    });

    it('should show apiBaseHostname when controllerApiUrl is provided', () => {
      expect(component.showApiBaseHostname).toBe(true);
      expect(component.apiBaseHostname).toBe('localhost:3100');
    });

    it('should hide apiBaseHostname when controllerApiUrl is not provided', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [
          IdentityLoginComponent,
          ReactiveFormsModule,
          RouterModule.forRoot([{ path: 'login', component: IdentityLoginComponent }]),
        ],
        providers: [
          FormBuilder,
          { provide: AuthenticationFacade, useValue: mockAuthFacade },
          {
            provide: IDENTITY_AUTH_ENVIRONMENT,
            useValue: createMockIdentityAuthEnvironment(),
          },
          { provide: Actions, useValue: of() },
        ],
      }).compileComponents();

      const f = TestBed.createComponent(IdentityLoginComponent);
      const c = f.componentInstance;

      f.detectChanges();

      expect(c.showApiBaseHostname).toBe(false);
      expect(c.apiBaseHostname).toBe('');
    });
  });

  describe('when authentication type is mtls', () => {
    let loginWithCertificate: jest.Mock;

    beforeEach(async () => {
      loginWithCertificate = jest.fn();
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [
          IdentityLoginComponent,
          ReactiveFormsModule,
          RouterModule.forRoot([{ path: 'login', component: IdentityLoginComponent }]),
        ],
        providers: [
          FormBuilder,
          { provide: AuthenticationFacade, useValue: { ...mockAuthFacade, loginWithCertificate } },
          {
            provide: IDENTITY_AUTH_ENVIRONMENT,
            useValue: { ...mockEnvironment, authentication: { type: 'mtls' } },
          },
          { provide: Actions, useValue: of() },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(IdentityLoginComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    const selectFile = (inputId: string, file: File | null) => {
      const input = fixture.nativeElement.querySelector(`#${inputId}`) as HTMLInputElement;

      Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };

    it('asks for a certificate file (and an optional key file) instead of an API key', () => {
      const element: HTMLElement = fixture.nativeElement;

      expect(component.isMtlsAuth).toBe(true);
      expect(component.isApiKeyAuth).toBe(false);
      expect(component.loginForm.contains('apiKey')).toBe(false);
      expect(element.querySelector('#apiKey')).toBeNull();
      expect(element.querySelector('#clientCertificate')?.getAttribute('type')).toBe('file');
      expect(element.querySelector('#clientPrivateKey')?.getAttribute('type')).toBe('file');
      expect(element.querySelector('#clientCertificate-hint')).not.toBeNull();
      expect(component.showApiBaseHostname).toBe(true);
    });

    it('requires a certificate before submitting', () => {
      component.onSubmit();
      fixture.detectChanges();

      expect(loginWithCertificate).not.toHaveBeenCalled();
      expect(component.loginForm.get('certificate')?.touched).toBe(true);
      expect(fixture.nativeElement.querySelector('#clientCertificate').classList).toContain('is-invalid');
    });

    it('submits the selected certificate and private key files', () => {
      const certificate = new File(['cert'], 'client.pem');
      const privateKey = new File(['key'], 'client.key');

      selectFile('clientCertificate', certificate);
      component.onSubmit();

      expect(loginWithCertificate).toHaveBeenLastCalledWith(certificate, undefined);

      selectFile('clientPrivateKey', privateKey);
      component.onSubmit();

      expect(loginWithCertificate).toHaveBeenLastCalledWith(certificate, privateKey);
      expect(mockAuthFacade.login).not.toHaveBeenCalled();
    });

    it('clears the selection when the file dialog is cancelled', () => {
      selectFile('clientCertificate', new File(['cert'], 'client.pem'));
      selectFile('clientCertificate', null);

      expect(component.loginForm.get('certificate')?.value).toBeNull();
      expect(component.loginForm.valid).toBe(false);
    });
  });

  describe('when authentication type is users', () => {
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [
          IdentityLoginComponent,
          ReactiveFormsModule,
          RouterModule.forRoot([{ path: 'login', component: IdentityLoginComponent }]),
        ],
        providers: [
          FormBuilder,
          { provide: AuthenticationFacade, useValue: mockAuthFacade },
          {
            provide: IDENTITY_AUTH_ENVIRONMENT,
            useValue: {
              ...mockEnvironment,
              authentication: { type: 'users' },
            },
          },
          { provide: Actions, useValue: of() },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(IdentityLoginComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should show email and password form', () => {
      expect(component.isUsersAuth).toBe(true);
      expect(component.isApiKeyAuth).toBe(false);
      expect(component.loginForm.contains('email')).toBe(true);
      expect(component.loginForm.contains('password')).toBe(true);
      expect(component.loginForm.contains('apiKey')).toBe(false);
    });

    it('should call login with email and password on submit', () => {
      component.loginForm.patchValue({ email: 'test@example.com', password: 'password123' });
      component.onSubmit();

      expect(mockAuthFacade.login).toHaveBeenCalledWith(undefined, 'test@example.com', 'password123');
    });
  });
});
