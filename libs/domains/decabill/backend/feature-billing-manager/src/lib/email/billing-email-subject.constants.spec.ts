import { BILLING_EMAIL_EVENTS, BILLING_EMAIL_SUBJECTS } from './billing-email-subject.constants';
import { resolveEmailSubject } from '@forepath/shared/backend/util-email';

describe('BILLING_EMAIL_SUBJECTS', () => {
  it('builds invoice issued subject', () => {
    expect(resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'invoice-issued', { invoiceNumber: 'INV-9' })).toBe(
      'Your invoice INV-9 is ready',
    );
  });

  it('builds void and partial credit subjects', () => {
    expect(
      resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'invoice-voided', {
        creditNoteNumber: 'CN-1',
        invoiceNumber: 'INV-1',
      }),
    ).toBe('Credit note CN-1 for invoice INV-1');
    expect(
      resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'invoice-partial-credit', {
        creditNoteNumber: 'CN-2',
        invoiceNumber: 'INV-2',
      }),
    ).toBe('Credit note CN-2 for invoice INV-2');
  });

  it('builds payment subjects', () => {
    expect(resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'payment-succeeded', { invoiceNumber: 'INV-3' })).toBe(
      'Payment received for invoice INV-3',
    );
    expect(resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'payment-failed', { invoiceNumber: 'INV-2' })).toBe(
      'Payment failed for invoice INV-2',
    );
  });

  it('builds subscription subjects', () => {
    expect(resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'subscription-renewal-reminder', { planName: 'Pro' })).toBe(
      'Upcoming subscription renewal: Pro',
    );
    expect(resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'subscription-canceled', { planName: 'Pro' })).toBe(
      'Subscription canceled: Pro',
    );
  });

  it('uses static withdrawal subject', () => {
    expect(resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'withdrawal-confirmation', {})).toBe(
      'Confirm your statutory withdrawal',
    );
  });

  it('stringifies non-string context values', () => {
    expect(resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'invoice-issued', { invoiceNumber: 42 })).toBe(
      'Your invoice 42 is ready',
    );
    expect(resolveEmailSubject(BILLING_EMAIL_SUBJECTS, 'invoice-issued', {})).toBe('Your invoice  is ready');
  });

  it('lists billing email events', () => {
    expect(BILLING_EMAIL_EVENTS).toEqual(
      expect.arrayContaining(['invoice.issued', 'payment.failed', 'subscription.canceled']),
    );
  });
});
