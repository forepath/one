import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcProgressRingComponent } from './progress-ring.component';

describe('FpcProgressRingComponent', () => {
  let fixture: ComponentFixture<FpcProgressRingComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcProgressRingComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function indicator(): SVGCircleElement {
    return host.querySelector('.fpc-progress-ring__indicator') as SVGCircleElement;
  }

  it('renders the percentage and aria attributes', () => {
    fixture.componentRef.setInput('value', 25);
    fixture.componentRef.setInput('label', 'CPU');
    fixture.detectChanges();

    expect(host.getAttribute('role')).toBe('progressbar');
    expect(host.getAttribute('aria-label')).toBe('CPU');
    expect(host.getAttribute('aria-valuenow')).toBe('25');
    expect(host.getAttribute('aria-valuemax')).toBe('100');
    expect(host.getAttribute('aria-valuetext')).toBe('25%');
    expect(host.querySelector('.fpc-progress-ring__label')?.textContent?.trim()).toBe('25%');
  });

  it('computes the dash offset from value and max', () => {
    fixture.componentRef.setInput('value', 3);
    fixture.componentRef.setInput('max', 4);
    fixture.componentRef.setInput('size', 44);
    fixture.componentRef.setInput('strokeWidth', 4);
    fixture.detectChanges();

    const circumference = 2 * Math.PI * 20;

    expect(Number(indicator().getAttribute('r'))).toBe(20);
    expect(Number(indicator().getAttribute('stroke-dasharray'))).toBeCloseTo(circumference);
    expect(Number(indicator().getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference / 4);
    expect(host.style.width).toBe('44px');
  });

  it('clamps values outside the range and handles max = 0', () => {
    fixture.componentRef.setInput('value', 150);
    fixture.detectChanges();
    expect(host.getAttribute('aria-valuenow')).toBe('100');
    expect(Number(indicator().getAttribute('stroke-dashoffset'))).toBeCloseTo(0);

    fixture.componentRef.setInput('value', -5);
    fixture.detectChanges();
    expect(host.getAttribute('aria-valuenow')).toBe('0');

    fixture.componentRef.setInput('max', 0);
    fixture.detectChanges();
    expect(host.getAttribute('aria-valuetext')).toBe('0%');
  });

  it('applies the tone and custom / hidden centre text', () => {
    fixture.componentRef.setInput('tone', 'danger');
    fixture.componentRef.setInput('centerLabel', '7/8');
    fixture.detectChanges();

    expect(host.getAttribute('data-tone')).toBe('danger');
    expect(host.querySelector('.fpc-progress-ring__label')?.textContent?.trim()).toBe('7/8');

    fixture.componentRef.setInput('showLabel', false);
    fixture.detectChanges();
    expect(host.querySelector('.fpc-progress-ring__label')).toBeNull();
  });
});
