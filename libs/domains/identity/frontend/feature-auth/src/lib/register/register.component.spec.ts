import { TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  AuthenticationFacade,
  AuthService,
  createMockIdentityAuthEnvironment,
  IDENTITY_AUTH_ENVIRONMENT,
} from '@forepath/identity/frontend';
import { Actions } from '@ngrx/effects';
import { of, throwError, type Observable } from 'rxjs';

import { IdentityRegisterComponent } from './register.component';

describe('IdentityRegisterComponent admin claim', () => {
  let facade: { register: jest.Mock; clearError: jest.Mock; clearSuccessMessage: jest.Mock } & Record<string, unknown>;
  let authService: { getAdminClaimStatus: jest.Mock };

  async function create(env: Partial<IdentityAuthEnvironment>, status?: Observable<{ claimRequired: boolean }>) {
    facade = {
      registering$: of(false),
      error$: of(null),
      successMessage$: of(null),
      register: jest.fn(),
      clearError: jest.fn(),
      clearSuccessMessage: jest.fn(),
    };
    authService = { getAdminClaimStatus: jest.fn().mockReturnValue(status ?? of({ claimRequired: false })) };

    await TestBed.configureTestingModule({
      imports: [IdentityRegisterComponent, RouterModule.forRoot([])],
      providers: [
        { provide: AuthenticationFacade, useValue: facade },
        { provide: AuthService, useValue: authService },
        {
          provide: IDENTITY_AUTH_ENVIRONMENT,
          useValue: createMockIdentityAuthEnvironment({ authentication: { type: 'users' }, ...env }),
        },
        { provide: Actions, useValue: of() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(IdentityRegisterComponent);

    fixture.detectChanges();

    return fixture;
  }

  function fill(component: IdentityRegisterComponent, token = ''): void {
    component.registerForm.patchValue({
      email: 'admin@example.com',
      password: 'password123',
      passwordConfirmation: 'password123',
      adminClaimToken: token,
    });
  }

  afterEach(() => TestBed.resetTestingModule());

  it('does not ask for a claim without adminClaimStatusUrl (unchanged default)', async () => {
    const fixture = await create({});

    expect(authService.getAdminClaimStatus).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#adminClaimToken')).toBeNull();

    fill(fixture.componentInstance);
    fixture.componentInstance.onSubmit();
    expect(facade.register).toHaveBeenCalledWith('admin@example.com', 'password123');
  });

  it('shows a required claim-token field while the API requires a claim', async () => {
    const fixture = await create(
      { adminClaimStatusUrl: 'https://lw.example.com/api/install/claim-status' },
      of({ claimRequired: true }),
    );
    const component = fixture.componentInstance;

    fixture.detectChanges();
    expect(authService.getAdminClaimStatus).toHaveBeenCalledWith('https://lw.example.com/api/install/claim-status');
    expect(fixture.nativeElement.querySelector('#adminClaimToken')).not.toBeNull();

    fill(component);
    expect(component.registerForm.valid).toBe(false);

    fill(component, '  lwc_token  ');
    component.onSubmit();
    expect(facade.register).toHaveBeenCalledWith('admin@example.com', 'password123', 'lwc_token');
  });

  it('hides the field when no claim is required or the status is unavailable', async () => {
    const fixture = await create(
      { adminClaimStatusUrl: 'https://lw.example.com/api/install/claim-status' },
      throwError(() => new Error('offline')),
    );

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#adminClaimToken')).toBeNull();

    fill(fixture.componentInstance, 'ignored');
    fixture.componentInstance.onSubmit();
    expect(facade.register).toHaveBeenCalledWith('admin@example.com', 'password123');
  });
});
