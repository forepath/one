import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { FpcMultiSelectComponent, FpcMultiSelectOption } from './multi-select.component';

const options: FpcMultiSelectOption[] = Array.from({ length: 9 }, (_, index) => ({
  value: `p${index}`,
  label: `Plan ${index}`,
}));

@Component({
  standalone: true,
  imports: [FpcMultiSelectComponent, ReactiveFormsModule],
  template: `<fpc-multi-select [formControl]="control" [options]="options()" />`,
})
class HostComponent {
  readonly control = new FormControl<string[]>(['p3'], { nonNullable: true });
  readonly options = signal(options);
}

describe('FpcMultiSelectComponent', () => {
  function render() {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('shows the form value as chips and checks, and writes toggles back in option order', () => {
    const { fixture, host } = render();

    expect(host.querySelector('.fpc-multi-select__chip')?.textContent).toContain('Plan 3');
    (host.querySelector('input[data-value="p1"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toEqual(['p1', 'p3']);

    (host.querySelector('.fpc-multi-select__chip-remove') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toEqual(['p3']);
  });

  it('filters the list from `searchFrom` options on and follows the form disabled state', () => {
    const { fixture, host } = render();
    const search = host.querySelector('[data-testid="fpc-multi-select-search"]') as HTMLInputElement;

    search.value = 'plan 8';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.querySelectorAll('.fpc-multi-select__option')).toHaveLength(1);

    fixture.componentInstance.control.disable();
    fixture.detectChanges();
    expect((host.querySelector('input[data-value="p8"]') as HTMLInputElement).disabled).toBe(true);
  });
});
