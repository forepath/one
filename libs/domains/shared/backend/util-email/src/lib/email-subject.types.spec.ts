import { resolveEmailSubject } from './email-subject.types';

describe('resolveEmailSubject', () => {
  it('returns static subject strings', () => {
    expect(resolveEmailSubject({ hello: 'Hello' }, 'hello')).toBe('Hello');
  });

  it('evaluates dynamic subject builders', () => {
    expect(
      resolveEmailSubject(
        {
          invoice: (ctx) => `Invoice ${ctx.invoiceNumber}`,
        },
        'invoice',
        { invoiceNumber: 'INV-1' },
      ),
    ).toBe('Invoice INV-1');
  });

  it('throws when template key is missing', () => {
    expect(() => resolveEmailSubject({}, 'missing')).toThrow(/No email subject registered/);
  });
});
