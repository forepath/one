import type { BillingIssuerConfig } from '../services/billing-issuer-config.service';
import { resolveCountryDisplayName } from './country-display-name.util';

export interface PublicWithdrawalAddresseeView {
  name: string;
  lines: string[];
  vatId?: string;
  email?: string;
}

export function mapBillingIssuerToAddressee(issuer: BillingIssuerConfig): PublicWithdrawalAddresseeView | null {
  const { name, vatId, addressLine1, postalCode, city, country, email } = issuer;

  if (!name?.trim() || !addressLine1?.trim() || !postalCode?.trim() || !city?.trim()) {
    return null;
  }

  const countryLine = resolveCountryDisplayName(country);
  const lines = [`${addressLine1}`, `${postalCode} ${city}`, countryLine ?? ''].filter(
    (line) => line.trim().length > 0,
  );

  return {
    name: name.trim(),
    lines,
    vatId: vatId?.trim() || undefined,
    email: email?.trim() || undefined,
  };
}

export function isBillingIssuerConfiguredForPublicDisplay(issuer: BillingIssuerConfig): boolean {
  return mapBillingIssuerToAddressee(issuer) !== null;
}
