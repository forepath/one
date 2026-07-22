import { isValidEuVatIdFormat, maskVatId, normalizeVatId, extractVatIdCountryCode } from './vat-id.utils';

describe('vat-id.utils', () => {
  it('normalizes VAT IDs', () => {
    expect(normalizeVatId('de 123.456-789')).toBe('DE123456789');
  });

  it('masks VAT IDs', () => {
    expect(maskVatId('DE123456789')).toBe('DE***789');
  });

  it('validates EU VAT ID format', () => {
    expect(isValidEuVatIdFormat('DE123456789')).toBe(true);
    expect(isValidEuVatIdFormat('XX123')).toBe(false);
    expect(isValidEuVatIdFormat('DE')).toBe(false);
  });

  it('extracts country and maps GR to EL', () => {
    expect(extractVatIdCountryCode('GR123456789')).toBe('EL');
    expect(extractVatIdCountryCode('DE123456789')).toBe('DE');
  });
});
