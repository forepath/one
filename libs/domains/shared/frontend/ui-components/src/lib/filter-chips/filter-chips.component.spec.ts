import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcFilterChip, FpcFilterChipsComponent, fpcFilterChipText } from './filter-chips.component';

describe('FpcFilterChipsComponent', () => {
  let fixture: ComponentFixture<FpcFilterChipsComponent>;
  let host: HTMLElement;
  const chips: FpcFilterChip[] = [
    { id: 'kind', field: 'kind', value: 'VirtualMachine' },
    { id: 'status', field: 'status', value: 'ready', negated: true },
  ];

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcFilterChipsComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  it('renders nothing without chips', () => {
    fixture.detectChanges();
    expect(host.querySelector('ul')).toBeNull();
  });

  it('renders chips and emits removals and clear all', () => {
    fixture.componentRef.setInput('chips', chips);
    fixture.detectChanges();
    const removed: FpcFilterChip[] = [];
    let cleared = 0;
    fixture.componentInstance.removeChip.subscribe((chip) => removed.push(chip));
    fixture.componentInstance.clearAll.subscribe(() => cleared++);

    const rendered = host.querySelectorAll('[data-testid="fpc-filter-chip"]');
    expect(rendered).toHaveLength(2);
    expect(rendered[1].textContent).toContain('−status:ready');

    (rendered[0].querySelector('button') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="fpc-filter-chips-clear"]') as HTMLButtonElement).click();
    expect(removed).toEqual([chips[0]]);
    expect(cleared).toBe(1);
  });

  it('formats chip text', () => {
    expect(fpcFilterChipText({ id: 'a', value: 'web' })).toBe('web');
    expect(fpcFilterChipText({ id: 'b', field: 'in', value: 'project/shop', label: 'Project shop' })).toBe(
      'Project shop',
    );
  });
});
