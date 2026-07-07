import {
  isBillingIssuerConfiguredForPublicDisplay,
  mapBillingIssuerToAddressee,
} from './billing-issuer-addressee.utils';

describe('billing-issuer-addressee.utils', () => {
  it('maps configured issuer to addressee view', () => {
    const result = mapBillingIssuerToAddressee({
      name: 'Acme GmbH',
      vatId: 'DE123',
      addressLine1: 'Street 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      email: 'legal@acme.example',
    });

    expect(result).toEqual({
      name: 'Acme GmbH',
      lines: ['Street 1', '10115 Berlin', 'Germany'],
      vatId: 'DE123',
      email: 'legal@acme.example',
    });
    expect(
      isBillingIssuerConfiguredForPublicDisplay({
        name: 'Acme GmbH',
        vatId: 'DE123',
        addressLine1: 'Street 1',
        postalCode: '10115',
        city: 'Berlin',
        country: 'DE',
      }),
    ).toBe(true);
  });

  it('returns null when required address fields are missing', () => {
    expect(
      mapBillingIssuerToAddressee({
        name: 'Acme',
        vatId: 'DE1',
        addressLine1: '',
        postalCode: '1',
        city: 'B',
        country: 'DE',
      }),
    ).toBeNull();
  });
});
