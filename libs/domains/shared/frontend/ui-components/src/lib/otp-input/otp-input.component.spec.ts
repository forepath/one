import { TestBed } from '@angular/core/testing';

import { FpcOtpInputComponent } from './otp-input.component';

describe('FpcOtpInputComponent labelling', () => {
  function render(inputs: Record<string, unknown>): HTMLElement {
    const fixture = TestBed.createComponent(FpcOtpInputComponent);

    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('names the digit group after the visible label and ids the first digit for label association', () => {
    const root = render({ length: 6, ariaLabel: 'Confirmation code', controlId: 'withdrawal-code' });
    const group = root.querySelector('[role="group"]');
    const digits = root.querySelectorAll('input');

    expect(group?.getAttribute('aria-label')).toBe('Confirmation code');
    expect(digits[0].id).toBe('withdrawal-code');
    expect(digits[1].hasAttribute('id')).toBe(false);
    expect(digits[0].getAttribute('aria-label')).toBe('Character 1 of 6');
  });

  it('renders no group name or id when none is given', () => {
    const root = render({});

    expect(root.querySelector('[role="group"]')?.hasAttribute('aria-label')).toBe(false);
    expect(root.querySelector('input')?.hasAttribute('id')).toBe(false);
  });
});
