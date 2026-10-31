import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcProgressRowComponent } from './progress-row.component';

describe('FpcProgressRowComponent', () => {
  let fixture: ComponentFixture<FpcProgressRowComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcProgressRowComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  const bar = () => host.querySelector('[role="progressbar"]') as HTMLElement;
  const fill = () => host.querySelector('.progress-bar') as HTMLElement;

  it('renders a slim progressbar with value, min, max and the label as accessible name', () => {
    fixture.componentRef.setInput('value', 3);
    fixture.componentRef.setInput('max', 4);
    fixture.componentRef.setInput('label', 'Applying layer dns');
    fixture.detectChanges();

    expect(bar().getAttribute('aria-valuenow')).toBe('3');
    expect(bar().getAttribute('aria-valuemin')).toBe('0');
    expect(bar().getAttribute('aria-valuemax')).toBe('4');
    expect(bar().getAttribute('aria-label')).toBe('Applying layer dns');
    expect(bar().style.height).toBe('0.375rem');
    expect(host.querySelector('.fpc-progress-row__label')?.textContent?.trim()).toBe('Applying layer dns');
    expect(host.querySelector('.fpc-progress-row__value')?.textContent?.trim()).toBe('75%');
  });

  it('prefers an explicit aria label and value text; empty value text hides it', () => {
    fixture.componentRef.setInput('label', 'Step');
    fixture.componentRef.setInput('ariaLabel', 'Apply progress');
    fixture.componentRef.setInput('valueText', '2 / 5');
    fixture.detectChanges();
    expect(bar().getAttribute('aria-label')).toBe('Apply progress');
    expect(host.querySelector('.fpc-progress-row__value')?.textContent?.trim()).toBe('2 / 5');

    fixture.componentRef.setInput('valueText', '');
    fixture.detectChanges();
    expect(host.querySelector('.fpc-progress-row__value')).toBeNull();
  });

  it.each([
    ['running', 'bg-primary', true],
    ['success', 'bg-success', false],
    ['failed', 'bg-danger', false],
    ['paused', 'bg-warning', false],
    ['idle', 'bg-secondary', false],
  ] as const)('state %s: tone %s, animated %s', (state, tone, animated) => {
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('value', 40);
    fixture.detectChanges();

    expect(fill().classList).toContain(tone);
    expect(fill().classList.contains('progress-bar-striped')).toBe(animated);
    expect(fill().classList.contains('progress-bar-animated')).toBe(animated);
    expect(host.getAttribute('data-state')).toBe(state);
  });

  it('lets variant override the state tone (running rollback)', () => {
    fixture.componentRef.setInput('state', 'running');
    fixture.componentRef.setInput('variant', 'warning');
    fixture.detectChanges();

    expect(fill().classList).toContain('bg-warning');
    expect(fill().classList).toContain('progress-bar-animated');
  });

  it('shows an optional status badge toned by state', () => {
    fixture.componentRef.setInput('status', 'Failed');
    fixture.componentRef.setInput('state', 'failed');
    fixture.detectChanges();

    const badge = host.querySelector('fpc-badge.fpc-progress-row__status');

    expect(badge?.textContent?.trim()).toBe('Failed');
    expect(badge?.classList).toContain('fpc-badge--danger');
  });

  it('marks the text line as a polite live region unless live is off', () => {
    fixture.componentRef.setInput('label', 'Step');
    fixture.detectChanges();
    const text = host.querySelector('.fpc-progress-row__text') as HTMLElement;

    expect(text.getAttribute('role')).toBe('status');
    expect(text.getAttribute('aria-live')).toBe('polite');

    fixture.componentRef.setInput('live', false);
    fixture.detectChanges();
    expect(text.getAttribute('role')).toBeNull();
  });

  it('switches to the inline layout by host class', () => {
    fixture.componentRef.setInput('layout', 'inline');
    fixture.detectChanges();
    expect(host.classList).toContain('fpc-progress-row--inline');
  });
});

@Component({
  standalone: true,
  imports: [FpcProgressRowComponent],
  template: `<fpc-progress-row label="Step" [value]="10">
    <span fpcProgressRowAside class="aside">12:00</span>
    <p class="detail">Failure</p>
  </fpc-progress-row>`,
})
class HostComponent {}

describe('FpcProgressRowComponent slots', () => {
  it('projects aside meta into the text line and details below the bar', () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.fpc-progress-row__aside .aside')?.textContent).toBe('12:00');
    expect(el.querySelector('.fpc-progress-row__main + .detail')?.textContent).toBe('Failure');
  });
});
