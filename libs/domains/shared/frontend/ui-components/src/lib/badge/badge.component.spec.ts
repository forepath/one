import { TestBed } from '@angular/core/testing';

import { FpcBadgeComponent } from './badge.component';

describe('FpcBadgeComponent tone', () => {
  function render(inputs: Record<string, unknown>): HTMLElement {
    const fixture = TestBed.createComponent(FpcBadgeComponent);

    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('renders an object state as the shared tinted text badge, overriding variant / color', () => {
    const failed = render({ tone: 'danger', variant: 'info', color: 'light' });

    expect(failed.classList).toContain('badge');
    expect(failed.classList).toContain('text-bg-danger');
    expect(failed.classList).toContain('fpc-badge--tone');
    expect(failed.classList).not.toContain('fpc-badge--info');
    expect(render({ tone: 'neutral' }).classList).toContain('text-bg-secondary');
    expect(render({ tone: 'dark' }).classList).toContain('text-bg-dark');
  });

  it('keeps variant / color without a tone', () => {
    const chip = render({ variant: 'info', color: 'secondary' });

    expect(chip.classList).toContain('fpc-badge--info');
    expect(chip.classList).not.toContain('badge');
  });
});

describe('FpcBadgeComponent iconOnly', () => {
  it('renders a square icon badge with the label as title + aria-label and drops the text', () => {
    const fixture = TestBed.createComponent(FpcBadgeComponent);

    fixture.componentRef.setInput('icon', 'check-circle');
    fixture.componentRef.setInput('iconOnly', true);
    fixture.componentRef.setInput('label', 'Running');
    fixture.componentRef.setInput('tone', 'success');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.classList).toContain('fpc-badge--icon-only');
    expect(host.getAttribute('title')).toBe('Running');
    expect(host.getAttribute('aria-label')).toBe('Running');
    expect(host.getAttribute('role')).toBe('img');
    expect(host.querySelector('i.bi-check-circle')).not.toBeNull();
  });
});
