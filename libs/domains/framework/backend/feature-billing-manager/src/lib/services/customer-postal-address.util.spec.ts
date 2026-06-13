import type { CustomerProfileEntity } from '../entities/customer-profile.entity';

import { assertCustomerPostalAddress, resolveCustomerPostalAddress } from './customer-postal-address.util';

describe('customer-postal-address.util', () => {
  const completeBuyer = {
    addressLine1: 'Buyer St 2',
    addressLine2: 'Floor 3',
    postalCode: '20095',
    city: 'Hamburg',
    country: 'de',
  } as CustomerProfileEntity;

  it('resolves a complete postal address with normalized country', () => {
    expect(resolveCustomerPostalAddress(completeBuyer)).toEqual({
      street: 'Buyer St 2',
      streetLine2: 'Floor 3',
      postalCode: '20095',
      city: 'Hamburg',
      country: 'DE',
    });
  });

  it('returns null when a required field is missing', () => {
    expect(
      resolveCustomerPostalAddress({
        ...completeBuyer,
        city: ' ',
      } as CustomerProfileEntity),
    ).toBeNull();
  });

  it('assertCustomerPostalAddress throws for incomplete addresses', () => {
    expect(() =>
      assertCustomerPostalAddress({
        ...completeBuyer,
        postalCode: undefined,
      } as CustomerProfileEntity),
    ).toThrow('Buyer address is incomplete for e-invoice');
  });
});
