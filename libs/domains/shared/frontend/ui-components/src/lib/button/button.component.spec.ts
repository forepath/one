import { TestBed } from '@angular/core/testing';

import { FpcButtonComponent } from './button.component';

describe('FpcButtonComponent', () => {
  function render(inputs: Record<string, unknown> = {}): HTMLButtonElement {
    const fixture = TestBed.createComponent(FpcButtonComponent);

    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();

    return (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
  }

  it('omits the popup ARIA attributes when unset', () => {
    const button = render();

    expect(button.hasAttribute('aria-haspopup')).toBe(false);
    expect(button.hasAttribute('aria-expanded')).toBe(false);
    expect(button.hasAttribute('aria-controls')).toBe(false);
  });

  it('forwards aria-haspopup / aria-expanded / aria-controls to the native control', () => {
    const open = render({ ariaHaspopup: 'menu', ariaExpanded: true, ariaControls: 'menu-1' });

    expect(open.getAttribute('aria-haspopup')).toBe('menu');
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.getAttribute('aria-controls')).toBe('menu-1');
    expect(render({ ariaExpanded: false }).getAttribute('aria-expanded')).toBe('false');
  });

  it('forwards aria-pressed for toggle / segmented buttons (omitted when unset)', () => {
    expect(render().hasAttribute('aria-pressed')).toBe(false);
    expect(render({ ariaPressed: true }).getAttribute('aria-pressed')).toBe('true');
    expect(render({ ariaPressed: false }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps aria-expanded="false" for a Bootstrap toggle unless ariaExpanded is set', () => {
    expect(render({ dataBsToggle: 'dropdown' }).getAttribute('aria-expanded')).toBe('false');
    expect(render({ dataBsToggle: 'dropdown', ariaExpanded: true }).getAttribute('aria-expanded')).toBe('true');
  });

  it('switches the size tier at md with mdSize (compact on phones, default from md)', () => {
    const responsive = render({ size: 'sm', mdSize: 'md' });

    expect(responsive.classList).toContain('btn-sm');
    expect(responsive.classList).toContain('fpc-button__btn--md-md');
    expect(render({ size: 'sm' }).className).not.toContain('fpc-button__btn--md-');
    expect(render({ size: 'md', mdSize: 'md' }).className).not.toContain('fpc-button__btn--md-');
  });
});
