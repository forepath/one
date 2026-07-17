import { assertEmailDeliveryAllowed } from './assert-email-delivery-allowed';

describe('assertEmailDeliveryAllowed', () => {
  const emailOptions = {
    templateRoots: ['/tmp'],
    emailEventCatalog: ['invoice.issued'],
    subjectRegistry: {
      'invoice-issued': 'Your invoice is ready',
    },
  };

  it('allows catalogued event and template pairs', () => {
    expect(() => assertEmailDeliveryAllowed(emailOptions, 'invoice.issued', 'invoice-issued')).not.toThrow();
  });

  it('rejects invalid template key shapes', () => {
    expect(() => assertEmailDeliveryAllowed(emailOptions, 'invoice.issued', '../secret')).toThrow(
      'Invalid email template key',
    );
  });

  it('rejects unknown event types', () => {
    expect(() => assertEmailDeliveryAllowed(emailOptions, 'invoice.forged', 'invoice-issued')).toThrow(
      'Email event type is not allowlisted',
    );
  });

  it('rejects unknown template keys', () => {
    expect(() => assertEmailDeliveryAllowed(emailOptions, 'invoice.issued', 'unknown-template')).toThrow(
      'Email template key is not allowlisted',
    );
  });
});
