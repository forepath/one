import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONTACT_MESSAGE_PREFILL_STORAGE_KEY } from '@forepath/shared/frontend/feature-landingpage';

import { LOADWEAVER_EARLY_ACCESS_MESSAGE, LoadweaverEarlyAccessDirective } from './early-access';

@Component({
  standalone: true,
  imports: [LoadweaverEarlyAccessDirective],
  template: `<button id="default" loadweaverEarlyAccess>a</button>
    <button id="custom" loadweaverEarlyAccess="Cloud please">b</button>`,
})
class HostComponent {}

describe('LoadweaverEarlyAccessDirective', () => {
  beforeEach(() => sessionStorage.clear());

  function clickAndRead(id: string): string {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    (fixture.nativeElement.querySelector(`#${id}`) as HTMLButtonElement).click();

    return JSON.parse(sessionStorage.getItem(CONTACT_MESSAGE_PREFILL_STORAGE_KEY) ?? '{}').message;
  }

  it('stores the default early access prefill', () => {
    expect(clickAndRead('default')).toBe(LOADWEAVER_EARLY_ACCESS_MESSAGE);
  });

  it('stores a custom prefill', () => {
    expect(clickAndRead('custom')).toBe('Cloud please');
  });
});
