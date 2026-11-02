import { TestBed } from '@angular/core/testing';

import { FpcSearchFieldComponent } from './search-field.component';

describe('FpcSearchFieldComponent', () => {
  const create = (inputs: Record<string, unknown>) => {
    const fixture = TestBed.createComponent(FpcSearchFieldComponent);

    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }

    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  };

  // The strip height follows `--fpc-control-height-*`; these host classes pick the tier and
  // whether the inner glyph / input subtract the border.
  it('marks the size tier and the bordered strip on the host', () => {
    const host = create({ size: 'sm' });

    expect(host.classList).toContain('fpc-search-field--sm');
    expect(host.classList).toContain('fpc-search-field--bordered');
    expect(host.querySelector('.search-input-container')?.classList).toContain('input-group-sm');
  });

  it('drops the bordered marker for full-bleed strips', () => {
    const host = create({ bordered: false });

    expect(host.classList).not.toContain('fpc-search-field--bordered');
    expect(host.classList).not.toContain('fpc-search-field--sm');
  });

  it('does not apply console strip sizing to the marketing appearance', () => {
    const host = create({ appearance: 'marketing', size: 'lg' });

    expect(host.classList).not.toContain('fpc-search-field--lg');
    expect(host.classList).not.toContain('fpc-search-field--bordered');
  });
});
