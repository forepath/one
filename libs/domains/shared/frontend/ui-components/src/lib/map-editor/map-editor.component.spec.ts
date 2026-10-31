import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcMapEditorComponent, type FpcMapValue, fpcMapRowError } from './map-editor.component';

@Component({
  standalone: true,
  imports: [FpcMapEditorComponent],
  template: `<fpc-map-editor label="Labels" [(value)]="labels" [valueType]="type()" keyPattern="^[a-z]+$" />`,
})
class HostComponent {
  readonly labels = signal<FpcMapValue>({ app: 'web' });
  readonly type = signal<'text' | 'number'>('text');
}

describe('FpcMapEditorComponent', () => {
  function render() {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const keys = () => Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="fpc-map-editor-key"]'));
    const values = () => Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="fpc-map-editor-value"]'));
    const type = (input: HTMLInputElement, text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    return { fixture, host, keys, values, type };
  }

  it('validates rows: missing key, duplicate, pattern, number', () => {
    const first = { key: 'a', value: '' };
    const second = { key: 'a', value: '' };
    const rows = [first, second];

    expect(fpcMapRowError({ key: '', value: 'x' }, rows, {})).toBe('requiredKey');
    expect(fpcMapRowError({ key: '', value: '' }, rows, {})).toBeNull();
    expect(fpcMapRowError(first, rows, {})).toBeNull();
    expect(fpcMapRowError(second, rows, {})).toBe('duplicate');
    expect(fpcMapRowError({ key: 'B', value: '' }, [], { keyPattern: '^[a-z]+$' })).toBe('invalidKey');
    expect(fpcMapRowError({ key: 'b', value: 'x' }, [], { valueType: 'number' })).toBe('invalidValue');
  });

  it('adds, edits and removes entries; incomplete rows stay local with their error', () => {
    const { fixture, host, keys, values, type } = render();

    expect(keys()[0].value).toBe('app');
    (host.querySelector('[data-testid="fpc-map-editor-add"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(keys().length).toBe(2);
    expect(fixture.componentInstance.labels()).toEqual({ app: 'web' });

    type(keys()[1], 'app');
    expect(host.textContent).toContain('This key is used twice.');
    expect(fixture.componentInstance.labels()).toEqual({ app: 'web' });

    type(keys()[1], 'tier');
    type(values()[1], 'critical');
    expect(fixture.componentInstance.labels()).toEqual({ app: 'web', tier: 'critical' });
    // The written value echoes back without resetting the rows.
    expect(keys().length).toBe(2);

    (host.querySelectorAll('[data-testid="fpc-map-editor-remove"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.labels()).toEqual({ tier: 'critical' });
  });

  it('writes numbers for valueType="number" and follows outside changes', () => {
    const { fixture, keys, values, type } = render();

    fixture.componentInstance.type.set('number');
    fixture.componentInstance.labels.set({ audit: 365 });
    fixture.detectChanges();
    expect(keys().map((k) => k.value)).toEqual(['audit']);
    type(values()[0], '30');
    expect(fixture.componentInstance.labels()).toEqual({ audit: 30 });
  });
});
