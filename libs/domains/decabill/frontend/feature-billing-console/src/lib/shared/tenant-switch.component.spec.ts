import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BillingTenantSwitchComponent, type BillingTenantSwitchOption } from './tenant-switch.component';

@Component({
  standalone: true,
  imports: [BillingTenantSwitchComponent],
  template: `<framework-billing-tenant-switch
    [options]="options"
    [activeId]="active()"
    (selectTenant)="chosen.push($event)"
  />`,
})
class HostComponent {
  readonly options: BillingTenantSwitchOption[] = [
    { id: 'default', label: 'Home Co', description: 'Home tenant' },
    { id: 'acme', label: 'Acme' },
    { id: 'all', label: 'All tenants', icon: 'buildings' },
  ];
  readonly active = signal('default');
  readonly chosen: string[] = [];
}

describe('BillingTenantSwitchComponent', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    const switcher = fixture.debugElement.children[0].componentInstance as BillingTenantSwitchComponent;

    return { fixture, switcher, el: fixture.nativeElement as HTMLElement };
  }

  it('labels the chip with the active option', () => {
    const { fixture, el } = render();

    expect(el.querySelector('[data-testid="tenant-switch-chip"]')?.textContent).toContain('Home Co');

    fixture.componentInstance.active.set('all');
    fixture.detectChanges();

    const chip = el.querySelector('[data-testid="tenant-switch-chip"]');

    expect(chip?.textContent).toContain('All tenants');
    expect(chip?.querySelector('.bi-buildings')).not.toBeNull();
  });

  it('filters the options by label, id and note', () => {
    const { switcher } = render();
    const internals = switcher as unknown as {
      query: { set(value: string): void };
      filteredOptions(): BillingTenantSwitchOption[];
    };

    internals.query.set('acm');
    expect(internals.filteredOptions().map((option) => option.id)).toEqual(['acme']);

    internals.query.set('home tenant');
    expect(internals.filteredOptions().map((option) => option.id)).toEqual(['default']);

    internals.query.set('  ');
    expect(internals.filteredOptions()).toHaveLength(3);
  });

  it('emits only a different choice and closes the dialog', () => {
    const { fixture, switcher } = render();
    const internals = switcher as unknown as { switchOpen(): boolean };

    switcher.openSwitch();
    expect(internals.switchOpen()).toBe(true);

    switcher.choose({ id: 'default', label: 'Home Co' });
    expect(fixture.componentInstance.chosen).toEqual([]);
    expect(internals.switchOpen()).toBe(false);

    switcher.openSwitch();
    switcher.choose({ id: 'acme', label: 'Acme' });
    expect(fixture.componentInstance.chosen).toEqual(['acme']);
  });
});
