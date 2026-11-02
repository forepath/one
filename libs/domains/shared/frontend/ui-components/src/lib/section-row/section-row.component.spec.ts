import { TestBed } from '@angular/core/testing';

import { FpcSectionRowComponent } from './section-row.component';

describe('FpcSectionRowComponent', () => {
  const create = (inputs: Record<string, unknown> = {}) => {
    const fixture = TestBed.createComponent(FpcSectionRowComponent);

    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }

    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  };

  it('marks nowrap and stacked rows on the host', () => {
    const host = create({ nowrap: true, stacked: true });

    expect(host.classList).toContain('section__row');
    expect(host.classList).toContain('fpc-section-row--nowrap');
    expect(host.classList).toContain('fpc-section-row--stacked');
  });

  it('wraps and does not stack by default', () => {
    const host = create();

    expect(host.classList).not.toContain('fpc-section-row--nowrap');
    expect(host.classList).not.toContain('fpc-section-row--stacked');
  });
});
