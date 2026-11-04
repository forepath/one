import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { provideFpcControlSize } from '../control-size/control-size';
import { FpcFormFieldComponent } from '../form-field/form-field.component';
import { FpcLabelComponent } from './label.component';

@Component({
  standalone: true,
  imports: [FpcLabelComponent, FpcFormFieldComponent],
  template: `
    <fpc-label forId="a" [required]="true">A rather long label that does not fit</fpc-label>
    <fpc-form-field forId="b" label="Field label"><input id="b" /></fpc-form-field>
    <fpc-form-field forId="c" label="Small field" size="sm"><input id="c" /></fpc-form-field>
  `,
})
class HostComponent {}

describe('FpcLabelComponent', () => {
  function render(): HTMLElement {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('renders standard (md) labels without a size modifier', () => {
    const [plain, field] = Array.from(render().querySelectorAll('label.form-label'));

    expect(plain.classList).not.toContain('fpc-form-label--sm');
    expect(field.classList).not.toContain('fpc-form-label--sm');
  });

  it('matches the label text to a deviating control size', () => {
    const labels = render().querySelectorAll('label.form-label');

    expect(labels[2].classList).toContain('fpc-form-label--sm');
  });

  it('keeps the required marker outside the truncated text', () => {
    const label = render().querySelector('label.form-label') as HTMLElement;
    const text = label.querySelector('.fpc-label__text') as HTMLElement;

    expect(text.textContent?.trim()).toBe('A rather long label that does not fit');
    expect(label.querySelector('.fpc-label__required')?.parentElement).toBe(label);
  });

  it('shows the full text as title on hover only while it is cut off', () => {
    const text = render().querySelector('.fpc-label__text') as HTMLElement;
    let scrollWidth = 300;

    Object.defineProperty(text, 'scrollWidth', { get: () => scrollWidth });
    Object.defineProperty(text, 'clientWidth', { get: () => 120 });

    text.dispatchEvent(new MouseEvent('mouseenter'));
    expect(text.getAttribute('title')).toBe('A rather long label that does not fit');

    scrollWidth = 100;
    text.dispatchEvent(new MouseEvent('mouseenter'));
    expect(text.hasAttribute('title')).toBe(false);
  });
});

describe('FpcFormTextDirective (field subtexts)', () => {
  @Component({
    standalone: true,
    imports: [FpcFormFieldComponent],
    template: `<fpc-form-field forId="d" label="Name" hint="Shown on invoices"><input id="d" /></fpc-form-field>`,
  })
  class HintHostComponent {}

  function hint(token?: 'sm'): HTMLElement {
    if (token) {
      TestBed.configureTestingModule({ providers: [provideFpcControlSize(token)] });
    }

    const fixture = TestBed.createComponent(HintHostComponent);

    fixture.detectChanges();

    return (fixture.nativeElement as HTMLElement).querySelector('.fpc-form-field__hint') as HTMLElement;
  }

  it('keeps the regular hint size on public (md) pages', () => {
    expect(hint().classList).not.toContain('fpc-form-text--sm');
  });

  it('steps the hint down with the sm tier and shows cut-off text on hover', () => {
    const element = hint('sm');

    expect(element.classList).toContain('fpc-form-text--sm');

    Object.defineProperty(element, 'scrollWidth', { get: () => 300 });
    Object.defineProperty(element, 'clientWidth', { get: () => 100 });
    element.dispatchEvent(new MouseEvent('mouseenter'));
    expect(element.getAttribute('title')).toBe('Shown on invoices');
  });
});
