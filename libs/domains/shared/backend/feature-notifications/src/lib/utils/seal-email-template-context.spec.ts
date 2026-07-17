import { sealEmailTemplateContext, unsealEmailTemplateContext } from './seal-email-template-context';

describe('sealEmailTemplateContext', () => {
  it('leaves non-sensitive context in plaintext', () => {
    const sealed = sealEmailTemplateContext({ invoiceNumber: 'INV-1', amountLabel: '10 EUR' });

    expect(sealed).toEqual({
      templateContext: { invoiceNumber: 'INV-1', amountLabel: '10 EUR' },
    });
  });

  it('moves OTP fields into encryptedTemplateSecrets', () => {
    const sealed = sealEmailTemplateContext({ code: 'ABC123', expiryText: '1 hour' });

    expect(sealed.templateContext).toEqual({ expiryText: '1 hour' });
    expect(sealed.encryptedTemplateSecrets).toEqual(expect.any(String));
    expect(sealed.encryptedTemplateSecrets).not.toContain('ABC123');

    const roundTrip = unsealEmailTemplateContext(sealed.templateContext, sealed.encryptedTemplateSecrets);

    expect(roundTrip).toEqual({ code: 'ABC123', expiryText: '1 hour' });
  });

  it('unseal without secrets returns a shallow copy', () => {
    const context = { invoiceNumber: 'INV-1' };

    expect(unsealEmailTemplateContext(context)).toEqual(context);
    expect(unsealEmailTemplateContext(context)).not.toBe(context);
  });
});
