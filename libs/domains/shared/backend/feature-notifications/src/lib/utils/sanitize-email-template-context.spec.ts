import { sanitizeEmailTemplateContext } from './sanitize-email-template-context';

describe('sanitizeEmailTemplateContext', () => {
  it('strips sensitive keys', () => {
    expect(
      sanitizeEmailTemplateContext({
        invoiceNumber: 'INV-1',
        code: 'SECRET',
        confirmationCode: 'X',
        recipientName: 'Ada',
      }),
    ).toEqual({
      invoiceNumber: 'INV-1',
      recipientName: 'Ada',
    });
  });
});
