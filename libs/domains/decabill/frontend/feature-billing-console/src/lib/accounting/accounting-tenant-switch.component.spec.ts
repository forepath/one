import { TestBed } from '@angular/core/testing';
import { AccountingFacade, BillingCapabilitiesFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject } from 'rxjs';

import { ACCOUNTING_ALL_TENANTS, AccountingTenantSwitchComponent } from './accounting-tenant-switch.component';

describe('AccountingTenantSwitchComponent', () => {
  let viewTenantId$: BehaviorSubject<string | null>;
  let globalAccess$: BehaviorSubject<boolean>;
  let setViewTenant: jest.Mock;

  function render() {
    TestBed.configureTestingModule({
      imports: [AccountingTenantSwitchComponent],
      providers: [
        { provide: AccountingFacade, useValue: { viewTenantId$, setViewTenant } },
        {
          provide: BillingCapabilitiesFacade,
          useValue: {
            accountingGlobalAccess$: globalAccess$,
            viewableTenants$: new BehaviorSubject(['acme', 'beta']),
          },
        },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', tenantName: 'Home Co' } } },
      ],
    });

    const fixture = TestBed.createComponent(AccountingTenantSwitchComponent);

    fixture.detectChanges();

    return fixture;
  }

  beforeEach(() => {
    viewTenantId$ = new BehaviorSubject<string | null>(null);
    globalAccess$ = new BehaviorSubject(true);
    setViewTenant = jest.fn();
  });

  it('shows the viewed tenant as a header chip instead of a tab strip', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="tenant-switch-chip"]')).not.toBeNull();
    expect(el.querySelector('fpc-tab-group')).toBeNull();

    viewTenantId$.next('acme');
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="tenant-switch-chip"]')?.textContent).toContain('Acme');
  });

  it('offers the home tenant first, the other viewable tenants and "All tenants"', () => {
    const component = render().componentInstance;

    expect(component.options().map((option) => option.id)).toEqual(['default', 'acme', 'beta', ACCOUNTING_ALL_TENANTS]);
    expect(component.activeId()).toBe('default');
  });

  it('switches the viewed tenant and maps the home tenant back to null', () => {
    const component = render().componentInstance;

    component.select('acme');
    expect(setViewTenant).toHaveBeenLastCalledWith('acme');

    viewTenantId$.next('acme');
    component.select('default');
    expect(setViewTenant).toHaveBeenLastCalledWith(null);

    setViewTenant.mockClear();
    component.select('acme');
    expect(setViewTenant).not.toHaveBeenCalled();
  });

  it('stays hidden without accounting global access', () => {
    globalAccess$.next(false);
    const el = render().nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="tenant-switch-chip"]')).toBeNull();
  });
});
