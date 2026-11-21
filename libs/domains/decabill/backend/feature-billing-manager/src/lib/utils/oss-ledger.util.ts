import { isEuMemberState } from '../constants/eu-member-states.constants';
import { TaxMode } from '../constants/tax-mode.constants';

/**
 * Whether an issued invoice counted toward the OSS cross-border B2C ledger (mirrors
 * `InvoiceTaxContextService.countsTowardOssLedger`, evaluated on the frozen invoice tax snapshot).
 */
export function invoiceCountsTowardOssLedger(invoice: {
  taxMode?: TaxMode | string | null;
  buyerCountry?: string | null;
  issuerCountry?: string | null;
  issuerIsInEu?: boolean | null;
}): boolean {
  const buyer = invoice.buyerCountry?.toUpperCase();
  const issuer = invoice.issuerCountry?.toUpperCase();

  return (
    Boolean(invoice.issuerIsInEu) &&
    Boolean(buyer) &&
    buyer !== issuer &&
    isEuMemberState(buyer) &&
    (invoice.taxMode === TaxMode.EU_B2C_OSS || invoice.taxMode === TaxMode.DOMESTIC_VAT)
  );
}
