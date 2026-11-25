import { TestBed } from '@angular/core/testing';

import { DeliveryPreferenceFieldComponent } from './delivery-preference-field.component';

describe('DeliveryPreferenceFieldComponent', () => {
  function render(available: boolean, value: 'email' | 'letter') {
    const fixture = TestBed.createComponent(DeliveryPreferenceFieldComponent);

    fixture.componentRef.setInput('controlId', 'pref');
    fixture.componentRef.setInput('available', available);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('is offered only while letters are available', () => {
    expect(render(false, 'email').querySelector('#pref')).toBeNull();
    expect(render(true, 'email').querySelector('#pref')).not.toBeNull();
  });

  it('stays visible for customers who prefer letters, with letter disabled and a hint', () => {
    const element = render(false, 'letter');
    const letter = element.querySelector('option[value="letter"]') as HTMLOptionElement | null;

    expect(element.querySelector('#pref')).not.toBeNull();
    expect(letter?.disabled).toBe(true);
    expect(element.textContent).toContain('currently not available');
  });
});
