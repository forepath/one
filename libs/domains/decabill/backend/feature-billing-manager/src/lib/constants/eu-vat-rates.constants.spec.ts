import { EU_VAT_RATES, EU_VAT_RATES_SOURCE_CHECKED_AT, EU_VAT_RATES_SOURCE_URL } from './eu-vat-rates.constants';

describe('eu-vat-rates.constants', () => {
  it('exposes locked source metadata', () => {
    expect(EU_VAT_RATES_SOURCE_CHECKED_AT).toBe('2026-07-13');
    expect(EU_VAT_RATES_SOURCE_URL).toContain('youreurope');
  });

  it('includes locked DE rates from the plan table', () => {
    expect(EU_VAT_RATES.DE).toEqual({ countryCode: 'DE', standard: 19, reduced: 7 });
  });

  it('marks Denmark reduced rate as unavailable', () => {
    expect(EU_VAT_RATES.DK.reduced).toBeNull();
    expect(EU_VAT_RATES.DK.standard).toBe(25);
  });

  it('covers all expected EU VAT lookup keys', () => {
    expect(Object.keys(EU_VAT_RATES).sort()).toEqual(
      [
        'AT',
        'BE',
        'BG',
        'CY',
        'CZ',
        'DE',
        'DK',
        'EE',
        'EL',
        'ES',
        'FI',
        'FR',
        'HR',
        'HU',
        'IE',
        'IT',
        'LT',
        'LU',
        'LV',
        'MT',
        'NL',
        'PL',
        'PT',
        'RO',
        'SE',
        'SI',
        'SK',
      ].sort(),
    );
  });
});
