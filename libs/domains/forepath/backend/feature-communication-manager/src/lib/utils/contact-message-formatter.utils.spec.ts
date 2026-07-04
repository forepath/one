import { formatContactRequestMessage } from './contact-message-formatter.utils';

describe('formatContactRequestMessage', () => {
  it('includes required fields', () => {
    const result = formatContactRequestMessage({
      name: 'Alice',
      email: 'alice@example.com',
      message: 'Hello there',
    });

    expect(result).toContain('Name: Alice');
    expect(result).toContain('Email: alice@example.com');
    expect(result).toContain('Message:\nHello there');
  });

  it('includes optional phone and company when provided', () => {
    const result = formatContactRequestMessage({
      name: 'Bob',
      email: 'bob@example.com',
      phone: '+49123456789',
      company: 'Acme GmbH',
      message: 'Need support',
    });

    expect(result).toContain('Phone: +49123456789');
    expect(result).toContain('Company: Acme GmbH');
  });
});
