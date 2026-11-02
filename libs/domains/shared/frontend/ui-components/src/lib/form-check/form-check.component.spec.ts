import { TestBed } from '@angular/core/testing';

import { FpcFormSwitchComponent } from '../form-switch/form-switch.component';

import { FpcFormCheckComponent } from './form-check.component';

describe('form check / switch hint', () => {
  function render(
    component: typeof FpcFormCheckComponent | typeof FpcFormSwitchComponent,
    inputs: Record<string, unknown>,
  ): HTMLElement {
    const fixture = TestBed.createComponent(component);

    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('renders the check hint under the label and links it via aria-describedby', () => {
    const el = render(FpcFormCheckComponent, { label: 'Force', checkId: 'force', hint: 'Skips the drain.' });
    const hint = el.querySelector('.fpc-form-check__hint');

    expect(hint?.textContent?.trim()).toBe('Skips the drain.');
    expect(hint?.id).toBe('force-hint');
    expect(el.querySelector('input')?.getAttribute('aria-describedby')).toBe('force-hint');
  });

  it('renders the switch hint and links it via aria-describedby', () => {
    const el = render(FpcFormSwitchComponent, {
      label: 'Webhook',
      switchId: 'wh',
      hint: 'Push events trigger a sync.',
    });
    const hint = el.querySelector('.fpc-form-switch__hint');

    expect(hint?.textContent?.trim()).toBe('Push events trigger a sync.');
    expect(el.querySelector('input')?.getAttribute('aria-describedby')).toBe('wh-hint');
  });

  it('renders no hint and no aria-describedby without a hint', () => {
    for (const component of [FpcFormCheckComponent, FpcFormSwitchComponent]) {
      const el = render(component, { label: 'Plain' });

      expect(el.querySelector('.form-text')).toBeNull();
      expect(el.querySelector('input')?.hasAttribute('aria-describedby')).toBe(false);
    }
  });
});
