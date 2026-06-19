import type { CustomerProfileEntity } from '../entities/customer-profile.entity';

export interface CustomerPostalAddress {
  street: string;
  streetLine2?: string;
  postalCode: string;
  city: string;
  country: string;
}

export function resolveCustomerPostalAddress(buyer: CustomerProfileEntity): CustomerPostalAddress | null {
  const street = buyer.addressLine1?.trim();
  const postalCode = buyer.postalCode?.trim();
  const city = buyer.city?.trim();
  const country = buyer.country?.trim()?.toUpperCase();

  if (!street || !postalCode || !city || !country) {
    return null;
  }

  const streetLine2 = buyer.addressLine2?.trim();

  return {
    street,
    ...(streetLine2 ? { streetLine2 } : {}),
    postalCode,
    city,
    country,
  };
}

export function assertCustomerPostalAddress(buyer: CustomerProfileEntity): asserts buyer is CustomerProfileEntity & {
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
} {
  if (!resolveCustomerPostalAddress(buyer)) {
    throw new Error('Buyer address is incomplete for e-invoice (street, postal code, city, and country are required)');
  }
}
