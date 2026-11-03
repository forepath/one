import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AuthService,
  PersonalAccessTokensFacade,
  type PersonalAccessTokenResponseDto,
} from '@forepath/identity/frontend';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { IdentityTokenManagerComponent } from './token-manager.component';

function token(id: string, name: string, overrides: Partial<PersonalAccessTokenResponseDto> = {}) {
  return {
    id,
    name,
    tokenPrefix: 'pat_',
    scopes: ['agents:read'],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  } satisfies PersonalAccessTokenResponseDto;
}

describe('IdentityTokenManagerComponent', () => {
  let fixture: ComponentFixture<IdentityTokenManagerComponent>;
  let facade: Record<string, unknown>;
  let authService: { revokePersonalAccessToken: jest.Mock };

  beforeEach(async () => {
    facade = {
      tokens$: new BehaviorSubject([
        token('t-1', 'CI deploy'),
        token('t-2', 'Laptop'),
        token('t-3', 'Old', { expiresAt: '2020-01-01T00:00:00.000Z' }),
      ]),
      loading$: new BehaviorSubject(false),
      error$: new BehaviorSubject(null),
      saving$: new BehaviorSubject(false),
      revoking$: new BehaviorSubject(false),
      scopes$: new BehaviorSubject([]),
      scopesLoading$: new BehaviorSubject(false),
      lastCreatedPlaintext$: new BehaviorSubject(null),
      load: jest.fn(),
      loadScopes: jest.fn(),
      clearCreatedPlaintext: jest.fn(),
    };
    authService = {
      revokePersonalAccessToken: jest.fn((id: string) =>
        id === 't-2' ? throwError(() => new HttpErrorResponse({ status: 403 })) : of(undefined),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [IdentityTokenManagerComponent],
      providers: [
        { provide: PersonalAccessTokensFacade, useValue: facade },
        { provide: AuthService, useValue: authService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityTokenManagerComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('renders the tokens as a table with a readable state and no raw ids', () => {
    const table = el().querySelector('[data-testid="token-manager-table"]');

    expect(table?.textContent).toContain('CI deploy');
    expect(table?.textContent).not.toContain('t-1');
    expect(fixture.componentInstance.columns[0].state?.(token('x', 'Old', { expiresAt: '2020-01-01' }))?.label).toBe(
      'Expired',
    );
  });

  it('revokes the selected tokens one by one and reports per-token results (incl. denied)', async () => {
    const component = fixture.componentInstance;

    component.selectedTokenIds.set(['t-1', 't-2']);
    await component.onConfirmBulkRevoke();

    expect(authService.revokePersonalAccessToken).toHaveBeenCalledTimes(2);
    expect(authService.revokePersonalAccessToken).toHaveBeenCalledWith('t-1');
    expect(authService.revokePersonalAccessToken).toHaveBeenCalledWith('t-2');
    expect(component.bulkResult()?.tone).toBe('warning');
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selectedTokenIds()).toEqual(['t-2']);
    expect(facade['load']).toHaveBeenCalledTimes(2);
  });
});
