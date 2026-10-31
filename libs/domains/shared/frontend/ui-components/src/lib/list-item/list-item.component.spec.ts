import { TestBed } from '@angular/core/testing';

import { FpcListComponent } from '../list/list.component';

import { FpcListItemComponent } from './list-item.component';

describe('fpc-list / fpc-list-item roles', () => {
  function render<T>(component: new (...args: never[]) => T, inputs: Record<string, unknown>): HTMLElement {
    const fixture = TestBed.createComponent(component);

    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('defaults to list / listitem with aria-current on the active row', () => {
    expect(render(FpcListComponent, {}).getAttribute('role')).toBe('list');

    const row = render(FpcListItemComponent, { active: true });

    expect(row.getAttribute('role')).toBe('listitem');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.hasAttribute('aria-selected')).toBe(false);
  });

  it('renders a listbox of options whose active row is aria-selected', () => {
    expect(render(FpcListComponent, { role: 'listbox' }).getAttribute('role')).toBe('listbox');

    const active = render(FpcListItemComponent, { role: 'option', active: true, clickable: true });
    const idle = render(FpcListItemComponent, { role: 'option' });

    expect(active.getAttribute('role')).toBe('option');
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.hasAttribute('aria-current')).toBe(false);
    expect(idle.getAttribute('aria-selected')).toBe('false');
  });
});
