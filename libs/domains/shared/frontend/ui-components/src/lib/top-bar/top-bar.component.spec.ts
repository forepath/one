import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { FpcTopBarComponent } from './top-bar.component';

describe('FpcTopBarComponent', () => {
  function render(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ imports: [FpcTopBarComponent], providers: [provideRouter([])] });

    const fixture = TestBed.createComponent(FpcTopBarComponent);

    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);

    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('renders the brand mark without a link by default', () => {
    const el = render({ brandSrc: 'logo.svg', brandAlt: 'Brand' });

    expect(el.querySelector('.fpc-top-bar__brand-icon')?.getAttribute('src')).toBe('logo.svg');
    expect(el.querySelector('[data-testid="top-bar-brand-link"]')).toBeNull();
  });

  it('links the brand mark to the given route', () => {
    const el = render({ brandSrc: 'logo.svg', brandLink: ['/overview'] });
    const link = el.querySelector('[data-testid="top-bar-brand-link"]');

    expect(link?.getAttribute('href')).toBe('/overview');
    expect(link?.querySelector('.fpc-top-bar__brand-icon')).not.toBeNull();
  });

  it('shows no brand in compact mode', () => {
    const el = render({ brandSrc: 'logo.svg', brandLink: '/x', compact: true });

    expect(el.querySelector('.fpc-top-bar__brand-mark')).toBeNull();
  });
});
