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
