import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcStep, FpcStepperComponent, fpcStepReachable } from './stepper.component';

const steps: FpcStep[] = [
  { id: 'general', label: 'General' },
  { id: 'source', label: 'Source', invalid: true },
  { id: 'hardware', label: 'Hardware', optional: true },
  { id: 'review', label: 'Review' },
];

describe('FpcStepperComponent', () => {
  let fixture: ComponentFixture<FpcStepperComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcStepperComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();
  });

  function button(id: string): HTMLButtonElement {
    return host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
  }

  it('moves forward over valid steps only (linear)', () => {
    expect(button('fpc-stepper-back').disabled).toBe(true);
    button('fpc-stepper-next').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.active()).toBe(1);
    expect(button('fpc-stepper-next').disabled).toBe(true);
    expect((host.querySelector('[data-step-id="review"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('finishes on the last step once every step is valid', () => {
    const finished: number[] = [];
    fixture.componentInstance.finished.subscribe(() => finished.push(1));
    fixture.componentRef.setInput(
      'steps',
      steps.map((step) => ({ ...step, invalid: false })),
    );
    fixture.componentRef.setInput('active', 3);
    fixture.detectChanges();

    button('fpc-stepper-finish').click();
    expect(finished).toHaveLength(1);
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('Review');
  });

  it('jumps back via the header and computes reachability', () => {
    fixture.componentRef.setInput('active', 2);
    fixture.detectChanges();
    (host.querySelector('[data-step-id="general"]') as HTMLButtonElement).click();
    expect(fixture.componentInstance.active()).toBe(0);

    expect(fpcStepReachable(steps, 0, 3, true)).toBe(false);
    expect(fpcStepReachable(steps, 0, 3, false)).toBe(true);
    expect(fpcStepReachable(steps, 0, 9, false)).toBe(false);
  });
});
