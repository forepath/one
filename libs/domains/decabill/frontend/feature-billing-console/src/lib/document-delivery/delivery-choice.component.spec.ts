import { TestBed } from '@angular/core/testing';

import { DeliveryChoiceComponent } from './delivery-choice.component';

describe('DeliveryChoiceComponent', () => {
  function render(inputs: { postalAvailable: boolean; allowNone: boolean }) {
    const fixture = TestBed.createComponent(DeliveryChoiceComponent);

    fixture.componentRef.setInput('idPrefix', 'test');
    fixture.componentRef.setInput('postalAvailable', inputs.postalAvailable);
    fixture.componentRef.setInput('allowNone', inputs.allowNone);
    fixture.detectChanges();

    return fixture;
  }

  it('offers letters only with a postal provider and "do not send" only for finalizing actions', () => {
    const plain = render({ postalAvailable: false, allowNone: false }).nativeElement as HTMLElement;

    expect(plain.querySelector('#test_email')).not.toBeNull();
    expect(plain.querySelector('#test_letter')).toBeNull();
    expect(plain.querySelector('#test_none')).toBeNull();

    const full = render({ postalAvailable: true, allowNone: true }).nativeElement as HTMLElement;

    expect(full.querySelector('#test_letter')).not.toBeNull();
    expect(full.querySelector('#test_none')).not.toBeNull();
  });

  it('updates the value and hides the spool hint for "do not send"', () => {
    const fixture = render({ postalAvailable: true, allowNone: true });
    const component = fixture.componentInstance;

    expect(component.showSpoolHint()).toBe(true);
    component.value.set('none');
    expect(component.showSpoolHint()).toBe(false);
  });
});
