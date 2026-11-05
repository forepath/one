import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import {
  AuthenticationFacade,
  AuthService,
  IDENTITY_AUTH_ENVIRONMENT,
  type AppAuthorizationInfoDto,
} from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

// eslint-disable-next-line @nx/enforce-module-boundaries
import { createMockIdentityAuthEnvironment } from '../../../../util-auth/src/lib/auth-environment.test-fixtures';

import { APP_AUTHORIZE_NAVIGATOR, IdentityAppAuthorizeComponent } from './app-authorize.component';

const APP_ID = '0d38bd98-a21e-4da7-89e0-d997b466e31c';

function info(overrides: Partial<AppAuthorizationInfoDto> = {}): AppAuthorizationInfoDto {
  return {
    app: { id: APP_ID, name: 'Ticket Sync', description: 'Syncs tickets', returnUrl: 'https://app.example.com/cb' },
    grantableScopes: ['tickets:read'],
    ungrantableScopes: ['users:admin'],
    alreadyAuthorized: false,
    secondFactor: null,
    ...overrides,
  };
}

describe('IdentityAppAuthorizeComponent', () => {
  let fixture: ComponentFixture<IdentityAppAuthorizeComponent>;
  let authService: { getAppAuthorization: jest.Mock; decideAppAuthorization: jest.Mock };
  let assign: jest.SpyInstance;
  const setup = async (query: Record<string, string>, response = of(info())) => {
    authService = {
      getAppAuthorization: jest.fn().mockReturnValue(response),
      decideAppAuthorization: jest
        .fn()
        .mockReturnValue(of({ redirectUrl: 'https://app.example.com/cb?status=approved&code=fp_apc_x' })),
    };
    assign = jest.spyOn(APP_AUTHORIZE_NAVIGATOR, 'assign').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [IdentityAppAuthorizeComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: AuthenticationFacade,
          useValue: { user$: of({ email: 'me@example.com' }), checkAuthentication: jest.fn() },
        },
        { provide: IDENTITY_AUTH_ENVIRONMENT, useValue: createMockIdentityAuthEnvironment() },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityAppAuthorizeComponent);
    fixture.detectChanges();
  };

  afterEach(() => {
    assign.mockRestore();
    TestBed.resetTestingModule();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const click = (testId: string) =>
    (el().querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement).click();

  it('shows the app name, description, grantable and not grantable scopes', async () => {
    await setup({ app_id: APP_ID, state: 'xyz' });

    expect(authService.getAppAuthorization).toHaveBeenCalledWith({
      app_id: APP_ID,
      state: 'xyz',
      code_challenge: undefined,
      code_challenge_method: undefined,
    });
    expect(el().querySelector('[data-testid="app-authorize-name"]')?.textContent).toContain('Ticket Sync');
    expect(el().querySelector('[data-testid="app-authorize-description"]')?.textContent).toContain('Syncs tickets');
    expect(el().querySelector('[data-testid="app-authorize-scopes"]')?.textContent).toContain('tickets:read');
    expect(el().querySelector('[data-testid="app-authorize-ungrantable"]')?.textContent).toContain('users:admin');
    expect(el().textContent).toContain('app.example.com');
  });

  it('rejects links without a valid app id', async () => {
    await setup({ app_id: 'nope' });

    expect(authService.getAppAuthorization).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="app-authorize-fatal"]')).not.toBeNull();
  });

  it('approves, forwards state and sends the user to the app', async () => {
    await setup({ app_id: APP_ID, state: 'xyz' });

    click('app-authorize-approve');

    expect(authService.decideAppAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP_ID, decision: 'approve', state: 'xyz' }),
    );
    expect(assign).toHaveBeenCalledWith('https://app.example.com/cb?status=approved&code=fp_apc_x');
  });

  it('denies and returns to the app', async () => {
    await setup({ app_id: APP_ID });
    authService.decideAppAuthorization.mockReturnValue(
      of({ redirectUrl: 'https://app.example.com/cb?status=denied&error=access_denied' }),
    );

    click('app-authorize-deny');

    expect(authService.decideAppAuthorization).toHaveBeenCalledWith(expect.objectContaining({ decision: 'deny' }));
    expect(assign).toHaveBeenCalledWith('https://app.example.com/cb?status=denied&error=access_denied');
  });

  it('skips consent for an up-to-date authorization', async () => {
    await setup({ app_id: APP_ID }, of(info({ alreadyAuthorized: true })));

    expect(authService.decideAppAuthorization).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approve' }));
    expect(assign).toHaveBeenCalled();
  });

  it('asks for the emailed code after the first approve and sends it with the next one', async () => {
    await setup({ app_id: APP_ID }, of(info({ secondFactor: 'email' })));
    authService.decideAppAuthorization.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            error: { code: 'APP_AUTHORIZATION_2FA_REQUIRED', method: 'email' },
          }),
      ),
    );

    click('app-authorize-approve');
    fixture.detectChanges();

    expect(assign).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="app-authorize-2fa"]')).not.toBeNull();

    fixture.componentInstance.code.set('ABC123');
    fixture.detectChanges();
    click('app-authorize-approve');

    expect(authService.decideAppAuthorization).toHaveBeenLastCalledWith(
      expect.objectContaining({ decision: 'approve', code: 'ABC123' }),
    );
    expect(assign).toHaveBeenCalled();
  });

  it('requires the authenticator code before approving', async () => {
    await setup({ app_id: APP_ID }, of(info({ secondFactor: 'totp' })));

    expect(el().querySelector('[data-testid="app-authorize-2fa"]')).not.toBeNull();
    expect(fixture.componentInstance.canApprove()).toBe(false);

    fixture.componentInstance.code.set('123456');

    expect(fixture.componentInstance.canApprove()).toBe(true);
  });

  it('never leaves for an origin other than the registered return URL', async () => {
    await setup({ app_id: APP_ID });
    authService.decideAppAuthorization.mockReturnValue(of({ redirectUrl: 'https://evil.example.net/cb' }));

    click('app-authorize-approve');
    fixture.detectChanges();

    expect(assign).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="app-authorize-error"]')).not.toBeNull();
  });
});
