import { TestBed } from '@angular/core/testing';

import { FpcFormControlComponent } from './form-control.component';

describe('FpcFormControlComponent', () => {
  function render(inputs: Record<string, unknown>): HTMLInputElement {
    const fixture = TestBed.createComponent(FpcFormControlComponent);

    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();

    return (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
  }

  it('renders a range input as a Bootstrap form-range without size tiers', () => {
    const slider = render({ inputType: 'range', size: 'sm', min: 0, max: 60, step: 5, controlClass: 'w-100' });

    expect(slider.type).toBe('range');
    expect(slider.className).toBe('form-range w-100');
    expect(slider.getAttribute('max')).toBe('60');
  });

  it('keeps form-control + size classes for text inputs', () => {
    expect(render({ size: 'sm' }).className).toBe('form-control form-control-sm');
  });
});
