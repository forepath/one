import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AuthService,
  IdentityAppsFacade,
  PersonalAccessTokensFacade,
  type IdentityAppResponseDto,
} from '@forepath/identity/frontend';
import { provideMockActions } from '@ngrx/effects/testing';
import { BehaviorSubject, Subject } from 'rxjs';

import { IdentityAppManagerComponent, isValidAppReturnUrl } from './app-manager.component';

const app = (id: string, name: string): IdentityAppResponseDto => ({
  id,
  name,
  description: 'Syncs tickets',
  returnUrl: 'https://app.example.com/cb',
  scopes: ['tickets:read', 'tickets:write'],
  secretPrefix: 'fp_aps_abcdefgh',
  secretRotatedAt: null,
  grantCount: 3,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
});

describe('IdentityAppManagerComponent', () => {
  let fixture: ComponentFixture<IdentityAppManagerComponent>;
  let facade: Record<string, unknown>;
  let actions$: Subject<unknown>;

  beforeEach(async () => {
    actions$ = new Subject();
    facade = {
      apps$: new BehaviorSubject([app('a1', 'Ticket Sync'), app('a2', 'Billing Export')]),
      loading$: new BehaviorSubject(false),
      saving$: new BehaviorSubject(false),
      deleting$: new BehaviorSubject(false),
      error$: new BehaviorSubject(null),
      lastSecret$: new BehaviorSubject(null),
      grants$: new BehaviorSubject([]),
      grantsLoading$: new BehaviorSubject(false),
      grantsRevoking$: new BehaviorSubject(false),
      grantsError$: new BehaviorSubject(null),
      load: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      clearError: jest.fn(),
      clearSecret: jest.fn(),
      loadGrants: jest.fn(),
      revokeGrant: jest.fn(),
      revokeAllGrants: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [IdentityAppManagerComponent],
      providers: [
        { provide: IdentityAppsFacade, useValue: facade },
        {
          provide: PersonalAccessTokensFacade,
          useValue: {
            scopes$: new BehaviorSubject([{ scope: 'tickets:read' }, { scope: 'users:admin' }]),
            scopesLoading$: new BehaviorSubject(false),
            loadScopes: jest.fn(),
          },
        },
        { provide: AuthService, useValue: { deleteApp: jest.fn() } },
        provideMockActions(() => actions$),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityAppManagerComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('loads and lists apps', () => {
    expect(facade['load']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="app-manager-table"]')?.textContent).toContain('Ticket Sync');
    expect(el().textContent).not.toContain('fp_aps_');
  });

  it('creates an app with trimmed values once the form is valid', () => {
    const component = fixture.componentInstance;

    component.onAddApp();
    component.form = {
      name: ' New ',
      description: '',
      returnUrl: 'http://evil.example.com/cb',
      scopes: ['tickets:read'],
    };
    expect(component.isFormValid()).toBe(false);

    component.form.returnUrl = 'https://app.example.com/cb';
    component.onSubmitForm();

    expect(facade['create']).toHaveBeenCalledWith({
      name: 'New',
      returnUrl: 'https://app.example.com/cb',
      scopes: ['tickets:read'],
    });
  });

  it('selects all visible scopes from the header, honours the search and keeps the counter on all scopes', () => {
    const component = fixture.componentInstance;
    const counter = () =>
      [...document.querySelectorAll('.scope-picker__header span')].map((node) => node.textContent?.trim()).join('');
    const selectAll = () => document.querySelector('[data-testid="app-scope-all"]') as HTMLInputElement;

    component.onAddApp();
    fixture.detectChanges();

    expect(counter()).toBe('0 of 2 selected');
    expect(selectAll().checked).toBe(false);

    component.scopeSearch.set('users');
    fixture.detectChanges();
    expect(component.filteredScopes().map((item) => item.scope)).toEqual(['users:admin']);

    selectAll().click();
    fixture.detectChanges();

    expect(component.form.scopes).toEqual(['users:admin']);
    expect(selectAll().checked).toBe(true);
    expect(counter()).toBe('1 of 2 selected');

    component.scopeSearch.set('');
    fixture.detectChanges();
    expect(selectAll().checked).toBe(false);
    expect(selectAll().indeterminate).toBe(true);

    selectAll().click();
    fixture.detectChanges();
    expect(component.form.scopes).toEqual(['users:admin', 'tickets:read']);
    expect(counter()).toBe('2 of 2 selected');

    selectAll().click();
    fixture.detectChanges();
    expect(component.form.scopes).toEqual([]);

    component.scopeSearch.set('nothing-matches');
    fixture.detectChanges();
    expect(document.body.textContent).toContain('No scopes match your search');
    expect(selectAll().checked).toBe(false);
  });

  it('shows the authorization count as a badge that opens the authorizations, not the edit form', () => {
    const badge = el().querySelector('[data-testid="app-grants-a1"]') as HTMLButtonElement;

    expect(badge.querySelector('fpc-badge')?.textContent?.trim()).toBe('3');

    badge.click();
    fixture.detectChanges();

    expect(facade['loadGrants']).toHaveBeenCalledWith('a1');
    expect(fixture.componentInstance.grantsModalOpen()).toBe(true);
    expect(fixture.componentInstance.formModalOpen()).toBe(false);
  });

  it('opens the authorizations of an app', () => {
    fixture.componentInstance.onAppAction(app('a1', 'Ticket Sync'), 'grants');
    fixture.detectChanges();

    expect(facade['loadGrants']).toHaveBeenCalledWith('a1');
    expect(fixture.componentInstance.grantsModalOpen()).toBe(true);
  });
});

describe('isValidAppReturnUrl', () => {
  it('mirrors the backend rule', () => {
    expect(isValidAppReturnUrl('https://app.example.com/cb')).toBe(true);
    expect(isValidAppReturnUrl('http://localhost:4000/cb')).toBe(true);
    expect(isValidAppReturnUrl('http://app.example.com/cb')).toBe(false);
    expect(isValidAppReturnUrl('https://app.example.com/cb#x')).toBe(false);
    expect(isValidAppReturnUrl('javascript:alert(1)')).toBe(false);
  });
});
