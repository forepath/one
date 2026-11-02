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
  let authService: { lockUser: jest.Mock; unlockUser: jest.Mock; deleteUser: jest.Mock };

  beforeEach(async () => {
    facade = {
      users$: new BehaviorSubject([
        user('self', 'admin@example.com', { role: 'admin' }),
        user('u-1', 'ann@example.com'),
        user('u-2', 'bob@example.com'),
        user('u-3', 'cat@example.com', { lockedAt: '2026-10-02T10:00:00.000Z' }),
      ]),
      user$: new BehaviorSubject({ id: 'self', email: 'admin@example.com', role: 'admin' }),
      usersLoading$: new BehaviorSubject(false),
      usersError$: new BehaviorSubject(null),
      creatingUser$: new BehaviorSubject(false),
      updatingUser$: new BehaviorSubject(false),
      deletingUser$: new BehaviorSubject(false),
      lockingUser$: new BehaviorSubject(false),
      unlockingUser$: new BehaviorSubject(false),
      loadUsers: jest.fn(),
    };
    authService = {
      lockUser: jest.fn((id: string) =>
        id === 'u-2' ? throwError(() => new HttpErrorResponse({ status: 403 })) : of({}),
      ),
      unlockUser: jest.fn(() => of({})),
      deleteUser: jest.fn(() => of(undefined)),
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
});
