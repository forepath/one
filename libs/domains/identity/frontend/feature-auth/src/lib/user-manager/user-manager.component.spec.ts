import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { AuthService, AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { provideMockActions } from '@ngrx/effects/testing';
import { BehaviorSubject, EMPTY, of, throwError } from 'rxjs';

import { IdentityUserManagerComponent } from './user-manager.component';

function user(id: string, email: string, overrides: Partial<UserResponseDto> = {}): UserResponseDto {
  return {
    id,
    email,
    role: 'user',
    emailConfirmedAt: '2026-10-01T10:00:00.000Z',
    lockedAt: null,
    totpEnabled: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('IdentityUserManagerComponent', () => {
  let fixture: ComponentFixture<IdentityUserManagerComponent>;
  let facade: Record<string, unknown>;
  let authService: { lockUser: jest.Mock; unlockUser: jest.Mock; deleteUser: jest.Mock; confirmUserEmail: jest.Mock };

  beforeEach(async () => {
    facade = {
      users$: new BehaviorSubject([
        user('self', 'admin@example.com', { role: 'admin' }),
        user('u-1', 'ann@example.com'),
        user('u-2', 'bob@example.com'),
        user('u-3', 'cat@example.com', { lockedAt: '2026-10-02T10:00:00.000Z' }),
        user('u-4', 'dan@example.com', { emailConfirmedAt: null }),
      ]),
      user$: new BehaviorSubject({ id: 'self', email: 'admin@example.com', role: 'admin' }),
      usersLoading$: new BehaviorSubject(false),
      usersError$: new BehaviorSubject(null),
      creatingUser$: new BehaviorSubject(false),
      updatingUser$: new BehaviorSubject(false),
      deletingUser$: new BehaviorSubject(false),
      lockingUser$: new BehaviorSubject(false),
      unlockingUser$: new BehaviorSubject(false),
      confirmingUserEmail$: new BehaviorSubject(false),
      loadUsers: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      confirmUserEmail: jest.fn(),
    };
    authService = {
      lockUser: jest.fn((id: string) =>
        id === 'u-2' ? throwError(() => new HttpErrorResponse({ status: 403 })) : of({}),
      ),
      unlockUser: jest.fn(() => of({})),
      deleteUser: jest.fn(() => of(undefined)),
      confirmUserEmail: jest.fn(() => of({})),
    };

    await TestBed.configureTestingModule({
      imports: [IdentityUserManagerComponent],
      providers: [
        provideMockActions(() => EMPTY),
        { provide: AuthenticationFacade, useValue: facade },
        { provide: AuthService, useValue: authService },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
        { provide: StandaloneLoadingService, useValue: { setLoading: jest.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityUserManagerComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('lists the other users as a table with readable state and role', () => {
    const table = el().querySelector('[data-testid="user-manager-table"]');

    expect(table?.textContent).toContain('ann@example.com');
    expect(table?.textContent).not.toContain('admin@example.com');
    expect(fixture.componentInstance.columns[0].state?.(user('x', 'x@example.com', { lockedAt: 'now' }))?.label).toBe(
      'Locked',
    );
  });

  it('locks the selected unlocked users one by one and reports per-user results (incl. denied)', async () => {
    const component = fixture.componentInstance;

    component.selectedUserIds.set(['u-1', 'u-2', 'u-3']);
    component.onBulkLock(true);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    // u-3 is already locked and is skipped.
    expect(authService.lockUser).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selectedUserIds()).toEqual(['u-2']);
  });

  describe('email confirmation', () => {
    it('offers "Confirm email" only for unconfirmed users and dispatches it', () => {
      const component = fixture.componentInstance;
      const unconfirmed = user('u-4', 'dan@example.com', { emailConfirmedAt: null });

      expect(component.userRowMenu(user('u-1', 'ann@example.com')).map((i) => i.id)).not.toContain('confirm-email');
      expect(component.userRowMenu(unconfirmed).map((i) => i.id)).toContain('confirm-email');

      component.onUserAction(unconfirmed, 'confirm-email');

      expect(facade['confirmUserEmail']).toHaveBeenCalledWith('u-4');
    });

    it('bulk-confirms only the unconfirmed selected users', async () => {
      const component = fixture.componentInstance;

      component.selectedUserIds.set(['u-1', 'u-4']);
      component.onBulkConfirmEmail();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));

      expect(authService.confirmUserEmail).toHaveBeenCalledTimes(1);
      expect(authService.confirmUserEmail).toHaveBeenCalledWith('u-4');
    });

    it('creates users with the default confirmation flow unless options change', () => {
      const component = fixture.componentInstance;

      component.onAddUser();
      component.createForm.email = ' new@example.com ';
      component.createForm.password = 'secret-pass';
      component.onSubmitCreateUser();

      expect(facade['createUser']).toHaveBeenLastCalledWith({
        email: 'new@example.com',
        password: 'secret-pass',
        role: 'user',
      });

      component.createForm.sendConfirmationEmail = false;
      component.onSubmitCreateUser();

      expect(facade['createUser']).toHaveBeenLastCalledWith(expect.objectContaining({ sendConfirmationEmail: false }));

      component.createForm.emailConfirmed = true;
      component.onSubmitCreateUser();

      const dto = (facade['createUser'] as jest.Mock).mock.lastCall[0];

      expect(dto.emailConfirmed).toBe(true);
      expect(dto).not.toHaveProperty('sendConfirmationEmail');
    });

    it('shows the create options and hides "send" when the email is pre-confirmed', async () => {
      const component = fixture.componentInstance;

      component.onAddUser();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(document.querySelector('[data-testid="create-user-email-confirmed"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="create-user-send-confirmation"]')).not.toBeNull();

      component.createForm.emailConfirmed = true;
      fixture.detectChanges();

      expect(document.querySelector('[data-testid="create-user-send-confirmation"]')).toBeNull();
    });

    it('sends edit confirmation options only when the email changes', () => {
      const component = fixture.componentInstance;

      component.onEditUser(user('u-1', 'ann@example.com'));
      component.editForm.emailConfirmed = true;
      component.editForm.email = 'ANN@example.com';
      component.onSubmitEditUser();

      expect((facade['updateUser'] as jest.Mock).mock.lastCall[1]).not.toHaveProperty('emailConfirmed');

      component.editForm.email = 'ann.new@example.com';
      component.onSubmitEditUser();

      expect(facade['updateUser']).toHaveBeenLastCalledWith(
        'u-1',
        expect.objectContaining({ email: 'ann.new@example.com', emailConfirmed: true }),
      );
    });
  });
});
