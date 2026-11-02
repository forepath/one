import { formatNumber } from '@angular/common';
import { fpcFormatMoney, type FpcKeyValueItem } from '@forepath/shared/frontend/ui-components';

import { DEFAULT_BILLING_CURRENCY } from '../billing-format';

/** Tax breakdown of an invoice document as key-value rows ("19%" → "€12.34", DB-03 money format). */
export function invoiceTaxItems(
  detail: { taxBreakdown: readonly { taxRate: number; taxAmount: number }[]; currency?: string | null },
  locale: string,
): FpcKeyValueItem[] {
  return detail.taxBreakdown.map((tax, index) => ({
    key: `tax-${index}`,
    label: `${formatNumber(tax.taxRate, locale, '1.0-1')}%`,
    value: fpcFormatMoney(tax.taxAmount, detail.currency || DEFAULT_BILLING_CURRENCY, locale),
  }));
}

/** Subtotal / tax / total / balance of an invoice document as key-value rows. */
export function invoiceSummaryItems(
  detail: {
    subtotalNet: number;
    taxTotal: number;
    totalGross: number;
    balanceDue: number;
    currency?: string | null;
  },
  locale: string,
): FpcKeyValueItem[] {
  const money = (value: number) => fpcFormatMoney(value, detail.currency || DEFAULT_BILLING_CURRENCY, locale);

  return [
    {
      key: 'subtotal',
      label: $localize`:@@featureInvoices-subtotalNet:Subtotal (net)`,
      value: money(detail.subtotalNet),
    },
    { key: 'tax', label: $localize`:@@featureInvoices-taxTotal:Tax total`, value: money(detail.taxTotal) },
    { key: 'total', label: $localize`:@@featureInvoices-totalGross:Total`, value: money(detail.totalGross) },
    { key: 'balance', label: $localize`:@@featureInvoices-balanceDue:Balance due`, value: money(detail.balanceDue) },
  ];
}
